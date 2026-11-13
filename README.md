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

Open [Read Along Demo](http://127.0.0.1:3015/read-along-demo). Play the sample narration to see word highlighting and automatic page turns. Previous and Next also seek the narration to the selected page.

The demo uses a bundled excerpt from *Alice’s Adventures in Wonderland* by Lewis Carroll, with precomputed word timings. It runs without an Audiobookshelf server or account. The extra loopback address keeps backend requests from other routes separate from the preview listener. The [Project Gutenberg text](https://www.gutenberg.org/ebooks/11) and [LibriVox recording by Peter Yearsley](https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll-3/) are public domain in the United States.
