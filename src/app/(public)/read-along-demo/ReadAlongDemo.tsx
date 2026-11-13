'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { alicePages } from './alice'
import styles from './read-along.module.css'

const pageStarts = alicePages.map((page) => page[0].start)
const bookTitle = 'Alice’s Adventures in Wonderland'
const chapterTitle = 'Down the Rabbit-Hole'
const textSettingsGlyph = 'Aa'
const playbackSpeeds = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2]
const excerptEnd = alicePages.at(-1)!.at(-1)!.end
const excerptWords = alicePages.flat()
const pageParagraphs = alicePages.map((words) => {
  const paragraphs: (typeof words)[number][][] = []
  for (const word of words) {
    if (!paragraphs.length || word.paragraphStart) paragraphs.push([])
    paragraphs.at(-1)!.push(word)
  }
  return paragraphs
})

function clock(seconds: number) {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export default function ReadAlongDemo({ audioSrc, credits }: { audioSrc: string; credits?: ReactNode }) {
  const t = useTranslations()
  const audioRef = useRef<HTMLAudioElement>(null)
  const searchRef = useRef<HTMLDialogElement>(null)
  const leafRef = useRef<HTMLElement>(null)
  const [time, setTime] = useState(0)
  const [manualPage, setManualPage] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const [bookmarks, setBookmarks] = useState<number[]>([])
  const [bookmarkStatus, setBookmarkStatus] = useState('')
  const [largePrint, setLargePrint] = useState(false)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchMatch, setSearchMatch] = useState<number | null>(null)
  const [duration, setDuration] = useState(excerptEnd)
  const audioPage = Math.max(
    0,
    pageStarts.findLastIndex((start) => start <= time)
  )
  const page = manualPage ?? audioPage
  const activeWord = alicePages[page].find((word) => time >= word.start && time < word.end)?.start
  const matchingWords = submittedQuery ? excerptWords.filter((word) => word.word.toLowerCase().includes(submittedQuery)) : []

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
    const duration = Number.isFinite(player.duration) ? player.duration : excerptEnd
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

  function startAudio() {
    void audioRef.current?.play().catch(() => setAudioFailed(true))
  }

  function playFromHere() {
    if (page !== audioPage) seek(pageStarts[page])
    setManualPage(null)
    startAudio()
  }

  function saveBookmark() {
    const position = audioRef.current?.currentTime ?? time
    if (bookmarks.some((saved) => Math.floor(saved) === Math.floor(position))) {
      setBookmarkStatus(t('LabelReadAlongDemoAlreadySaved'))
      return
    }
    setBookmarks([...bookmarks, position])
    setBookmarkStatus(t('LabelReadAlongDemoBookmarkSaved'))
  }

  return (
    <main className={styles.demo}>
      <header className={styles.header}>
        <button
          type="button"
          onClick={() => {
            audioRef.current?.pause()
            setManualPage(null)
            seek(0)
          }}
        >
          ← {t('LabelReadAlongDemoBack')}
        </button>
        <h1 className={styles.headerTitle}>{t('LabelReadAlongDemo')}</h1>
        <button className={styles.playToggle} type="button" onClick={() => (playing ? audioRef.current?.pause() : startAudio())}>
          {t(playing ? 'LabelReadAlongDemoPauseAudio' : 'LabelReadAlongDemoPlayAudio')}
        </button>
      </header>

      <div className={styles.frame}>
        <div className={styles.bookHeader}>
          <p className={styles.muted}>{t('LabelReadAlongDemoTiming', { time: clock(excerptEnd) })}</p>
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
              {alicePages.map((wordsOnPage, index) => (
                <option key={wordsOnPage[0].start} value={index}>
                  {t('LabelPlayerChapterNumberMarker', { 0: index + 1, 1: alicePages.length })}
                </option>
              ))}
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
              <button
                type="button"
                lang="en"
                onClick={(event) => {
                  turnPage(0)
                  event.currentTarget.closest('details')!.open = false
                }}
              >
                {bookTitle}
              </button>
            </div>
          </details>
          <details className={styles.tool} name="demo-reading-tools">
            <summary>{t('LabelChapters')}</summary>
            <div className={styles.panel}>
              <button
                type="button"
                lang="en"
                onClick={(event) => {
                  turnPage(0)
                  event.currentTarget.closest('details')!.open = false
                }}
              >
                {chapterTitle}
              </button>
            </div>
          </details>
          <details className={styles.tool} name="demo-reading-tools">
            <summary>{t('LabelReadAlongDemoBookmarks')}</summary>
            <div className={styles.panel}>
              {bookmarks.length ? (
                bookmarks.map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={(event) => {
                      setManualPage(null)
                      seek(position)
                      event.currentTarget.closest('details')!.open = false
                    }}
                  >
                    {clock(position)}
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
          {page === 0 && <h2 className={styles.chapter}>{chapterTitle}</h2>}
          <div className={styles.passage}>
            {pageParagraphs[page].map((paragraph) => (
              <p key={paragraph[0].start}>
                {paragraph.map((word, index) => (
                  <span key={word.start}>
                    <span aria-current={word.start === activeWord ? 'true' : undefined} data-match={searchMatch === word.start || undefined}>
                      {word.word}
                    </span>
                    {index < paragraph.length - 1 && ' '}
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
              setSearchMatch((match) => (match !== null && Math.abs(match - position) < 0.01 ? match : null))
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
              key={result.start}
              type="button"
              onClick={() => {
                audioRef.current?.pause()
                setManualPage(null)
                seek(result.start)
                setSearchMatch(result.start)
                searchRef.current?.close()
              }}
            >
              <span lang="en">{result.word}</span> · {clock(result.start)}
            </button>
          ))}
          {submittedQuery && !matchingWords.length && <p role="status">{t('LabelReadAlongDemoNoMatches')}</p>}
        </div>
      </dialog>
    </main>
  )
}
