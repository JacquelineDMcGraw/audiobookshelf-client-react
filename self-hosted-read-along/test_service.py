"""Integration checks for the private worker's HTTP contract and file isolation."""

import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import unittest
from threading import Event, Thread

from service import Worker, handler, media_roots


TOKEN = 'x' * 32
ITEM = '/jobs/li_read-along-test'
REVISION = 'a' * 64
SAMPLE_INPUT = {'ebook': '/audiobooks/Book.epub', 'audio': ['/audiobooks/Chapter 1.mp3', '/audiobooks/Chapter 2.m4b']}


class WorkerServiceTest(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name).resolve()
        self.library = self.root / 'library'
        self.library.mkdir()
        self.output = self.root / 'output'
        self.outside = self.root / 'private.epub'
        self.outside.write_bytes(b'outside')
        self.ebook = self.library / 'Book.epub'
        self.ebook.write_bytes(b'ebook')
        (self.library / 'Chapter 1.mp3').write_bytes(b'original track one')
        (self.library / 'Chapter 2.m4b').write_bytes(b'original track two')
        self.calls = []
        self.finish = Event()
        self.started = Event()
        self.force_failure = False
        roots = media_roots({'/audiobooks': str(self.library)})
        self.worker = Worker(roots, self.output, self.root / 'model.pt', self.generate)
        self.addCleanup(self.worker.executor.shutdown)
        self.addCleanup(self.finish.set)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.worker, TOKEN))
        self.addCleanup(self.server.server_close)
        thread = Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.shutdown)

    def generate(self, ebook, tracks, destination, model, progress):
        self.calls.append((ebook, tuple(tracks), model))
        progress(0.34)
        self.started.set()
        if not self.finish.wait(5) or self.force_failure:
            raise ValueError('fixture failed')
        destination.write_bytes(b'1234567890')
        return {'chapters': [{'title': 'Book', 'page': 0, 'start': 0}], 'pages': [[{'word': 'Hi', 'start': 0, 'end': 0.3}]]}

    def request(self, method='GET', suffix='', payload=None, auth=TOKEN, revision=REVISION, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        request_headers = {'Authorization': 'Bearer ' + auth} if auth is not None else {}
        request_headers.update(headers or {})
        if payload is not None:
            request_headers['Content-Type'] = 'application/json'
        url = ITEM + suffix + ('?revision=' + revision if revision is not None else '')
        try:
            conn.request(method, url, json.dumps(payload).encode() if payload is not None else None, request_headers)
            response = conn.getresponse()
            status, metadata = response.status, dict(response.getheaders())
            data = response.read()
            if data and metadata.get('Content-Type') == 'application/json':
                data = json.loads(data)
            return status, metadata, data
        finally:
            conn.close()

    def wait_for(self, state):
        # Sending another request also verifies that the server responds while the job runs.
        poll = Event()
        for _ in range(200):
            _, _, data = self.request()
            if data['state'] == state:
                return data
            poll.wait(0.01)
        self.fail('Worker did not reach state ' + state)

    def test_ranges_status_and_duplicate_requests(self):
        self.assertEqual(self.request()[2], {'state': 'idle', 'progress': 0})
        self.assertEqual(self.request('POST', payload=SAMPLE_INPUT)[0], 202)
        self.assertTrue(self.started.wait(3))
        self.assertEqual(self.request()[2], {'state': 'working', 'progress': 0.34})
        self.assertEqual(self.request('POST', payload=SAMPLE_INPUT)[0], 202)
        self.assertEqual(self.request(suffix='/audio.mp3')[0], 404)
        self.finish.set()
        self.assertEqual(self.wait_for('complete'), {'state': 'complete', 'progress': 1})
        self.assertEqual(self.request('POST', payload=SAMPLE_INPUT)[0], 200)
        self.assertEqual(len(self.calls), 1)
        ebook, tracks, _ = self.calls[0]
        self.assertEqual(ebook, self.ebook)
        self.assertEqual([track.name for track in tracks], ['Chapter 1.mp3', 'Chapter 2.m4b'])
        self.assertEqual(self.request(suffix='/timings.json')[2]['pages'][0][0]['word'], 'Hi')
        status, metadata, body = self.request(suffix='/audio.mp3', headers={'Range': 'bytes=4-6'})
        self.assertEqual((status, metadata['Content-Range'], body), (206, 'bytes 4-6/10', b'567'))
        status, metadata, body = self.request('HEAD', '/audio.mp3', headers={'Range': 'bytes=-2'})
        self.assertEqual((status, metadata['Content-Range'], body), (206, 'bytes 8-9/10', b''))
        status, metadata, _ = self.request(suffix='/audio.mp3', headers={'Range': 'bytes=10-'})
        self.assertEqual((status, metadata['Content-Range']), (416, 'bytes */10'))
        self.assertEqual(self.request(suffix='/timings.json', revision='b' * 64)[0], 404)
        self.ebook.write_bytes(b'new ebook')
        self.assertEqual(self.request(suffix='/audio.mp3')[0], 404)
        self.assertEqual(self.request()[2]['state'], 'idle')

    def test_rejects_escape_and_unauthorized_requests(self):
        self.assertEqual(self.request(auth=None)[0], 401)
        self.assertEqual(self.request(auth='wrong-token')[0], 401)
        self.assertEqual(self.request(revision=None)[0], 400)
        self.assertEqual(self.request(revision='g' * 64)[0], 400)
        (self.library / 'escape.epub').symlink_to(self.outside)
        for ebook in ('/audiobooks/escape.epub', '/audiobooks/../private.epub', '/private.epub'):
            self.assertEqual(self.request('POST', payload={**SAMPLE_INPUT, 'ebook': ebook})[0], 422)
        self.assertFalse(self.started.is_set())

    def test_retries_a_failed_job(self):
        self.force_failure = True
        self.finish.set()
        self.assertEqual(self.request('POST', payload=SAMPLE_INPUT)[0], 202)
        self.wait_for('error')
        self.force_failure = False
        self.assertEqual(self.request('POST', payload=SAMPLE_INPUT)[0], 202)
        self.wait_for('complete')
        self.assertEqual(len(self.calls), 2)


if __name__ == '__main__':
    unittest.main()
