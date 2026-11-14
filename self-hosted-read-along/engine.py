"""Prepare word timings for an EPUB or text PDF and one or more local audio files."""

from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from align import align_words
from epub import read_epub


SAMPLE_RATE = 16_000
CHUNK_SECONDS = 90
CHUNK_OVERLAP = 2
MAX_AUDIO_HOURS = 100
MAX_AUDIO_PCM_BYTES = MAX_AUDIO_HOURS * 3600 * SAMPLE_RATE * 2
MAX_BOOK_PAGES = 10_000
MAX_BOOK_WORDS = 500_000
# Allow local media containers only, including when probing suspicious input.
# In particular, a playlist must not turn an uploaded file into another input.
AUDIO_INPUT = [
    "-protocol_whitelist", "file,pipe",
    "-format_whitelist", "aac,ac3,aiff,amr,ape,asf,caf,eac3,flac,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,mpeg,ogg,w64,wav,wv",
]


class EngineError(ValueError):
    """A sanitized error and stable category suitable for displaying to readers."""

    def __init__(self, message, code="sync-failed"):
        super().__init__(message)
        self.code = code


def _read_pdf(path):
    try:
        with tempfile.TemporaryFile() as extracted:
            subprocess.run(
                ["pdftotext", "-bbox-layout", "-cropbox", "-enc", "UTF-8", str(path), "-"],
                stdout=extracted, stderr=subprocess.DEVNULL, check=True,
            )
            extracted.seek(0)
            pages = []
            word_count = 0
            for _, element in ElementTree.iterparse(extracted):
                if element.tag.rsplit("}", 1)[-1] != "page":
                    continue
                words = []
                for block in element.iterfind(".//{*}block"):
                    for line_index, line in enumerate(block.iterfind("./{*}line")):
                        for word_index, word in enumerate(line.iterfind("./{*}word")):
                            text = "".join(word.itertext()).strip()
                            if not text:
                                continue
                            entry = {"text": text}
                            if words and word_index == 0:
                                entry["breakBefore"] = "line" if line_index else "paragraph"
                            words.append(entry)
                word_count += len(words)
                if len(pages) >= MAX_BOOK_PAGES or word_count > MAX_BOOK_WORDS:
                    raise EngineError("The PDF exceeds the supported page or word count.", "unreadable-ebook")
                pages.append({"words": words})
                element.clear()
    except FileNotFoundError as error:
        raise EngineError("Install Poppler and put pdftotext on the worker's PATH to sync PDFs.") from error
    except (ElementTree.ParseError, subprocess.CalledProcessError) as error:
        raise EngineError("The PDF could not be read. Use an unlocked PDF with selectable text.", "unreadable-ebook") from error
    if not any(page["words"] for page in pages):
        raise EngineError("This PDF has no selectable text. Run OCR on it before syncing.", "unreadable-ebook")
    return pages


def _encode_audio(paths, destination):
    # Re-encode every track to the same PCM format and feed one MP3 encoder.
    # The decoded PCM flows one track at a time, without a whole-book WAV.
    command = [
        "ffmpeg", "-nostdin", "-v", "error", "-y",
        "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0",
        "-map_metadata", "-1", "-map_chapters", "-1", "-c:a", "libmp3lame",
        "-b:a", "48k", "-f", "mp3", str(destination),
    ]
    try:
        total_bytes = 0
        with subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL) as encoder:
            for path in paths:
                decode = [
                    "ffmpeg", "-nostdin", "-v", "error", *AUDIO_INPUT, "-i", str(path),
                    "-map", "0:a:0", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1",
                ]
                with subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as decoder:
                    try:
                        while chunk := decoder.stdout.read(64 * 1024):
                            total_bytes += len(chunk)
                            if total_bytes > MAX_AUDIO_PCM_BYTES:
                                decoder.kill()
                                raise EngineError("The audiobook exceeds the 100-hour sync limit.", "audio-unavailable")
                            encoder.stdin.write(chunk)
                    except BrokenPipeError as error:
                        decoder.kill()
                        raise EngineError("The worker could not encode the audiobook as an MP3.") from error
                    if decoder.wait():
                        raise EngineError("An audiobook track could not be decoded. Check the original audio files.", "audio-unavailable")
            encoder.stdin.close()
            if encoder.wait():
                raise EngineError("The worker could not encode the audiobook as an MP3.")
    except FileNotFoundError as error:
        raise EngineError("Install FFmpeg with libmp3lame and put it on the worker's PATH.") from error


def _duration(path):
    try:
        raw = subprocess.check_output(
            ["ffprobe", "-v", "error", *AUDIO_INPUT,
             "-show_entries", "format=duration", "-of", "json", str(path)],
            stderr=subprocess.DEVNULL,
        )
        duration = float(json.loads(raw)["format"]["duration"])
    except FileNotFoundError as error:
        raise EngineError("Install ffprobe and put it on the worker's PATH.") from error
    except (KeyError, ValueError, subprocess.CalledProcessError) as error:
        raise EngineError("The worker could not determine the audio duration.", "audio-unavailable") from error
    if not math.isfinite(duration) or duration <= 0:
        raise EngineError("The audiobook has no playable audio.", "audio-unavailable")
    return duration


