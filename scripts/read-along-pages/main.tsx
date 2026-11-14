import { NextIntlClientProvider } from 'next-intl'
import { createRoot } from 'react-dom/client'

import type { DemoBookAssets, DemoBookId } from '../../src/app/(public)/read-along-demo/books'
import DemoLibrary from '../../src/app/(public)/read-along-demo/DemoLibrary'
import enUS from '../../src/locales/en-us.json'
import './reset.css'

declare const READ_ALONG_SOURCE_URL: string
declare const READ_ALONG_BOOK_ASSETS: Record<DemoBookId, DemoBookAssets>

const sharedLabels = new Set([
  'ButtonClose',
  'ButtonNext',
  'ButtonPause',
  'ButtonPlay',
  'ButtonPrevious',
  'ButtonSearch',
  'LabelByAuthor',
  'LabelChapters',
  'LabelDuration',
  'LabelLanguage',
  'LabelNarrators',
  'LabelPlayerChapterNumberMarker',
  'LabelPublishYear',
  'LabelSearchTerm',
  'LabelStart',
  'LabelTitle'
])
const messages = Object.fromEntries(Object.entries(enUS).filter(([key]) => key.startsWith('LabelReadAlongDemo') || sharedLabels.has(key)))

createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
    <DemoLibrary
      assets={READ_ALONG_BOOK_ASSETS}
      logoSrc="./audiobookshelf-logo.png"
      credits={
        <>
          <a href={READ_ALONG_SOURCE_URL}>Source code</a>
          <a href="./LICENSE">License</a>
          <a href="./THIRD-PARTY-NOTICES.txt">Dependency notices</a>
        </>
      }
    />
  </NextIntlClientProvider>
)
