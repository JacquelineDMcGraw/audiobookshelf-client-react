'use client'

import { useTranslations } from 'next-intl'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { aliceChapters, alicePages } from './alice'
import { bookTitle, clock, DemoBookDetails } from './DemoBookDetails'
import styles from './read-along.module.css'

const chaptersByOpeningPage = new Map(aliceChapters.map((chapter) => [chapter.page, chapter]))
const pageStarts = alicePages.map((page, index) => {
  const start = chaptersByOpeningPage.get(index)?.start ?? page.find((word) => word.start !== undefined)?.start
  if (start === undefined) throw new Error(`Alice read-along page ${index + 1} needs a narration cue`)
  return start
})
const textSettingsGlyph = 'Aa'
const playbackSpeeds = [0.5, 0.75, 0.9, 1, 1.15, 1.2, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3]
const searchPageSize = 30

function normalizeSearchWord(word: string) {
  return word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

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
type SearchMatch = { words: BookWord[]; position: number }
const lastWordEnd = bookWords.findLast((word) => word.end !== undefined)?.end ?? 0
const searchableWords = bookWords.map(({ word }) => normalizeSearchWord(word))

function findMatches(query: string): SearchMatch[] {
  const terms = query.trim().split(/\s+/).map(normalizeSearchWord).filter(Boolean)
  if (!terms.length) return []
  const results: SearchMatch[] = []
  for (let index = 0; index <= bookWords.length - terms.length; index++) {
    const matches = terms.length === 1 ? searchableWords[index].includes(terms[0]) : terms.every((term, offset) => searchableWords[index + offset] === term)
    if (!matches) continue
    const words = bookWords.slice(index, index + terms.length)
    results.push({ words, position: words[0].position })
  }
  return results
}

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

function writeBookmarks(bookmarks: number[]) {
  const updated = JSON.stringify(bookmarks)
  let stored = true
  try {
    window.localStorage.setItem(bookmarkKey, updated)
    sessionBookmarks = null
  } catch {
    sessionBookmarks = updated
    stored = false
  }
  window.dispatchEvent(new Event(bookmarkEvent))
  return stored
}

function getAudioPage(position: number) {
  return Math.max(
    0,
    pageStarts.findLastIndex((start) => start <= position)
  )
}

export default function ReadAlongDemo({ audioSrc, coverSrc, logoSrc, credits }: { audioSrc: string; coverSrc: string; logoSrc: string; credits?: ReactNode }) {
  const t = useTranslations()
  const audioRef = useRef<HTMLAudioElement>(null)
  const searchRef = useRef<HTMLDialogElement>(null)
  const searchCountRef = useRef<HTMLParagraphElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const leafRef = useRef<HTMLElement>(null)
  const toolsRef = useRef<HTMLElement>(null)
  const readerHeadingRef = useRef<HTMLHeadingElement>(null)
  const bookHeadingRef = useRef<HTMLHeadingElement>(null)
  const hasNavigated = useRef(false)
  const [showReader, setShowReader] = useState(false)
  const [playerOpened, setPlayerOpened] = useState(false)
  const [time, setTime] = useState(0)
  const [manualPage, setManualPage] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [audioFailed, setAudioFailed] = useState(false)
  const serializedBookmarks = useSyncExternalStore(subscribeToBookmarks, readBookmarks, emptyBookmarks)
  const bookmarks = useMemo(() => parseBookmarks(serializedBookmarks), [serializedBookmarks])
  const [bookmarkStatus, setBookmarkStatus] = useState('')
  const [largePrint, setLargePrint] = useState(false)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchMatch, setSearchMatch] = useState<SearchMatch | null>(null)
  const [searchPage, setSearchPage] = useState(0)
  const [readingMenuOpen, setReadingMenuOpen] = useState(false)
  const [duration, setDuration] = useState(lastWordEnd)
  const audioPage = getAudioPage(time)
  const page = manualPage ?? audioPage
  const openingChapter = chaptersByOpeningPage.get(page)
  const activeChapter = aliceChapters.findLast((chapter) => chapter.page <= page)
  const activeWord = alicePages[page].findIndex(({ start, end }) => start !== undefined && end !== undefined && time >= start && time < end)
  const searchResults = useMemo(() => findMatches(submittedQuery), [submittedQuery])
  const visibleSearchResults = searchResults.slice(searchPage * searchPageSize, (searchPage + 1) * searchPageSize)
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
    if (hasNavigated.current) (showReader ? readerHeadingRef : bookHeadingRef).current?.focus()
  }, [showReader])

  useEffect(() => {
    if (!showReader || readingMenuOpen || searchRef.current?.open) return
    if (!searchMatch && (!playing || manualPage !== null)) return
    const marker = leafRef.current?.querySelector(searchMatch === null ? '[aria-current="true"]' : '[data-match="true"]')
    marker?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeWord, manualPage, page, playing, readingMenuOpen, searchMatch, showReader])

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
    if (manualPage === null) seek(pageStarts[next])
    else {
      setManualPage(next)
      setSearchMatch(null)
    }
    frameRef.current?.scrollTo({ top: 0 })
  }

  function jumpFromMenu(next: number, menu: HTMLDetailsElement | null) {
    if (manualPage !== null) setManualPage(next)
    seek(pageStarts[next])
    closeReadingMenu(menu)
  }

  function closeReadingMenu(menu: HTMLDetailsElement | null) {
    if (menu) {
      menu.open = false
      menu.querySelector('summary')?.focus({ preventScroll: true })
    }
    frameRef.current?.scrollTo({ top: 0 })
  }

  function onReadingMenuToggle() {
    setReadingMenuOpen(Boolean(toolsRef.current?.querySelector('details[open]')))
  }

  function onReadingMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    const menu = event.currentTarget.querySelector<HTMLDetailsElement>('details[open]')
    if (!menu) return
    event.preventDefault()
    menu.open = false
    menu.querySelector('summary')?.focus({ preventScroll: true })
  }

  function startAudio() {
    setPlayerOpened(true)
    void audioRef.current?.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setAudioFailed(true)
    })
  }

  function togglePlayback() {
    if (playing) audioRef.current?.pause()
    else startAudio()
  }

  function playFromHere() {
    if (searchMatch) seek(searchMatch.position)
    else if (manualPage !== null) seek(pageStarts[page])
    setManualPage(null)
    startAudio()
  }

  function saveBookmark() {
    const position = manualPage !== null && page !== audioPage ? pageStarts[page] : (audioRef.current?.currentTime ?? time)
    const savedBookmarks = parseBookmarks(readBookmarks())
    if (savedBookmarks.some((saved) => Math.floor(saved) === Math.floor(position))) {
      setBookmarkStatus(t('LabelReadAlongDemoAlreadySaved'))
      return
    }
    const stored = writeBookmarks([...savedBookmarks, position])
    setBookmarkStatus(t(stored ? 'LabelReadAlongDemoBookmarkSaved' : 'LabelReadAlongDemoBookmarkSavedSession'))
  }

  function deleteBookmark(position: number, menu: HTMLDetailsElement | null) {
    const stored = writeBookmarks(parseBookmarks(readBookmarks()).filter((saved) => saved !== position))
    setBookmarkStatus(t(stored ? 'LabelReadAlongDemoBookmarkDeleted' : 'LabelReadAlongDemoBookmarkDeletedSession'))
    menu?.querySelector('summary')?.focus({ preventScroll: true })
  }

  return (
    <div className={styles.demo}>
      <header className={styles.appHeader}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={36} height={36} alt="" />
        <span>audiobookshelf</span>
      </header>
      <main className={styles.bookPanel}>
        {!showReader && (
          <DemoBookDetails
            coverSrc={coverSrc}
            duration={duration}
            headingRef={bookHeadingRef}
            playing={playing}
            onRead={() => {
              hasNavigated.current = true
              setShowReader(true)
            }}
            onTogglePlayback={togglePlayback}
            onPlayChapter={(start) => {
              setManualPage(null)
              seek(start)
              startAudio()
            }}
          />
        )}
        <section className={styles.readerPanel} hidden={!showReader} aria-labelledby="read-along-heading">
          <header className={styles.header}>
            <button
              type="button"
              onClick={() => {
                audioRef.current?.pause()
                hasNavigated.current = true
                setShowReader(false)
              }}
            >
              ← {t('LabelReadAlongDemoBack')}
            </button>
            <h1 className={styles.headerTitle} id="read-along-heading" ref={readerHeadingRef} tabIndex={-1}>
              {t('LabelReadAlongDemo')}
            </h1>
            <button className={styles.playToggle} type="button" onClick={togglePlayback}>
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
            <nav className={styles.tools} ref={toolsRef} onKeyDown={onReadingMenuKeyDown} aria-label={t('LabelReadAlongDemoTools')}>
              <details className={styles.tool} name="demo-reading-tools" onToggle={onReadingMenuToggle}>
                <summary>
                  <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
                  </svg>
                  {t('LabelReadAlongDemoContents')}
                </summary>
                <div className={styles.panel}>
                  <button type="button" lang="en" onClick={(event) => jumpFromMenu(0, event.currentTarget.closest('details'))}>
                    {bookTitle}
                  </button>
                </div>
              </details>
              <details className={styles.tool} name="demo-reading-tools" onToggle={onReadingMenuToggle}>
                <summary>
                  <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 6c-2.5-2-6-2-9-1v14c3-1 6.5-1 9 1 2.5-2 6-2 9-1V5c-3-1-6.5-1-9 1Zm0 0v14" />
                  </svg>
                  {t('LabelChapters')}
                </summary>
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
              <details className={styles.tool} name="demo-reading-tools" onToggle={onReadingMenuToggle}>
                <summary>
                  <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 4h12v16l-6-4-6 4z" />
                  </svg>
                  {t('LabelReadAlongDemoBookmarks')}
                </summary>
                <div className={styles.panel}>
                  {bookmarks.length ? (
                    bookmarks.map((position) => {
                      const location = t('LabelReadAlongDemoBookmarkLocation', { page: getAudioPage(position) + 1 })
                      const timestamp = clock(position)
                      return (
                        <div key={position} className={styles.bookmarkRow}>
                          <button
                            className={styles.chapterChoice}
                            type="button"
                            onClick={(event) => {
                              setManualPage(null)
                              seek(position)
                              closeReadingMenu(event.currentTarget.closest('details'))
                            }}
                          >
                            <span>{location}</span>
                            <span className={styles.chapterPosition}>{timestamp}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={t('LabelReadAlongDemoDeleteBookmarkAt', { timestamp })}
                            onClick={(event) => deleteBookmark(position, event.currentTarget.closest('details'))}
                          >
                            {t('LabelReadAlongDemoDeleteBookmark')}
                          </button>
                        </div>
                      )
                    })
                  ) : (
                    <p>{t('LabelReadAlongDemoNoBookmarks')}</p>
                  )}
                </div>
              </details>
              <details className={styles.tool} name="demo-reading-tools" onToggle={onReadingMenuToggle}>
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
                        <span aria-current={word.index === activeWord ? 'true' : undefined} data-match={searchMatch?.words.includes(word) || undefined}>
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
        </section>
      </main>
      <section className={styles.player} hidden={!showReader && !playerOpened} aria-label={t('LabelReadAlongDemoNarration')}>
        <div className={styles.playerInner}>
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            aria-label={t('LabelReadAlongDemoNarration')}
            src={audioSrc}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
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
            onPlaying={() => setAudioFailed(false)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => setAudioFailed(true)}
          />
          <div className={styles.playerBar}>
            <div hidden={!showReader}>
              <button type="button" aria-label={t('LabelReadAlongDemoBackThirty')} onClick={() => seek(time - 30)}>
                −30
              </button>{' '}
              <button type="button" aria-label={t('LabelReadAlongDemoForwardThirty')} onClick={() => seek(time + 30)}>
                +30
              </button>
            </div>
            <button type="button" onClick={saveBookmark} hidden={!showReader}>
              {t('LabelReadAlongDemoSaveBookmark')}
            </button>
            <span className={styles.muted} hidden={!showReader}>
              {t('LabelPlayerChapterNumberMarker', { 0: clock(time), 1: clock(duration) })}
            </span>
            <label className={styles.playbackSpeed}>
              {t('LabelReadAlongDemoSpeed')}
              <select
                value={playbackRate}
                onChange={(event) => {
                  const audio = audioRef.current
                  if (!audio) return
                  audio.playbackRate = Number(event.currentTarget.value)
                  setPlaybackRate(audio.playbackRate)
                }}
              >
                {!playbackSpeeds.includes(playbackRate) && <option value={playbackRate}>{playbackRate}×</option>}
                {playbackSpeeds.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          {showReader && bookmarkStatus && (
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
            setSubmittedQuery(query.trim())
            setSearchPage(0)
          }}
        >
          <label htmlFor="sample-search">{t('LabelSearchTerm')}</label>
          <input id="sample-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit">{t('ButtonSearch')}</button>
        </form>
        {submittedQuery && searchResults.length > 0 && (
          <p className={styles.searchCount} role="status" ref={searchCountRef} tabIndex={-1}>
            {t('LabelReadAlongDemoSearchCount', {
              first: searchPage * searchPageSize + 1,
              last: Math.min((searchPage + 1) * searchPageSize, searchResults.length),
              total: searchResults.length
            })}
          </p>
        )}
        <div className={styles.searchResults}>
          {visibleSearchResults.map((result) => (
            <button
              key={`${result.words[0].page}-${result.words[0].index}`}
              type="button"
              onClick={() => {
                audioRef.current?.pause()
                setManualPage(null)
                seek(result.position)
                setSearchMatch(result)
                searchRef.current?.close()
              }}
            >
              <span lang="en">{result.words.map(({ word }) => word).join(' ')}</span> · {clock(result.position)}
            </button>
          ))}
          {submittedQuery && !searchResults.length && <p role="status">{t('LabelReadAlongDemoNoMatches')}</p>}
        </div>
        {searchResults.length > searchPageSize && (
          <div className={styles.searchPages}>
            {([-1, 1] as const).map((step) => (
              <button
                key={step}
                type="button"
                disabled={step < 0 ? searchPage === 0 : (searchPage + 1) * searchPageSize >= searchResults.length}
                onClick={() => {
                  setSearchPage(searchPage + step)
                  searchCountRef.current?.focus()
                }}
              >
                {t(step < 0 ? 'ButtonPrevious' : 'ButtonNext')}
              </button>
            ))}
          </div>
        )}
      </dialog>
    </div>
  )
}
