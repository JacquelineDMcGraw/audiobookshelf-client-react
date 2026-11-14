# Audiobookshelf React client

This is my fork of the Audiobookshelf React client. I added [self-hosted Read Along](self-hosted-read-along/README.md) to sync audiobook narration with EPUB or PDF text on your own server.

The upstream React client is in active development.

You can test using this docker image built for every commit:

```
ghcr.io/advplyr/audiobookshelf:v3
```

For testing, it is recommended that you use a separate config & libraries from your production server.

## Contributing

If you plan to contribute upstream, please read the [Audiobookshelf contribution guidelines](https://audiobookshelf.org/docs/contributing/general/). The upstream maintainers ask contributors to run and review their changes, author their own commits, and write their own PR and issue descriptions. They decline PRs and issues that are entirely AI-generated.

### How to run locally

This assumes that you have [audiobookshelf](https://github.com/advplyr/audiobookshelf) locally.

1. Clone my fork with `git clone https://github.com/JacquelineDMcGraw/audiobookshelf-client-react.git`.
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

### Self-hosted Read Along

Pair a DRM-free EPUB or text PDF with audiobook tracks in your library and sync them on your own machine. See the [setup guide and visual walkthrough](self-hosted-read-along/README.md).
