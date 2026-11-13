import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import ReadAlongDemo from './ReadAlongDemo'

export const metadata: Metadata = {
  title: 'Read Along Demo | Audiobookshelf' // i18n-ignore
}

export default function ReadAlongDemoPage() {
  if (process.env.READ_ALONG_DEMO !== '1') notFound()
  return <ReadAlongDemo />
}
