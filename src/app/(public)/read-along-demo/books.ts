export type DemoWord = { word: string; start?: number; end?: number; paragraphStart?: true; lineStart?: true }
export type DemoChapter = { title: string; page: number; start: number }
export type DemoBookText = { chapters: readonly DemoChapter[]; pages: readonly (readonly DemoWord[])[] }

export const demoBooks = [
  {
    id: 'alice',
    title: 'Alice’s Adventures in Wonderland', // i18n-ignore: original book title
    author: 'Lewis Carroll',
    year: 1865,
    narrator: 'Peter Yearsley',
    textCredit: 'https://www.gutenberg.org/ebooks/11',
    audioCredit: 'https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll-3/'
  },
  {
    id: 'wizard-of-oz',
    title: 'The Wonderful Wizard of Oz', // i18n-ignore: original book title
    author: 'L. Frank Baum',
    year: 1900,
    narrator: 'Lyn Stanley',
    descriptionKey: 'LabelReadAlongDemoOzDescription',
    textCredit: 'https://www.gutenberg.org/ebooks/43936',
    audioCredit: 'https://librivox.org/the-wonderful-wizard-of-oz-version-7-by-l-frank-baum/'
  },
  {
    id: 'yellow-wallpaper',
    title: 'The Yellow Wallpaper', // i18n-ignore: original book title
    author: 'Charlotte Perkins Gilman',
    year: 1892,
    narrator: 'Anna Shirey',
    descriptionKey: 'LabelReadAlongDemoWallpaperDescription',
    textCredit: 'https://www.gutenberg.org/ebooks/1952',
    audioCredit: 'https://librivox.org/short-story-collection-108-by-various/'
  }
] as const

export type DemoBook = (typeof demoBooks)[number]
export type DemoBookId = DemoBook['id']
export type DemoBookAssets = { audio: string; cover: string; text?: string }

export function getDemoAssetNames(id: DemoBookId): DemoBookAssets {
  return { audio: `${id}.mp3`, cover: `${id}-cover.jpg`, text: id === 'alice' ? undefined : `${id}.json` }
}
