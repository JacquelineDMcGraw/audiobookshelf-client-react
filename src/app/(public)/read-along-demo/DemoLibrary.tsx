'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import { aliceChapters, alicePages } from './alice'
import { demoBooks, type DemoBook, type DemoBookAssets, type DemoBookId, type DemoBookText } from './books'
import ReadAlongDemo from './ReadAlongDemo'
import styles from './read-along.module.css'

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function readRoute() {
  const route = window.location.hash.slice(1)
  return route === 'library' || demoBooks.some(({ id }) => id === route) ? route : 'alice'
}

const readServerRoute = () => 'alice'
const aliceText = { chapters: aliceChapters, pages: alicePages }

export function DemoHeader({ logoSrc }: { logoSrc: string }) {
  const t = useTranslations()
  return (
    <header className={styles.appHeader}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoSrc} width={36} height={36} alt="" />
      <span>audiobookshelf</span>
      <a className={styles.libraryLink} href="#library">
        {t('LabelReadAlongDemoLibrary')}
      </a>
    </header>
  )
}

type DemoLibraryProps = { assets: Record<DemoBookId, DemoBookAssets>; logoSrc: string; credits?: ReactNode }

export default function DemoLibrary({ assets, logoSrc, credits }: DemoLibraryProps) {
  const t = useTranslations()
  const route = useSyncExternalStore(subscribe, readRoute, readServerRoute)
  const book = demoBooks.find(({ id }) => id === route)
  const [libraryHeading, setLibraryHeading] = useState<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (route === 'library') libraryHeading?.focus()
  }, [route, libraryHeading])

  if (book) return <BookRoute key={book.id} book={book} assets={assets[book.id]} logoSrc={logoSrc} credits={credits} />

  return (
    <div className={styles.demo}>
      <DemoHeader logoSrc={logoSrc} />
      <main className={styles.bookDetailScroll}>
        <section className={styles.catalog}>
          <h1 ref={setLibraryHeading} tabIndex={-1}>
            {t('LabelReadAlongDemoLibrary')}
          </h1>
          <ul className={styles.catalogGrid}>
            {demoBooks.map(({ id, title, author }) => (
              <li key={id}>
                <a href={`#${id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assets[id].cover} alt="" />
                  <strong>{title}</strong>
                </a>
                <p>{author}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}

function BookRoute({ book, assets, logoSrc, credits }: Omit<DemoLibraryProps, 'assets'> & { book: DemoBook; assets: DemoBookAssets }) {
  const t = useTranslations()
  const [text, setText] = useState<DemoBookText | null>(book.id === 'alice' ? aliceText : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!assets.text) return
    const request = new AbortController()
    fetch(assets.text, { signal: request.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Timing data returned HTTP ${response.status}`)
        return response.json() as Promise<DemoBookText>
      })
      .then(setText)
      .catch(() => {
        if (!request.signal.aborted) setFailed(true)
      })
    return () => request.abort()
  }, [assets.text])

  if (text) {
    return (
      <ReadAlongDemo book={book} text={text} audioSrc={assets.audio} coverSrc={assets.cover} appHeader={<DemoHeader logoSrc={logoSrc} />} credits={credits} />
    )
  }

  return (
    <div className={styles.demo}>
      <DemoHeader logoSrc={logoSrc} />
      <main className={styles.bookDetailScroll}>
        <div className={styles.catalog}>
          <h1>{book.title}</h1>
          <p role={failed ? 'alert' : 'status'}>{t(failed ? 'LabelReadAlongDemoBookLoadError' : 'LabelReadAlongDemoLoadingBook')}</p>
        </div>
      </main>
    </div>
  )
}
