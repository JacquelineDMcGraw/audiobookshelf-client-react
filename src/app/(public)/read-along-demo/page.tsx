import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withBasePath } from '@/lib/basePath'

import { demoBooks, getDemoAssetNames, type DemoBookAssets, type DemoBookId } from './books'
import DemoLibrary from './DemoLibrary'

export const metadata: Metadata = {
  title: 'Read Along Demo | Audiobookshelf' // i18n-ignore
}

export default function ReadAlongDemoPage() {
  if (process.env.READ_ALONG_DEMO !== '1') notFound()

  const assets = {} as Record<DemoBookId, DemoBookAssets>
  for (const { id } of demoBooks) {
    const { audio, cover, text } = getDemoAssetNames(id)
    assets[id] = {
      audio: withBasePath(`/read-along-demo/${audio}`),
      cover: withBasePath(`/read-along-demo/${cover}`),
      text: text ? withBasePath(`/read-along-demo/${text}`) : undefined
    }
  }
  return <DemoLibrary assets={assets} logoSrc={withBasePath('/images/Logo.png')} />
}
