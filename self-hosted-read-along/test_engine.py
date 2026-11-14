"""Verify timing data and local-only input handling without loading a speech model."""

from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from engine import EngineError, _encode_audio, _reader_book, generate


class EngineTest(unittest.TestCase):
    def test_unspoken_pages_remain_readable_with_no_invented_word_times(self):
        document = [
            {"chapter": "Foreword", "words": [{"text": "Unspoken"}]},
            {"chapter": "Chapter 1", "words": [
                {"text": "These"}, {"text": "stones"}, {"text": "may"},
                {"text": "be"}, {"text": "useful"},
            ]},
            {"words": []},
        ]
        transcript = [
            {"word": word, "start": index + 2, "end": index + 2.5}
            for index, word in enumerate(("These", "stones", "may", "be", "useful"))
        ]
        result = _reader_book(document, transcript)
        self.assertEqual(result["pageStarts"], [None, 2, None])
        self.assertEqual(result["chapters"], [
            {"title": "Foreword", "page": 0, "start": 2},
            {"title": "Chapter 1", "page": 1, "start": 2},
        ])
        self.assertEqual(result["pages"][0], [{"word": "Unspoken"}])
        self.assertEqual(result["pages"][-1], [])
        self.assertEqual(result["coverage"], {"matched": 5, "total": 6})

    def test_different_narration_reports_an_edition_mismatch(self):
        document = [{"words": [{"text": "A"}, {"text": "spotted"}, {"text": "owl"}]}]
        transcript = [{"word": "river", "start": 0, "end": 1}]
        with self.assertRaises(EngineError) as context:
            _reader_book(document, transcript)
        self.assertEqual(context.exception.code, "edition-mismatch")

    def test_epub_does_not_read_a_spine_document_from_a_url(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            ebook = root / "Book.epub"
            marker = root / "unused"
            marker.touch()
            with ZipFile(ebook, "w") as book:
                book.writestr(
                    "META-INF/container.xml",
                    '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
                )
                book.writestr(
                    "book.opf",
                    '<package><manifest><item id="page" media-type="application/xhtml+xml" '
                    'href="https://example.invalid/page.xhtml"/></manifest>'
                    '<spine><itemref idref="page"/></spine></package>',
                )
            with self.assertRaises(EngineError) as context:
                generate(ebook, [marker], root / "output.mp3", marker)
            self.assertEqual(context.exception.code, "unreadable-ebook")

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg unavailable")
    def test_spoofed_media_does_not_open_playlist_refs(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            playlist = root / "Track.mp3"
            playlist.write_text("#EXTM3U\nhttps://example.invalid/audio.mp3\n")
            with self.assertRaises(EngineError) as context:
                _encode_audio([playlist], root / "output.mp3")
            self.assertEqual(context.exception.code, "audio-unavailable")


if __name__ == "__main__":
    unittest.main()
