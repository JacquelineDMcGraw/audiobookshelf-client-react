import { NextIntlClientProvider } from 'next-intl'
import { createRoot } from 'react-dom/client'

import ReadAlongDemo from '../../src/app/(public)/read-along-demo/ReadAlongDemo'
import enUS from '../../src/locales/en-us.json'
import './reset.css'

declare const READ_ALONG_SOURCE_URL: string
declare const READ_ALONG_AUDIO_URL: string

const sharedLabels = new Set([
  'ButtonClose',
  'ButtonNext',
  'ButtonPrevious',
  'ButtonSearch',
  'LabelChapters',
  'LabelPlayerChapterNumberMarker',
  'LabelSearchTerm'
])
const messages = Object.fromEntries(Object.entries(enUS).filter(([key]) => key.startsWith('LabelReadAlongDemo') || sharedLabels.has(key)))

createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
    <ReadAlongDemo
      audioSrc={READ_ALONG_AUDIO_URL}
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
