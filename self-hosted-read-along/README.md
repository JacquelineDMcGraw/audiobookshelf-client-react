# Self-hosted Read Along

Pair an EPUB or selectable-text PDF with one or more audiobook tracks in Audiobookshelf. The worker runs speech recognition and matches the narration to the ebook on your own machine. The browser reads the result through the signed-in Audiobookshelf client.

## Install

Use the React client from this branch with an Audiobookshelf server that supports the React client, as described in the [project setup](../README.md#how-to-run-locally). The stock Vue client and the GitHub Pages demo do not load the worker integration.

1. On the worker host, install Python 3.11 or 3.12, FFmpeg (including `ffprobe`), and Poppler (including `pdftotext`). Set up a virtual environment and install the worker dependencies:

   ```sh
   cd self-hosted-read-along
   python3 -m venv .venv
   . .venv/bin/activate
   python -m pip install -r requirements.txt
   ```

   See the [PyTorch installation guide](https://pytorch.org/get-started/locally/) if you need a CPU-only wheel for your platform.

2. Download a trusted [Whisper model](https://github.com/openai/whisper#available-models-and-languages) once during setup. For example:

   ```sh
   mkdir -p models
   python -c 'import whisper; whisper.load_model("base", device="cpu", download_root="models")'
   ```

   Use the downloaded model file directly. Sync does not download models or send media to a transcription service.

3. Generate a shared worker credential with `openssl rand -hex 32`. Set `READ_ALONG_WORKER_TOKEN` to that value in **both** server processes. Give the Audiobookshelf React server `READ_ALONG_WORKER_URL=http://127.0.0.1:8789`. Do not use client-side environment variables for the token.

4. Start the worker using absolute paths. Replace the example mount and state paths with your own:

   ```sh
   export READ_ALONG_MEDIA_ROOTS='{"/audiobooks":"/srv/books/audiobooks"}'
   export READ_ALONG_DATA_DIR="/srv/read-along/state"
   export READ_ALONG_MODEL_PATH="$PWD/models/base.pt"
   python service.py
   ```

   In this example, Audiobookshelf reports its files under `/audiobooks`, and the worker sees the same files under `/srv/books/audiobooks`. Add a mapping for each library folder workers should read. The worker needs read access to the model and media and write access to its separate state directory. Keep that state directory private because it contains extracted text, timing data, and a playback copy of each prepared audiobook.

   Run the worker on loopback when both processes are on the host. For separate containers, use a private container network, set `READ_ALONG_HOST=0.0.0.0` on the worker, and give the React server its private service URL instead. Leave the worker port unpublished and mount original media read-only where possible. Keep `READ_ALONG_WORKER_TOKEN` in local service configuration. Restart the React server after setting its variables.

## Pair and sync

1. From a book library, open **Upload** and use **Upload a Read Along pair**. Choose one EPUB or text PDF and the audiobook tracks, then follow Audiobookshelf’s normal upload review. Use a library folder the server can write to. Upload requires Audiobookshelf’s upload permission.
2. Open the combined item once Audiobookshelf indexes it. Existing library items with a supported primary ebook and audio can also be synced.
3. Click **Sync** and wait for **Word highlighting is ready**. Processing continues on the worker while you browse elsewhere. Return to the book for progress or to retry a failed sync.
4. Click **Read Along** on the book page. The reader follows the narration, turns pages, and can search the text. Its bookmarks are saved in the current browser for the signed-in account.

Use matching, unabridged editions for best results, and review track order in Audiobookshelf first. Scanned PDFs need a text layer from OCR before syncing. The reader paginates EPUB text and uses extracted text from PDFs. Words or pages with no reliable match stay readable. The worker prepares one book at a time, and CPU processing can take a while for long recordings. A stopped or failed job can be started again from the book page. The worker may need to process it from the beginning. Completed results are reused until the source files or their order change.

To run the worker tests from the repository root:

```sh
python3 -B -m unittest discover -s self-hosted-read-along -p 'test_*.py'
```
