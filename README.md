# NextJs client for audiobookshelf

This web client is in active development and will replace the current VueJS web client.

You can test using this docker image built for every commit:

```
ghcr.io/advplyr/audiobookshelf:v3
```

For testing, it is recommended that you use a separate config & libraries from your production server.

## Contributing

Please carefully read our [contribution guidelines](https://audiobookshelf.org/docs/contributing/general/) before starting starting to work on code.

Note especially the AI tools section: **_We do not accept or review PRs or issues that are fully AI-generated_**. You can use AI tools, but:

- You must run and review the changes you made on a dev server.
- You must read and review your code carefully. Commits should be authored by **_you_**, not your tools.
- PR/Issue description and comments should be **_yours_**. We want to communicate with you, not your tools.

### How to run locally

This assumes that you have [audiobookshelf](https://github.com/advplyr/audiobookshelf) locally.

1. git clone https://github.com/audiobookshelf/audiobookshelf-client-react.git
2. install dependencies: `cd audiobookshelf-client-react && pnpm i`
3. Start the audiobookshelf server with the `REACT_CLIENT_PATH` env variable set to this project path. Or in the `dev.js` file add `ReactClientPath` to config.
4. In the audiobookshelf server repo run with `npm run dev` as usual. This will serve the NextJS app using HMR.

If you access the dev app through a reverse proxy (not `localhost`), add `AllowedDevOrigins` to your audiobookshelf `dev.js` (mapped to `ALLOWED_DEV_ORIGINS` in `index.js`). Restart the dev server after changing it.

```js
// example dev.js file in audiobookshelf
const Path = require('path')

module.exports.config = {
  ConfigPath: Path.resolve('config'),
  MetadataPath: Path.resolve('metadata'),
  ReactClientPath: Path.resolve('../audiobookshelf-client-react'),
  AllowedDevOrigins: ['your-reverse-proxy-host.example.com']
}
```

### Running in prod

1. `pnpm run build` this NextJS app
2. Start the audiobookshelf server with `npm run start-dev` (uses the dev.js file w/ production)

### Read Along demo

After installing the client dependencies, start the standalone preview:

```sh
HOST=127.0.0.2 READ_ALONG_DEMO=1 pnpm dev --hostname 127.0.0.1 --port 3015
```

Open [Read Along Demo](http://127.0.0.1:3015/read-along-demo) and select **Demo library** to choose a book. Open **Read Along** on its book page and play the narration to see word highlighting and automatic page turns. **Chapters** jumps to a chapter in both the text and audio. Turn off **Follow audio** to browse pages independently, then select **Play from here** to resume at the displayed page.

The demo runs without an Audiobookshelf server or account and uses these complete public-domain editions and recordings:

| Book | Text | Narration |
| --- | --- | --- |
| _Alice’s Adventures in Wonderland_ | [Project Gutenberg #11](https://www.gutenberg.org/ebooks/11) | [Peter Yearsley, LibriVox](https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll-3/) |
| _The Wonderful Wizard of Oz_ | [Project Gutenberg #43936](https://www.gutenberg.org/ebooks/43936) | [Lyn Stanley, LibriVox](https://librivox.org/the-wonderful-wizard-of-oz-version-7-by-l-frank-baum/) |
| _The Yellow Wallpaper_ | [Project Gutenberg #1952](https://www.gutenberg.org/ebooks/1952) | [Anna Shirey, LibriVox track 19](https://librivox.org/short-story-collection-108-by-various/) |

Use **Search** to find words or phrases and play from a match. Use **Save bookmark** in the player and **Bookmarks** in the reading toolbar to return to a saved timestamp or delete a bookmark. Each book has its own bookmarks in the current browser. The extra loopback address keeps backend requests from other routes separate from the preview listener.

The [public Read Along demo](https://jacquelinedmcgraw.github.io/audiobookshelf-client-react/) is hosted on GitHub Pages. To rebuild the static site after installing the client dependencies, run:

```sh
tools_dir="$(mktemp -d)"
npm install --prefix "$tools_dir" --ignore-scripts esbuild@0.27.7
node scripts/read-along-pages/build.mjs ./out "$tools_dir/node_modules/esbuild"
```

Use a new output directory for each build. The export uses relative asset links and includes the demo, book covers, narration, timing data, the Audiobookshelf logo, and license files.
