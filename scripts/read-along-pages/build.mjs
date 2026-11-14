import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { demoBooks, getDemoAssetNames } from '../../src/app/(public)/read-along-demo/books.ts'

const [output, bundler] = process.argv.slice(2)
if (!output || !bundler) throw new Error('Usage: node scripts/read-along-pages/build.mjs <new-output-directory> <esbuild-module-path>')

const { build } = createRequire(import.meta.url)(resolve(bundler))
const root = fileURLToPath(new URL('../../', import.meta.url))
const outdir = resolve(output)
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const publicAssets = resolve(root, 'public/read-along-demo')
async function versioned(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex').slice(0, 16)
}
const bookAssets = {}
const files = new Set()
for (const { id } of demoBooks) {
  bookAssets[id] = {}
  for (const [kind, name] of Object.entries(getDemoAssetNames(id))) {
    if (!name) continue
    files.add(name)
    bookAssets[id][kind] = `./${name}?v=${await versioned(resolve(publicAssets, name))}`
  }
}

await mkdir(outdir)

const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: { demo: 'scripts/read-along-pages/main.tsx' },
  outdir,
  bundle: true,
  minify: true,
  jsx: 'automatic',
  target: 'es2022',
  define: {
    'process.env.NODE_ENV': '"production"',
    READ_ALONG_BOOK_ASSETS: JSON.stringify(bookAssets),
    READ_ALONG_SOURCE_URL: JSON.stringify(`https://github.com/JacquelineDMcGraw/audiobookshelf-client-react/tree/${revision}`)
  },
  legalComments: 'external',
  metafile: true,
  loader: { '.module.css': 'local-css' }
})

// Retain the notices for the dependencies actually bundled into the browser build.
const dependencyRoots = new Set(
  Object.keys(metafile.inputs).flatMap((file) => {
    const match = file.match(/^node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+/)
    return match ? [match[0]] : []
  })
)
const notices = await Promise.all(
  [...dependencyRoots].sort().map(async (dependency) => {
    const directory = join(root, dependency)
    const { name, version } = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const noticeFiles = (await readdir(directory)).filter((file) => /^(?:license|licence|notice)(?:\.|$)/i.test(file))
    if (!noticeFiles.length) throw new Error(`No license notice found for ${name}`)
    const contents = await Promise.all(noticeFiles.map((file) => readFile(join(directory, file), 'utf8')))
    return `${name} ${version}\n\n${contents.join('\n\n')}`
  })
)

const html = (await readFile(new URL('index.html', import.meta.url), 'utf8'))
  .replace('./demo.css', `./demo.css?v=${await versioned(resolve(outdir, 'demo.css'))}`)
  .replace('./demo.js', `./demo.js?v=${await versioned(resolve(outdir, 'demo.js'))}`)

await Promise.all([
  writeFile(resolve(outdir, 'index.html'), html),
  ...[...files].map((name) => copyFile(resolve(publicAssets, name), resolve(outdir, name))),
  copyFile(resolve(root, 'public/images/Logo.png'), resolve(outdir, 'audiobookshelf-logo.png')),
  copyFile(resolve(root, 'LICENSE'), resolve(outdir, 'LICENSE')),
  writeFile(resolve(outdir, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n---\n\n') + '\n'),
  writeFile(resolve(outdir, '.nojekyll'), '')
])
