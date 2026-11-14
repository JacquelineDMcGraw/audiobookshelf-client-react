import assert from 'node:assert/strict'

export const aliceTitle = 'Alice’s Adventures in Wonderland'
export const addedBooks = [
  {
    slug: 'wizard-of-oz',
    title: 'The Wonderful Wizard of Oz',
    chapterCount: 25,
    lastChapter: 'Home Again',
    closingWords: 'so glad to be at home again',
    wordCount: 39_314,
    minimumPages: 100,
    durationRange: [13_000, 14_000]
  },
  {
    slug: 'yellow-wallpaper',
    title: 'The Yellow Wallpaper',
    chapterCount: 1,
    lastChapter: 'The Yellow Wallpaper',
    closingWords: 'creep over him every time',
    wordCount: 6_078,
    minimumPages: 14,
    durationRange: [2_050, 2_200]
  }
]

function hasTiming(word) {
  return Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

async function loadTimings(response, book) {
  assert(response.ok(), book.title + ' timings returned HTTP ' + response.status())
  const { chapters, pages } = await response.json()
  const words = pages.flat()
  assert.equal(chapters.length, book.chapterCount, book.title + ' chapter count')
  assert.equal(chapters.at(-1).title.replace(/\.$/, ''), book.lastChapter)
  assert(pages.length >= book.minimumPages, book.title + ' has too few pages: ' + pages.length)
  assert.equal(words.length, book.wordCount, book.title + ' must include the complete source text')

  let previousEnd = 0
  let timedCount = 0
  for (const [pageIndex, pageWords] of pages.entries()) {
    const timed = pageWords.filter(hasTiming)
    assert(timed.length > 0, book.title + ' page ' + (pageIndex + 1) + ' has no timed words')
    for (const word of pageWords) {
      assert((word.start === undefined && word.end === undefined) || hasTiming(word), book.title + ' has an invalid timing for ' + word.word)
    }
    for (const word of timed) {
      assert(word.start >= previousEnd, book.title + ' page ' + (pageIndex + 1) + ' has backward or overlapping word cues')
      previousEnd = word.end
    }
    timedCount += timed.length
  }
  for (const [index, chapter] of chapters.entries()) {
    assert(Number.isInteger(chapter.page) && chapter.page >= 0 && chapter.page < pages.length, chapter.title + ' has an invalid page')
    assert(index === 0 ? chapter.page === 0 : chapter.page > chapters[index - 1].page, chapter.title + ' follows the wrong chapter')
    assert(
      Number.isFinite(chapter.start) && chapter.start >= 0 && (index === 0 || chapter.start > chapters[index - 1].start),
      chapter.title + ' has an invalid chapter start'
    )
    assert(chapter.start <= pages[chapter.page].find(hasTiming).start, chapter.title + ' starts after its first words')
  }
  assert(timedCount / words.length > 0.97, book.title + ' has incomplete word timing: ' + timedCount + '/' + words.length + ' words')
  const lastWords = words.slice(-book.closingWords.split(' ').length)
  assert.equal(lastWords.map(({ word }) => normalizeText(word)).join(' '), book.closingWords, book.title + ' should include the closing line')
  assert(lastWords.every(hasTiming), book.title + ' should highlight the closing line')
  return { chapters, pages, lastWord: lastWords.at(-1) }
}

export async function checkBook(page, book, timingResponse) {
  const details = page.getByRole('heading', { level: 1, name: book.title, exact: true })
  await details.waitFor()
  assert.equal(new URL(page.url()).hash, '#' + book.slug, book.title + ' should have a shareable page')
  const coverAlt = book.title + ' cover'
  await page.getByRole('img', { name: coverAlt, exact: true }).waitFor()
  await page.waitForFunction((alt) => [...document.images].some((image) => image.alt === alt && image.complete && image.naturalWidth > 0), coverAlt)
  const bookUrl = page.url()
  const { chapters, pages, lastWord } = await loadTimings(timingResponse, book)

  const read = page.getByRole('button', { name: 'Read Along', exact: true })
  await read.click()
  const panel = page.getByRole('main').getByRole('region', { name: 'Read Along', exact: true })
  const audio = page.locator('audio')
  const pageNumber = panel.getByRole('combobox', { name: 'Page', exact: true })
  const highlighted = panel.locator('article [aria-current="true"]')
  const chapterMenu = panel.locator('details').filter({ has: page.locator('summary', { hasText: /^Chapters$/ }) })
  const bookmarkMenu = panel.locator('details').filter({ has: page.locator('summary', { hasText: /^Bookmarks$/ }) })
  const play = panel.getByRole('button', { name: 'Play audio', exact: true })
  const pause = panel.getByRole('button', { name: 'Pause audio', exact: true })

  await panel.waitFor()
  assert.equal(page.url(), bookUrl, 'Read Along should open in the selected book page')
  await page.getByRole('banner').filter({ hasText: 'audiobookshelf' }).waitFor()
  await page.waitForFunction(() => Number.isFinite(document.querySelector('audio')?.duration))
  const duration = await audio.evaluate((element) => element.duration)
  assert(duration >= book.durationRange[0] && duration <= book.durationRange[1], book.title + ' audio is incomplete: ' + duration + ' seconds')
  assert(duration >= lastWord.end - 0.1 && duration - lastWord.end < 20, book.title + ' last word cue should reach the end of the audio')
  assert.equal(await pageNumber.locator('option').count(), pages.length, book.title + ' should expose every page')

  await bookmarkMenu.locator('summary').click()
  await bookmarkMenu.getByText('No bookmarks yet.', { exact: true }).waitFor()
  await chapterMenu.locator('summary').click()
  const chapterButtons = chapterMenu.getByRole('button')
  assert.equal(await chapterButtons.count(), book.chapterCount, book.title + ' should expose all chapters')
  await chapterButtons.last().click()
  await panel.getByRole('heading', { name: chapters.at(-1).title, exact: true }).waitFor()
  assert.equal(await pageNumber.inputValue(), String(chapters.at(-1).page), book.title + ' must seek to the last chapter')

  const seek = (time) =>
    audio.evaluate((element, position) => {
      element.currentTime = position
    }, time)
  const waitForPage = (pageIndex) => page.waitForFunction((value) => document.querySelector('#sample-page')?.value === value, String(pageIndex))
  const waitForHighlight = (word) => page.waitForFunction((expected) => document.querySelector('article [aria-current="true"]')?.textContent === expected, word)
  const middlePage = Math.floor(pages.length / 2)
  for (const pageIndex of [0, middlePage, pages.length - 1]) {
    const timedWords = pages[pageIndex].filter(hasTiming)
    const word = timedWords[Math.floor(timedWords.length / 2)]
    await seek((word.start + word.end) / 2)
    await waitForPage(pageIndex)
    await waitForHighlight(word.word)
  }

  const lastPage = pages.length - 1
  const lastPageStart = chapters.find(({ page }) => page === lastPage)?.start ?? pages[lastPage].find(hasTiming).start
  await seek(lastPageStart - 0.75)
  await waitForPage(lastPage - 1)
  await play.click()
  await waitForPage(lastPage)
  await page.waitForFunction((boundary) => {
    const player = document.querySelector('audio')
    return !player.paused && !player.seeking && player.currentTime > boundary + 0.3
  }, lastPageStart)
  await highlighted.waitFor()
  await pause.click()
  await seek((lastWord.start + lastWord.end) / 2)
  await waitForHighlight(lastWord.word)
  assert(await panel.getByRole('button', { name: 'Next', exact: true }).isDisabled(), book.title + ' end should be its final numbered page')

  await page.getByRole('button', { name: 'Save bookmark', exact: true }).click()
  await page.getByText('Bookmark saved in this browser.', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  await details.waitFor()
  await read.click()
  await bookmarkMenu.locator('summary').click()
  const saved = bookmarkMenu.getByRole('button', { name: new RegExp('^Page ' + (lastPage + 1) + '\\b') })
  await saved.click()
  await waitForPage(lastPage)
  await waitForHighlight(lastWord.word)
  console.log(book.title + ' passed: complete text, all chapters, start-to-end word highlighting, final page auto turn, and an isolated bookmark after reload.')
}
