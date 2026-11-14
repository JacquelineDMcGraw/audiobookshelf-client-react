export type ReadAlongWord = { word: string; start?: number; end?: number; paragraphStart?: true; lineStart?: true }
export type ReadAlongChapter = { title: string; page: number; start: number }
export type ReadAlongText = {
  chapters: readonly ReadAlongChapter[]
  pages: readonly (readonly ReadAlongWord[])[]
  /** Untimed pages are still selectable with the reader's page controls. */
  pageStarts?: readonly (number | null)[]
}