def _transcribe(audio, duration, model_file, report):
    try:
        import numpy
        import torch
        import whisper
    except ImportError as error:
        raise EngineError("Install openai-whisper in the worker's Python environment.") from error

    # Pass an existing file path, never a model name which asks Whisper to download.
    torch.set_num_threads(min(6, os.cpu_count() or 1))
    try:
        model = whisper.load_model(str(model_file), device="cpu")
    except (OSError, RuntimeError) as error:
        raise EngineError("The worker could not load the configured Whisper model.") from error
    language = None
    heard = []
    for index in range(math.ceil(duration / CHUNK_SECONDS)):
        start = index * CHUNK_SECONDS
        end = min(start + CHUNK_SECONDS, duration)
        # A short overlap prevents clipping speech across a chunk boundary.
        # Assign each returned word to its central chunk once.
        clip_start = max(0, start - CHUNK_OVERLAP)
        clip_end = min(duration, end + CHUNK_OVERLAP)
        try:
            pcm = subprocess.check_output(
                ["ffmpeg", "-nostdin", "-v", "error", *AUDIO_INPUT,
                 "-ss", str(clip_start), "-i", str(audio), "-t", str(clip_end - clip_start),
                 "-map", "0:a:0", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError as error:
            raise EngineError("The worker could not decode the audio for transcription.", "audio-unavailable") from error
        if not pcm:
            continue
        result = model.transcribe(
            numpy.frombuffer(pcm, dtype="<f4").copy(), language=language, verbose=None,
            word_timestamps=True, fp16=False, temperature=0.0, condition_on_previous_text=False,
        )
        chunk = []
        for segment in result["segments"]:
            for word in segment.get("words", []):
                label = word["word"].strip()
                first = max(clip_start, clip_start + word["start"])
                last = min(clip_end, clip_start + word["end"])
                if label and first < last and start <= (first + last) / 2 < end:
                    chunk.append({"word": label, "start": first, "end": last})
        if len(chunk) >= 3:
            language = result.get("language", language)
        heard.extend(chunk)
        report(0.08 + 0.87 * end / duration)
    return sorted(heard, key=lambda word: word["start"])


def _reader_book(ebook_pages, transcript):
    pages = []
    for ebook_page in ebook_pages:
        words = []
        for entry in ebook_page["words"]:
            word = {"word": entry["text"]}
            if entry.get("breakBefore") == "paragraph":
                word["paragraphStart"] = True
            if entry.get("breakBefore") == "line":
                word["lineStart"] = True
            words.append(word)
        pages.append(words)

    page_starts = [None] * len(pages)
    prior_end = 0.0
    matched = 0
    cues = align_words([[word["word"] for word in page] for page in pages], transcript)
    for cue in cues:
        start = max(prior_end, round(cue["start"], 3))
        end = round(cue["end"], 3)
        if end <= start:
            continue
        page = cue["page"]
        pages[page][cue["word"]].update(start=start, end=end)
        if page_starts[page] is None:
            page_starts[page] = start
        prior_end = end
        matched += 1
    total = sum(len(page) for page in pages)
    required = min(total, max(3, min(32, math.ceil(total * .15))))
    if matched < required:
        raise EngineError("The worker couldn't match the narration to the ebook. Check the language and edition.", "edition-mismatch")

    # Keep unspoken front matter and blank PDF pages available for manual reading.
    # A chapter can open on an untimed page, but points to its first cue for playback.
    following_cues = list(page_starts)
    next_cue = round(prior_end, 3)
    for index in range(len(following_cues) - 1, -1, -1):
        if following_cues[index] is not None:
            next_cue = following_cues[index]
        following_cues[index] = next_cue

    chapters = [
        {"title": page["chapter"], "page": index, "start": following_cues[index]}
        for index, page in enumerate(ebook_pages) if page.get("chapter")
    ]
    if not chapters or chapters[0]["page"] > 0:
        chapters.insert(0, {"title": "Start", "page": 0, "start": following_cues[0]})
    return {
        "chapters": chapters, "pages": pages, "pageStarts": page_starts,
        "coverage": {"matched": matched, "total": total},
    }


def _input_file(path):
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise EngineError("The ebook, audio, and model must be existing local files.")
    return path


def generate(ebook_path, audio_paths, audio_destination, model_file, on_progress=None):
    """Create one local MP3 and return the reader's chapters, pages, and word cues."""
    ebook = _input_file(ebook_path)
    audio = [_input_file(path) for path in audio_paths]
    model = _input_file(model_file)
    destination = Path(audio_destination).absolute()
    if not audio:
        raise EngineError("Add at least one audio file to sync.", "audio-unavailable")
    if destination.resolve() in [ebook, model, *audio]:
        raise EngineError("Choose an output filename outside the source files.")
    if ebook.suffix.lower() == ".pdf":
        pages = _read_pdf(ebook)
    elif ebook.suffix.lower() == ".epub":
        try:
            pages = read_epub(ebook)
        except ValueError as error:
            raise EngineError("The EPUB could not be read. Use an unencrypted EPUB with selectable text.", "unreadable-ebook") from error
    else:
        raise EngineError("Sync needs an EPUB or text PDF.", "unreadable-ebook")

    if len(pages) > MAX_BOOK_PAGES or sum(len(page["words"]) for page in pages) > MAX_BOOK_WORDS:
        raise EngineError("The ebook exceeds the supported page or word count.", "unreadable-ebook")

    def report(progress):
        if on_progress is not None:
            on_progress(progress)

    report(0.02)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".sync-", dir=destination.parent) as staging:
        staged_audio = Path(staging) / "audio.mp3"
        _encode_audio(audio, staged_audio)
        duration = _duration(staged_audio)
        report(0.08)
        book = _reader_book(pages, _transcribe(staged_audio, duration, model, report))
        staged_audio.replace(destination)
    report(1)
    return book
