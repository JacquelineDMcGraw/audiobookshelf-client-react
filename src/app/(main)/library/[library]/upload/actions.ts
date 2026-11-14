'use server'

import * as api from '@/lib/api'
import { isReadAlongConfigured } from '@/lib/readAlongConfig'
import { userCanUpload } from '@/lib/userPermissions'
import type { BookMedia, BookSearchResult, PodcastSearchResult } from '@/types/api'

export async function fetchBookMetadata(title: string, author: string, provider: string): Promise<BookSearchResult[]> {
  console.error('Fetching book metadata for:', { title, author, provider })
  return api.searchBooks(provider, title, author)
}

export async function fetchPodcastMetadata(title: string): Promise<PodcastSearchResult[]> {
  return api.searchPodcasts(title)
}

export async function checkUploadPathExists(directory: string, folderPath: string) {
  return api.checkFilesystemPathExists(directory, folderPath)
}

export async function findUploadedReadAlongBook(libraryId: string, folderId: string, directory: string, audioCount: number) {
  if (!isReadAlongConfigured() || !Number.isSafeInteger(audioCount) || audioCount < 1 || !directory || directory.length > 1024) return null
  const currentUser = await api.getCurrentUser()
  if (!currentUser?.user || !userCanUpload(currentUser.user)) return null

  // Native upload returns before the scanner creates the library item. Match its
  // folder and exact relative path, even if the scanner discovers a different title in the tags.
  const response = await api.getLibraryItems(libraryId, 'sort=addedAt&desc=1&limit=30')
  const match = response.results.find((item) => {
    const relativePath = item.relPath
      ?.replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .normalize('NFC')
    return item.folderId === folderId && relativePath === directory
  })
  if (!match) return null

  const item = await api.getLibraryItem(match.id, true)
  if (item.mediaType !== 'book' || item.isMissing || item.isInvalid) return null
  const { ebookFile, tracks } = item.media as BookMedia
  if (!/\.(epub|pdf)$/i.test(ebookFile?.metadata.path ?? '') || (tracks?.length ?? 0) !== audioCount) return null
  return item.id
}
