'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { aliceChapters, alicePages } from './alice'
import styles from './read-along.module.css'

const chaptersByOpeningPage = new Map(aliceChapters.map((chapter) => [chapter.page, chapter]))
const pageStarts = alicePages.map((page, index) => {
  const start = chaptersByOpeningPage.get(index)?.start ?? page.find((word) => word.start !== undefined)?.start
  if (start === undefined) throw new Error(`Alice read-along page ${index + 1} needs a narration cue`)
  return start
})
const bookTitle = 'Alice’s Adventures in Wonderland'
const bookAuthor = 'Lewis Carroll'
const repositoryUrl = 'https://github.com/JacquelineDMcGraw/audiobookshelf-client-react'
const textSettingsGlyph = 'Aa'
const playbackSpeeds = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2]
const bookWords = alicePages.flatMap((words, page) => {
  // An unmatched printed word still belongs to the book and is searchable.
  // In that case playback starts at the nearest preceding cue on the page.
  let position = pageStarts[page]
  return words.map((word, index) => {
    position = word.start ?? position
    return { ...word, index, page, position }
  })
})
type BookWord = (typeof bookWords)[number]
const lastWordEnd = bookWords.findLast((word) => word.end !== undefined)?.end ?? 0
const pageParagraphs = alicePages.map<BookWord[][]>(() => [])
for (const word of bookWords) {
  const paragraphs = pageParagraphs[word.page]
  if (!paragraphs.length || word.paragraphStart) paragraphs.push([])
  paragraphs.at(-1)!.push(word)
}

const bookmarkKey = 'audiobookshelf:read-along:alice-full-v1:bookmarks'
const bookmarkEvent = 'audiobookshelf-read-along-bookmarks'
const emptyBookmarks = () => '[]'
let sessionBookmarks: string | null = null

function subscribeToBookmarks(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === bookmarkKey || event.key === null) onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(bookmarkEvent, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(bookmarkEvent, onChange)
  }
}

function readBookmarks() {
  try {
    return sessionBookmarks ?? window.localStorage.getItem(bookmarkKey) ?? emptyBookmarks()
  } catch {
    return sessionBookmarks ?? emptyBookmarks()
  }
}

function parseBookmarks(raw: string): number[] {
  try {
    const values: unknown = JSON.parse(raw)
    return Array.isArray(values) ? values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0) : []
  } catch {
    return []
  }
}

function getAudioPage(position: number) {
  return Math.max(
    0,
    pageStarts.findLastIndex((start) => start <= position)
  )
}

