import { useTranslations } from 'next-intl'
import type { Ref } from 'react'

import type { DemoBook, DemoChapter } from './books'
import styles from './read-along.module.css'

const editionLanguage = 'English'

export function clock(seconds: number) {
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = String(Math.floor(whole / 60) % 60)
  const remaining = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${minutes.padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`
}

type DemoBookDetailsProps = {
  book: DemoBook
  chapters: readonly DemoChapter[]
  coverSrc: string
  headingRef: Ref<HTMLHeadingElement>
  onRead: () => void
  onTogglePlayback: () => void
  onPlayChapter: (start: number) => void
  playing: boolean
  duration: number
}

export function DemoBookDetails({ book, chapters, coverSrc, headingRef, onRead, onTogglePlayback, onPlayChapter, playing, duration }: DemoBookDetailsProps) {
  const t = useTranslations()
  const { title: bookTitle, author, narrator, year } = book

  return (
    <div className={styles.bookDetailScroll}>
      <article className={styles.bookDetails}>
        {/* Plain img also works in the GitHub Pages build, which has no image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.bookCover} src={coverSrc} width={800} height={1104} alt={t('LabelReadAlongDemoCover', { title: bookTitle })} />
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {bookTitle}
          </h1>
          <p className={styles.bookAuthor}>{t('LabelByAuthor', { 0: author })}</p>
          <dl className={styles.bookMetadata}>
            <div>
              <dt>{t('LabelNarrators')}</dt>
              <dd>{narrator}</dd>
            </div>
            <div>
              <dt>{t('LabelPublishYear')}</dt>
              <dd>{year}</dd>
            </div>
            <div>
              <dt>{t('LabelLanguage')}</dt>
              <dd>{editionLanguage}</dd>
            </div>
            <div>
              <dt>{t('LabelDuration')}</dt>
              <dd>{clock(duration)}</dd>
            </div>
          </dl>
          <div className={styles.bookActionBar}>
            <button className={styles.bookPlay} type="button" onClick={onTogglePlayback}>
              {t(playing ? 'ButtonPause' : 'ButtonPlay')}
            </button>
            <button className={styles.bookRead} type="button" onClick={onRead}>
              {t('LabelReadAlongDemo')}
            </button>
          </div>
          <p className={styles.bookDescription}>{t('descriptionKey' in book ? book.descriptionKey : 'LabelReadAlongDemoDescription')}</p>
          <details className={styles.bookChapters}>
            <summary>
              {t('LabelChapters')} ({chapters.length})
            </summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('LabelTitle')}</th>
                  <th scope="col">{t('LabelStart')}</th>
                  <th scope="col">{t('LabelDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((chapter, index) => (
                  <tr key={chapter.start}>
                    <td>{chapter.title}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onPlayChapter(chapter.start)}
                        aria-label={t('LabelReadAlongDemoPlayChapter', { title: chapter.title })}
                      >
                        {clock(chapter.start)}
                      </button>
                    </td>
                    <td>{clock((chapters[index + 1]?.start ?? duration) - chapter.start)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </article>
    </div>
  )
}
