"""Private HTTP worker for generating read-along assets on an Audiobookshelf server."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from threading import Lock
from urllib.parse import parse_qs, urlsplit
import json
import math
import os
import re
import stat
import sys


MAX_REQUEST = 128 * 1024
MAX_AUDIO_TRACKS = 512
MAX_EBOOK_SIZE = 512 * 1024**2
MAX_AUDIO_SIZE = 64 * 1024**3
MAX_PENDING_JOBS = 8
# Mirror the Audiobookshelf upload formats handled by the React client.
AUDIO_EXTENSIONS = {'.aac', '.aif', '.aiff', '.awb', '.caf', '.flac', '.m4a', '.m4b', '.mka',
                    '.mp3', '.mp4', '.mpeg', '.mpg', '.oga', '.ogg', '.opus', '.wav', '.webm', '.webma', '.wma'}
JOB_PATH = re.compile(r'/jobs/([a-zA-Z0-9_-]{1,128})(?:/(timings\.json|audio\.mp3))?')
REVISION = re.compile(r'[a-f0-9]{64}')
ERROR_CODES = {'unreadable-ebook', 'audio-unavailable', 'edition-mismatch', 'sync-failed', 'files-changed'}


class RequestError(Exception):
    def __init__(self, status, message, code=None):
        self.status = status
        self.message = message
        self.code = code


@dataclass(frozen=True)
class Sources:
    ebook: Path
    audio: tuple[Path, ...]
    fingerprint: str


def virtual_path(value):
    if not isinstance(value, str) or not value.startswith('/') or '\\' in value or '\x00' in value:
        raise ValueError('Expected an absolute Audiobookshelf media path.')
    if any(part in ('', '.', '..') for part in value[1:].split('/')):
        raise ValueError('Audiobookshelf media paths must use literal path components.')
    return PurePosixPath(value)


def media_roots(raw):
    if not isinstance(raw, dict) or not raw:
        raise ValueError('READ_ALONG_MEDIA_ROOTS must map Audiobookshelf paths to local directories.')
    roots = []
    for remote, local in raw.items():
        if not isinstance(local, str) or not Path(local).is_absolute():
            raise ValueError('A media root must be an absolute local directory.')
        directory = Path(local).resolve(strict=True)
        if not directory.is_dir() or directory == Path('/'):
            raise ValueError('Each media root must name a specific library directory.')
        roots.append((virtual_path(remote), directory))
    # Overlapping virtual mounts use the most specific configured root.
    return sorted(roots, key=lambda root: len(root[0].parts), reverse=True)


def file_source(value, roots, extensions):
    source = virtual_path(value)
    if source.suffix.lower() not in extensions:
        raise ValueError('Unsupported file extension.')
    for remote, directory in roots:
        if not source.is_relative_to(remote):
            continue
        local = directory.joinpath(*source.relative_to(remote).parts).resolve(strict=True)
        if not local.is_relative_to(directory):
            break
        metadata = local.stat()
        if stat.S_ISREG(metadata.st_mode) and metadata.st_size > 0:
            signature = (value, str(local), metadata.st_dev, metadata.st_ino, metadata.st_size,
                         metadata.st_mtime_ns, metadata.st_ctime_ns)
            return local, signature
        break
    raise ValueError('File is outside of the configured media roots or cannot be read.')


def resolve_sources(inputs, roots):
    if not isinstance(inputs, dict) or set(inputs) != {'ebook', 'audio'}:
        raise RequestError(400, 'Provide an ebook path and an ordered list of audio paths.')
    tracks = inputs['audio']
    if (not isinstance(tracks, list) or not 1 <= len(tracks) <= MAX_AUDIO_TRACKS
            or not all(isinstance(track, str) for track in tracks)):
        raise RequestError(400, 'Provide one or more audio paths in playback order.')
    try:
        ebook, ebook_info = file_source(inputs['ebook'], roots, {'.epub', '.pdf'})
        audio = [file_source(track, roots, AUDIO_EXTENSIONS) for track in tracks]
    except (OSError, RuntimeError, ValueError) as problem:
        raise RequestError(422, 'The worker cannot read this ebook or audio in its configured library folders.') from problem
    if len({path for path, _ in audio}) != len(audio):
        raise RequestError(422, 'The audiobook contains duplicate audio files.')
    if ebook_info[4] > MAX_EBOOK_SIZE or sum(signature[4] for _, signature in audio) > MAX_AUDIO_SIZE:
        raise RequestError(413, 'The ebook or audiobook exceeds the worker size limit.')
    fingerprint = sha256(json.dumps([ebook_info, *[info for _, info in audio]]).encode()).hexdigest()
    return Sources(ebook, tuple(path for path, _ in audio), fingerprint)


def load_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError):
        return None


def default_generator(*args):
    from engine import EngineError, generate

    try:
        return generate(*args)
    except EngineError as problem:
        raise RequestError(422, str(problem), problem.code) from problem


class Worker:
    def __init__(self, roots, data_dir, model_file, generator=default_generator):
        self.roots = roots
        self.data_dir = data_dir
        self.model_file = model_file
        self.generate = generator
        self.lock = Lock()
        self.jobs = {}
        self.executor = ThreadPoolExecutor(max_workers=1)

    def directory(self, key):
        return self.data_dir / key[0] / key[1]

    def complete(self, key):
        directory = self.directory(key)
        metadata = load_json(directory / 'result.json')
        if not isinstance(metadata, dict):
            return None
        try:
            current = resolve_sources(metadata.get('inputs'), self.roots)
        except RequestError:
            return None
        if current.fingerprint != metadata.get('fingerprint'):
            return None
        if not all((directory / name).is_file() for name in ('timings.json', 'audio.mp3')):
            return None
        return metadata

    def status(self, key):
        with self.lock:
            job = self.jobs.get(key)
            if job:
                return dict(job)
            if self.complete(key):
                return {'state': 'complete', 'progress': 1}
            manifest = load_json(self.directory(key) / 'failure.json')
            if isinstance(manifest, dict) and isinstance(manifest.get('code'), str) and manifest['code'] in ERROR_CODES:
                return {'state': 'error', 'progress': 0, 'code': manifest['code']}
            return {'state': 'idle', 'progress': 0}

    def submit(self, key, inputs):
        sources = resolve_sources(inputs, self.roots)
        with self.lock:
            current = self.jobs.get(key)
            if current:
                return dict(current)
            completed = self.complete(key)
            if completed and completed['fingerprint'] == sources.fingerprint:
                return {'state': 'complete', 'progress': 1}
            if len(self.jobs) >= MAX_PENDING_JOBS:
                raise RequestError(429, 'The sync queue is full. Try again after another book finishes.')
            directory = self.directory(key)
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            (directory / 'result.json').unlink(missing_ok=True)
            (directory / 'failure.json').unlink(missing_ok=True)
            job = {'state': 'queued', 'progress': 0}
            self.jobs[key] = job
            self.executor.submit(self.run, key, directory, inputs, sources)
            return dict(job)

    def run(self, key, directory, inputs, sources):
        def update(value):
            if not math.isfinite(value):
                return
            with self.lock:
                self.jobs[key]['progress'] = max(self.jobs[key]['progress'], min(0.99, max(0, value)))

        with self.lock:
            self.jobs[key]['state'] = 'working'
        try:
            if resolve_sources(inputs, self.roots).fingerprint != sources.fingerprint:
                raise RequestError(409, 'The book changed before syncing. Reopen the item and sync again.', 'files-changed')
            with TemporaryDirectory(prefix='sync-', dir=directory) as staging:
                stage = Path(staging)
                audio = stage / 'audio.mp3'
                timings = self.generate(sources.ebook, list(sources.audio), audio, self.model_file, update)
                if not audio.is_file() or not audio.stat().st_size:
                    raise ValueError('The engine did not generate playable audio.')
                if not isinstance(timings, dict) or not timings.get('pages') or not timings.get('chapters'):
                    raise ValueError('The engine did not generate reader data.')
                (stage / 'timings.json').write_text(json.dumps(timings, ensure_ascii=False, allow_nan=False), encoding='utf-8')
                metadata = {'inputs': inputs, 'fingerprint': sources.fingerprint}
                (stage / 'result.json').write_text(json.dumps(metadata), encoding='utf-8')
                with self.lock:
                    if resolve_sources(inputs, self.roots).fingerprint != sources.fingerprint:
                        raise RequestError(409, 'The book changed during sync. Reopen the item and sync again.', 'files-changed')
                    for name in ('audio.mp3', 'timings.json', 'result.json'):
                        (stage / name).replace(directory / name)
        except (Exception, SystemExit) as problem:
            # Library paths and model output can contain private book details.
            code = problem.code if isinstance(problem, RequestError) and problem.code in ERROR_CODES else 'sync-failed'
            print(f'Read Along sync failed ({type(problem).__name__}).', file=sys.stderr, flush=True)
            try:
                failure = directory / '.failure.tmp'
                failure.write_text(json.dumps({'code': code}), encoding='utf-8')
                failure.replace(directory / 'failure.json')
            except OSError:
                pass
        finally:
            with self.lock:
                self.jobs.pop(key, None)

    def asset(self, key, name):
        with self.lock:
            if key in self.jobs or not self.complete(key):
                raise RequestError(404, 'This read-along file is not ready.')
            return (self.directory(key) / name).open('rb')


def byte_range(value, length):
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
    if not match or not any(match.groups()) or not length:
        return None
    begin, end = match.groups()
    if max(len(begin), len(end)) > 20:
        return None
    if not begin:
        suffix = int(end)
        return (max(0, length - suffix), length - 1) if suffix else None
    begin = int(begin)
    end = min(int(end), length - 1) if end else length - 1
    return (begin, end) if 0 <= begin <= end else None


def handler(worker, token):
    auth = ('Bearer ' + token).encode()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def setup(self):
            self.request.settimeout(15)
            super().setup()

        def do_GET(self):
            self.route()

        def do_HEAD(self):
            self.route()

        def do_POST(self):
            self.route()

        def log_message(self, *_):
            # Do not log tokens, content, library paths or job identifiers.
            pass

        def reply(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'private, no-store')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def read_payload(self):
            lengths = self.headers.get_all('Content-Length', [])
            if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'\d{1,8}', lengths[0]):
                raise RequestError(400, 'Send a bounded JSON request body.')
            length = int(lengths[0])
            if length > MAX_REQUEST:
                raise RequestError(413, 'The sync request is too large.')
            if self.headers.get_content_type() != 'application/json':
                raise RequestError(415, 'Send a JSON sync request.')
            try:
                data = self.rfile.read(length)
                if len(data) != length:
                    raise ValueError('Incomplete body.')
                return json.loads(data)
            except (UnicodeError, ValueError, RecursionError) as problem:
                raise RequestError(400, 'Invalid sync request.') from problem

        def send_asset(self, key, name):
            with worker.asset(key, name) as file:
                length = os.fstat(file.fileno()).st_size
                start, stop = 0, length - 1
                requested = self.headers.get('Range')
                if requested is not None:
                    limits = byte_range(requested, length)
                    if limits is None:
                        self.send_response(416)
                        self.send_header('Content-Range', f'bytes */{length}')
                        self.send_header('Content-Length', '0')
                        self.send_header('Cache-Control', 'private, no-store')
                        self.end_headers()
                        return
                    start, stop = limits
                self.send_response(206 if requested is not None else 200)
                self.send_header('Content-Type', 'audio/mpeg' if name.endswith('.mp3') else 'application/json')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', str(stop - start + 1))
                self.send_header('Cache-Control', 'private, no-store')
                if requested is not None:
                    self.send_header('Content-Range', f'bytes {start}-{stop}/{length}')
                self.end_headers()
                if self.command == 'HEAD':
                    return
                file.seek(start)
                remaining = stop - start + 1
                while remaining:
                    chunk = file.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

        def route(self):
            try:
                if not compare_digest(self.headers.get('Authorization', '').encode(), auth):
                    raise RequestError(401, 'A valid worker token is required.')
                url = urlsplit(self.path)
                match = JOB_PATH.fullmatch(url.path)
                if not match:
                    raise RequestError(404, 'Unknown worker route.')
                values = parse_qs(url.query, keep_blank_values=True, max_num_fields=4)
                revision = values.get('revision', [])
                if set(values) != {'revision'} or len(revision) != 1 or not REVISION.fullmatch(revision[0]):
                    raise RequestError(400, 'A valid file revision is required.')
                item, asset = match.groups()
                key = (item, revision[0])
                if self.command == 'POST':
                    if asset:
                        raise RequestError(405, 'Use POST on the job itself.')
                    status = worker.submit(key, self.read_payload())
                    self.reply(200 if status['state'] == 'complete' else 202, status)
                else:
                    if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
                        raise RequestError(400, 'A read request cannot have a body.')
                    if asset:
                        self.send_asset(key, asset)
                    else:
                        self.reply(200, worker.status(key))
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                self.close_connection = True
            except RequestError as problem:
                self.close_connection = True
                self.reply(problem.status, {'message': problem.message})
            except (ValueError, RecursionError):
                self.close_connection = True
                self.reply(400, {'message': 'Invalid worker request.'})
            except OSError:
                self.close_connection = True
                self.reply(503, {'message': 'The worker could not access its storage.'})

    return Handler


def main():
    token = os.environ.get('READ_ALONG_WORKER_TOKEN', '')
    if not re.fullmatch(r'[a-zA-Z0-9._~-]{32,256}', token):
        raise ValueError('READ_ALONG_WORKER_TOKEN must be a random URL-safe token of at least 32 characters.')
    roots = media_roots(json.loads(os.environ['READ_ALONG_MEDIA_ROOTS']))
    data_dir = Path(os.environ['READ_ALONG_DATA_DIR']).resolve()
    data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    for _, root in roots:
        if data_dir.is_relative_to(root) or root.is_relative_to(data_dir):
            raise ValueError('The separate worker output directory cannot overlap a library mount.')
    model_file = Path(os.environ['READ_ALONG_MODEL_PATH']).resolve(strict=True)
    if not model_file.is_file():
        raise ValueError('READ_ALONG_MODEL_PATH must point to a local model file.')
    worker = Worker(roots, data_dir, model_file)
    host = os.environ.get('READ_ALONG_HOST', '127.0.0.1')
    port = int(os.environ.get('READ_ALONG_PORT', '8789'))
    with ThreadingHTTPServer((host, port), handler(worker, token)) as server:
        print(f'Read Along worker listening on {host}:{port}.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