function clock(seconds: number) {
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = String(Math.floor(whole / 60) % 60)
  const remaining = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${minutes.padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`
}

function DemoLibrary({ duration, onRead, headingRef }: { duration: number; onRead: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const t = useTranslations()

  return (
    <main className={`${styles.demo} ${styles.library}`}>
      <header className={styles.libraryHeader}>
        <a href={repositoryUrl} className={styles.repoLink}>
          <span aria-hidden="true">← </span>
          {t('LabelReadAlongDemoBackToRepo')}
        </a>
        <h1 ref={headingRef} tabIndex={-1}>
          {t('LabelReadAlongDemoLibrary')}
        </h1>
      </header>
      <section className={styles.shelf} aria-label={t('LabelReadAlongDemoLibrary')}>
        <article className={styles.libraryBook}>
          <div className={styles.cover} aria-hidden="true">
            <span>A</span>
          </div>
          <div className={styles.libraryBookInfo}>
            <h2>{bookTitle}</h2>
            <p className={styles.muted}>{bookAuthor}</p>
            <p className={styles.muted}>{clock(duration)}</p>
            <button type="button" onClick={onRead}>
              {t('LabelReadAlongDemo')}
            </button>
          </div>
        </article>
      </section>
    </main>
  )
}

export default function ReadAlongDemo({ audioSrc, credits }: { audioSrc: string; credits?: ReactNode }) {
  const t = useTranslations()
  const audioRef = useRef<HTMLAudioElement>(null)
  const searchRef = useRef<HTMLDialogElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const leafRef = useRef<HTMLElement>(null)
  const readerHeadingRef = useRef<HTMLHeadingElement>(null)
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null)
  const hasNavigated = useRef(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [time, setTime] = useState(0)
  const [manualPage, setManualPage] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const serializedBookmarks = useSyncExternalStore(subscribeToBookmarks, readBookmarks, emptyBookmarks)
  const bookmarks = useMemo(() => parseBookmarks(serializedBookmarks), [serializedBookmarks])
  const [bookmarkStatus, setBookmarkStatus] = useState('')
  const [largePrint, setLargePrint] = useState(false)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchMatch, setSearchMatch] = useState<BookWord | null>(null)
  const [duration, setDuration] = useState(lastWordEnd)
  const audioPage = getAudioPage(time)
  const page = manualPage ?? audioPage
  const openingChapter = chaptersByOpeningPage.get(page)
  const activeChapter = aliceChapters.findLast((chapter) => chapter.page <= page)
  const activeWord = alicePages[page].findIndex(({ start, end }) => start !== undefined && end !== undefined && time >= start && time < end)
  const matchingWords = useMemo(() => (submittedQuery ? bookWords.filter((word) => word.word.toLowerCase().includes(submittedQuery)) : []), [submittedQuery])
  const pageOptions = useMemo(
    () =>
      pageStarts.map((start, index) => (
        <option key={start} value={index}>
          {t('LabelPlayerChapterNumberMarker', { 0: index + 1, 1: pageStarts.length })}
        </option>
      )),
    [t]
  )

  useEffect(() => {
    if (hasNavigated.current) (showLibrary ? libraryHeadingRef : readerHeadingRef).current?.focus()
  }, [showLibrary])

  useEffect(() => {
    if (!playing && searchMatch === null) return
    const marker = leafRef.current?.querySelector(searchMatch === null ? '[aria-current="true"]' : '[data-match="true"]')
    marker?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeWord, playing, searchMatch])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let frame = 0
    const follow = () => {
      setTime(audio.currentTime)
      frame = audio.paused || audio.ended ? 0 : requestAnimationFrame(follow)
    }
    const startFollowing = () => {
      cancelAnimationFrame(frame)
      follow()
    }
    audio.addEventListener('playing', startFollowing)
    return () => {
      cancelAnimationFrame(frame)
      audio.removeEventListener('playing', startFollowing)
    }
  }, [])

  function seek(position: number) {
    const player = audioRef.current
    if (!player) return
    const duration = Number.isFinite(player.duration) ? player.duration : lastWordEnd
    const nextTime = Math.max(0, Math.min(position, duration))
    player.currentTime = nextTime
    setSearchMatch(null)
    setTime(nextTime)
  }

  function turnPage(next: number) {
    if (next < 0 || next >= alicePages.length) return
    if (manualPage !== null) setManualPage(next)
    seek(pageStarts[next])
  }

  function jumpFromMenu(next: number, menu: HTMLDetailsElement | null) {
    turnPage(next)
    closeReadingMenu(menu)
  }

  function closeReadingMenu(menu: HTMLDetailsElement | null) {
    if (menu) {
      menu.open = false
      menu.querySelector('summary')?.focus({ preventScroll: true })
    }
    frameRef.current?.scrollTo({ top: 0 })
  }

  function startAudio() {
    void audioRef.current?.play().catch(() => setAudioFailed(true))
  }

  function playFromHere() {
    if (page !== audioPage) seek(pageStarts[page])
    setManualPage(null)
    startAudio()
  }

  function saveBookmark() {
    const position = time
    const savedBookmarks = parseBookmarks(readBookmarks())
    if (savedBookmarks.some((saved) => Math.floor(saved) === Math.floor(position))) {
      setBookmarkStatus(t('LabelReadAlongDemoAlreadySaved'))
      return
    }
    const updated = JSON.stringify([...savedBookmarks, position])
    try {
      window.localStorage.setItem(bookmarkKey, updated)
      sessionBookmarks = null
      setBookmarkStatus(t('LabelReadAlongDemoBookmarkSaved'))
    } catch {
      sessionBookmarks = updated
      setBookmarkStatus(t('LabelReadAlongDemoBookmarkSavedSession'))
    }
    window.dispatchEvent(new Event(bookmarkEvent))
  }

  const reader = (
    <main className={styles.demo} hidden={showLibrary}>
      <header className={styles.header}>
        <button
          type="button"
          onClick={() => {
            audioRef.current?.pause()
            hasNavigated.current = true
            setShowLibrary(true)
          }}
        >
          ← {t('LabelReadAlongDemoBack')}
        </button>
        <h1 className={styles.headerTitle} ref={readerHeadingRef} tabIndex={-1}>
          {t('LabelReadAlongDemo')}
        </h1>
        <button className={styles.playToggle} type="button" onClick={() => (playing ? audioRef.current?.pause() : startAudio())}>
          {t(playing ? 'LabelReadAlongDemoPauseAudio' : 'LabelReadAlongDemoPlayAudio')}
        </button>
      </header>

      <div className={styles.frame} ref={frameRef}>
        <div className={styles.bookHeader}>
          <p className={styles.muted}>{t('LabelReadAlongDemoTiming', { time: clock(lastWordEnd) })}</p>
          <button type="button" aria-haspopup="dialog" onClick={() => searchRef.current?.showModal()}>
            {t('ButtonSearch')}
          </button>
        </div>
        <div className={styles.toolbar}>
          <nav className={styles.pageNav} aria-label={t('LabelReadAlongDemoPages')}>
            <button type="button" aria-label={t('ButtonPrevious')} disabled={page === 0} onClick={() => turnPage(page - 1)}>
              ‹
            </button>
            <label htmlFor="sample-page">{t('LabelReadAlongDemoPage')}</label>
            <select id="sample-page" value={page} onChange={(event) => turnPage(Number(event.target.value))}>
              {pageOptions}
            </select>
            <button type="button" aria-label={t('ButtonNext')} disabled={page === alicePages.length - 1} onClick={() => turnPage(page + 1)}>
              ›
            </button>
          </nav>
          <label className={styles.check}>
            <input type="checkbox" checked={manualPage === null} onChange={(event) => setManualPage(event.target.checked ? null : page)} />
            {t('LabelReadAlongDemoFollow')}
          </label>
        </div>
        <nav className={styles.tools} aria-label={t('LabelReadAlongDemoTools')}>
          <details className={styles.tool} name="demo-reading-tools">
            <summary>{t('LabelReadAlongDemoContents')}</summary>
            <div className={styles.panel}>
              <button type="button" lang="en" onClick={(event) => jumpFromMenu(0, event.currentTarget.closest('details'))}>
                {bookTitle}
              </button>
            </div>
          </details>
          <details className={styles.tool} name="demo-reading-tools">
            <summary>{t('LabelChapters')}</summary>
            <div className={styles.panel}>
              {aliceChapters.map((chapter, index) => (
                <button
                  key={chapter.page}
                  className={styles.chapterChoice}
                  type="button"
                  lang="en"
                  aria-current={activeChapter === chapter || undefined}
                  onClick={(event) => jumpFromMenu(chapter.page, event.currentTarget.closest('details'))}
                >
                  <span>
                    {index + 1}. {chapter.title}
                  </span>
                  <span className={styles.chapterPosition}>{clock(chapter.start)}</span>
                </button>
              ))}
            </div>
          </details>
          <details className={styles.tool} name="demo-reading-tools">
            <summary>{t('LabelReadAlongDemoBookmarks')}</summary>
            <div className={styles.panel}>
              {bookmarks.length ? (
                bookmarks.map((position) => (
                  <button
                    key={position}
                    className={styles.chapterChoice}
                    type="button"
                    onClick={(event) => {
                      setManualPage(null)
                      seek(position)
                      closeReadingMenu(event.currentTarget.closest('details'))
                    }}
                  >
                    <span>{t('LabelReadAlongDemoBookmarkLocation', { page: getAudioPage(position) + 1 })}</span>
                    <span className={styles.chapterPosition}>{clock(position)}</span>
                  </button>
                ))
              ) : (
                <p>{t('LabelReadAlongDemoNoBookmarks')}</p>
              )}
            </div>
          </details>
          <details className={styles.tool} name="demo-reading-tools">
            <summary aria-label={t('LabelReadAlongDemoDisplay')}>{textSettingsGlyph}</summary>
            <div className={styles.panel}>
              <label className={styles.check}>
                <input type="checkbox" checked={largePrint} onChange={(event) => setLargePrint(event.target.checked)} />
                {t('LabelReadAlongDemoLargePrint')}
              </label>
            </div>
          </details>
        </nav>
        <div className={styles.pageActions}>
          <p className={styles.muted}>{t(manualPage === null ? 'LabelReadAlongDemoFollowing' : 'LabelReadAlongDemoManual')}</p>
          <button type="button" onClick={playFromHere}>
            {t(searchMatch !== null ? 'LabelReadAlongDemoPlayMatch' : 'LabelReadAlongDemoPlayHere')}
          </button>
        </div>
        <article className={styles.leaf} ref={leafRef} data-size={largePrint ? 'large' : undefined} lang="en">
          <header className={styles.runningHead}>{bookTitle}</header>
          {openingChapter && <h2 className={styles.chapter}>{openingChapter.title}</h2>}
          <div className={styles.passage}>
            {pageParagraphs[page].map((paragraph) => (
              <p key={paragraph[0].index}>
                {paragraph.map((word, index) => (
                  <span key={word.index}>
                    {index > 0 && word.lineStart && <br />}
                    <span aria-current={word.index === activeWord ? 'true' : undefined} data-match={searchMatch === word || undefined}>
                      {word.word}
                    </span>
                    {index < paragraph.length - 1 && !paragraph[index + 1].lineStart && ' '}
                  </span>
                ))}
              </p>
            ))}
          </div>
          <footer className={styles.folio}>{page + 1}</footer>
        </article>
        <div className={styles.credits}>
          <a href="https://www.gutenberg.org/ebooks/11">{t('LabelReadAlongDemoTextCredit')}</a>
          <a href="https://librivox.org/alices-adventures-in-wonderland-by-lewis-carroll-3/">{t('LabelReadAlongDemoAudioCredit')}</a>
          {credits}
        </div>
      </div>

      <section className={styles.player} aria-label={t('LabelReadAlongDemoNarration')}>
        <div className={styles.playerInner}>
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            aria-label={t('LabelReadAlongDemoNarration')}
            src={audioSrc}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onSeeking={(event) => {
              const position = event.currentTarget.currentTime
              setTime(position)
              setSearchMatch((match) => (match !== null && Math.abs(match.position - position) < 0.01 ? match : null))
            }}
            onPlay={() => {
              setPlaying(true)
              setSearchMatch(null)
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setAudioFailed(true)}
          />
          <div className={styles.playerBar}>
            <div>
              <button type="button" aria-label={t('LabelReadAlongDemoBackThirty')} onClick={() => seek(time - 30)}>
                −30
              </button>{' '}
              <button type="button" aria-label={t('LabelReadAlongDemoForwardThirty')} onClick={() => seek(time + 30)}>
                +30
              </button>
            </div>
            <button type="button" onClick={saveBookmark}>
              {t('LabelReadAlongDemoSaveBookmark')}
            </button>
            <span className={styles.muted}>{t('LabelPlayerChapterNumberMarker', { 0: clock(time), 1: clock(duration) })}</span>
            <details className={styles.tool}>
              <summary>{t('LabelReadAlongDemoAudioOptions')}</summary>
              <div className={styles.panel}>
                <label htmlFor="sample-speed">{t('LabelReadAlongDemoSpeed')}</label>
                <select
                  id="sample-speed"
                  defaultValue={1}
                  onChange={(event) => {
                    if (audioRef.current) audioRef.current.playbackRate = Number(event.target.value)
                  }}
                >
                  {playbackSpeeds.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}×
                    </option>
                  ))}
                </select>
              </div>
            </details>
          </div>
          {bookmarkStatus && (
            <p className={styles.muted} role="status">
              {bookmarkStatus}
            </p>
          )}
          {audioFailed && <p role="alert">{t('LabelReadAlongDemoAudioError')}</p>}
        </div>
      </section>

      <dialog className={styles.searchDialog} ref={searchRef} aria-labelledby="sample-search-title">
        <div className={styles.searchHeader}>
          <h2 id="sample-search-title">{t('ButtonSearch')}</h2>
          <button type="button" onClick={() => searchRef.current?.close()}>
            {t('ButtonClose')}
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSubmittedQuery(query.trim().toLowerCase())
          }}
        >
          <label htmlFor="sample-search">{t('LabelSearchTerm')}</label>
          <input id="sample-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit">{t('ButtonSearch')}</button>
        </form>
        <div className={styles.searchResults}>
          {matchingWords.map((result) => (
            <button
              key={`${result.page}-${result.index}`}
              type="button"
              onClick={() => {
                audioRef.current?.pause()
                setManualPage(null)
                seek(result.position)
                setSearchMatch(result)
                searchRef.current?.close()
              }}
            >
              <span lang="en">{result.word}</span> · {clock(result.position)}
            </button>
          ))}
          {submittedQuery && !matchingWords.length && <p role="status">{t('LabelReadAlongDemoNoMatches')}</p>}
        </div>
      </dialog>
    </main>
  )

  return (
    <>
      {reader}
      {showLibrary && <DemoLibrary duration={duration} onRead={() => setShowLibrary(false)} headingRef={libraryHeadingRef} />}
    </>
  )
}
