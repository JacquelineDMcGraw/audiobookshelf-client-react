import { createHash } from 'node:crypto'
import type { BookLibraryItem, FileMetadata, LibraryItem } from '@/types/api'

type MediaRecord = { ino: string; metadata: FileMetadata }

function fileIdentity(file: MediaRecord) {
  const { path, size, mtimeMs, ctimeMs } = file.metadata
  return [file.ino, path, size, mtimeMs, ctimeMs]
}

/** Only prepare a primary ebook and playable tracks that Audiobookshelf lists on this item. */
export function getReadAlongPair(item: LibraryItem) {
  if (item.mediaType !== 'book' || item.isMissing || item.isInvalid || !item.media) return null

  const { ebookFile, audioFiles } = (item as BookLibraryItem).media
  if (!ebookFile?.metadata?.path || !/\.(epub|pdf)$/i.test(ebookFile.metadata.path) || !Array.isArray(audioFiles)) return null

  const tracks = audioFiles
    .filter((track) => !track.exclude && !track.error && Number.isFinite(track.duration) && track.duration > 0)
    .sort((a, b) => a.index - b.index)
  if (!tracks.length) return null

  const registered = new Set((item.libraryFiles ?? []).map((file) => JSON.stringify([file.ino, file.metadata?.path])))
  const files: MediaRecord[] = [ebookFile, ...tracks]
  if (files.some((file) => !file.metadata?.path || !registered.has(JSON.stringify([file.ino, file.metadata.path])))) return null

  return {
    ebook: ebookFile.metadata.path,
    audio: tracks.map((track) => track.metadata.path),
    revision: createHash('sha256')
      .update(JSON.stringify(files.map(fileIdentity)))
      .digest('hex')
  }
}
