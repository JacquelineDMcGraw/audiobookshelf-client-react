import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const demoUrl = process.env.READ_ALONG_SMOKE_URL ?? 'https://jacquelinedmcgraw.github.io/audiobookshelf-client-react/'
const expectedJs = process.env.READ_ALONG_EXPECTED_JS
const playwrightModule = process.env.READ_ALONG_PLAYWRIGHT_MODULE ?? 'playwright'
const { chromium } = createRequire(import.meta.url)(playwrightModule)

async function openDeployment(page, errors) {
  const attempts = expectedJs ? 12 : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = new URL(demoUrl)
    if (expectedJs) url.searchParams.set('_read_along_smoke', `${Date.now()}-${attempt}`)
    errors.length = 0
    try {
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      assert(response?.ok(), `Demo returned HTTP ${response?.status()}`)
      if (expectedJs) {
        const script = await page
          .locator('script[src]')
          .evaluateAll((scripts, expected) => scripts.some((script) => script.src === expected), new URL(expectedJs, page.url()).href)
        assert(script, `Page is not serving the expected script ${expectedJs}`)
      }
      return
    } catch (error) {
      if (attempt === attempts) throw error
      console.log(`Waiting for deployment (${attempt}/${attempts}): ${error.message.split('\n')[0]}`)
      await delay(10_000)
    }
  }
}

const browser = await chromium.launch({ executablePath: process.env.READ_ALONG_CHROMIUM_PATH })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await openDeployment(page, errors)

  const bookTitle = 'Alice’s Adventures in Wonderland'
  const book = page.getByRole('heading', { level: 1, name: bookTitle, exact: true })
  const openReader = page.getByRole('button', { name: 'Read Along', exact: true })
  const reader = page.getByRole('heading', { level: 1, name: 'Read Along', exact: true })
  const appHeader = page.getByRole('banner').filter({ hasText: 'audiobookshelf' })
  const readerPanel = page.getByRole('main').getByRole('region', { name: 'Read Along', exact: true })
  const bookUrl = page.url()
  const audio = page.locator('audio')
  const speed = page.getByRole('combobox', { name: 'Speed', exact: true })
  const pageNumber = page.getByRole('combobox', { name: 'Page', exact: true })
  const chapterMenu = page.locator('details:visible').filter({ has: page.locator('summary', { hasText: /^Chapters$/ }) })
  const bookmarkMenu = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Bookmarks$/ }) })
  const bookmarkOnPage = (pageIndex) => bookmarkMenu.getByRole('button', { name: new RegExp(`^Page ${Number(pageIndex) + 1}\\b`) })
  const saveBookmark = async () => {
    await page.getByRole('button', { name: 'Save bookmark', exact: true }).click()
    await page.getByText('Bookmark saved in this browser.', { exact: true }).waitFor()
  }
  const finalChapter = page.getByRole('heading', { name: 'Alice’s Evidence', exact: true })
  const selectSpeed = async (rate) => {
    await speed.selectOption(String(rate))
    await page.waitForFunction((expected) => document.querySelector('audio')?.playbackRate === expected, rate)
    assert.equal(await speed.inputValue(), String(rate), 'The speed control should show the selected rate')
  }

  await book.waitFor()
  await appHeader.waitFor()
  await reader.waitFor({ state: 'hidden' })
  const cover = page.getByRole('img', { name: `${bookTitle} cover`, exact: true })
  await cover.waitFor()
  await page.waitForFunction((alt) => [...document.images].some((img) => img.alt === alt && img.complete && img.naturalWidth > 0), `${bookTitle} cover`)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio')
    return audio && !audio.paused && audio.duration > 9_000 && audio.duration < 10_000 && audio.currentTime > 0.75
  })
  assert(await book.isVisible(), 'Play should keep the book details visible')
  await speed.waitFor()
  assert.equal(await speed.inputValue(), '1', 'Playback should start at normal speed')
  assert.equal(await audio.evaluate((element) => element.playbackRate), 1, 'Audio should start at normal speed')
  for (const rate of [0.75, 2]) {
    const position = await audio.evaluate((element) => element.currentTime)
    await selectSpeed(rate)
    const sample = await audio.evaluate(async (element) => {
      const startedAt = performance.now()
      const startedPosition = element.currentTime
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return { seconds: (performance.now() - startedAt) / 1_000, progress: element.currentTime - startedPosition, paused: element.paused }
    })
    assert(!sample.paused, 'Changing speed should keep the audio playing')
    assert(Math.abs(sample.progress / sample.seconds - rate) < 0.4, `Audio did not advance at approximately ${rate}×`)
    assert((await audio.evaluate((element) => element.currentTime)) > position, 'Changing speed should preserve playback position')
  }
  await selectSpeed(1)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  assert(await audio.evaluate((element) => element.paused), 'Pause on the book page should stop playback')
  const bookPosition = await audio.evaluate((element) => element.currentTime)
  await openReader.click()
  await reader.waitFor()
  await readerPanel.waitFor()
  await speed.waitFor()
  await book.waitFor({ state: 'hidden' })
  assert.equal(page.url(), bookUrl, 'Read Along should open inside the book page')
  await readerPanel.getByText('Word highlighting is available', { exact: false }).waitFor()
  await readerPanel.locator('article footer').scrollIntoViewIfNeeded()
  const headerBounds = await appHeader.boundingBox()
  const playerBounds = await audio.boundingBox()
  assert(headerBounds && headerBounds.y >= 0 && headerBounds.y + headerBounds.height <= 844, 'The app header should stay on screen while scrolling')
  assert(playerBounds && playerBounds.y >= 0 && playerBounds.y + playerBounds.height <= 844, 'The player should stay on screen while scrolling')
  assert(Math.abs((await audio.evaluate((element) => element.currentTime)) - bookPosition) < 0.1, 'Opening Read Along should keep the playback position')

  await readerPanel.getByRole('button', { name: 'Search', exact: true }).click()
  const searchDialog = page.getByRole('dialog', { name: 'Search', exact: true })
  await searchDialog.getByRole('searchbox', { name: 'Search Term', exact: true }).fill('white rabbit')
  await searchDialog.getByRole('button', { name: 'Search', exact: true }).click()
  const phraseResult = searchDialog.getByRole('button', { name: /^White Rabbit\b/i }).first()
  const timestamp = (await phraseResult.innerText()).match(/\b\d+(?::\d{2}){1,2}\b/)?.[0]
  assert(timestamp, 'The search result should show the phrase timestamp')
  const expectedMatchTime = timestamp.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0)
  assert(expectedMatchTime > 0, 'The phrase should jump ahead in the book')
  await phraseResult.click()
  await searchDialog.waitFor({ state: 'hidden' })
  const marks = readerPanel.locator('article [data-match="true"]')
  await marks.first().waitFor()
  assert.deepEqual(await marks.allTextContents(), ['White', 'Rabbit'], 'Both words in the selected phrase should be marked')
  await page.waitForFunction((expected) => {
    const audio = document.querySelector('audio')
    return audio && !audio.seeking && Math.abs(audio.currentTime - expected) < 1.05
  }, expectedMatchTime)
  const matchPosition = await audio.evaluate((element) => element.currentTime)
  await readerPanel.getByRole('button', { name: 'Play from match', exact: true }).click()
  await page.waitForFunction((start) => {
    const audio = document.querySelector('audio')
    return audio && !audio.paused && audio.currentTime > start + 0.25 && audio.currentTime < start + 2
  }, matchPosition)
  await readerPanel.getByRole('button', { name: 'Pause audio', exact: true }).click()

  const followAudio = readerPanel.getByRole('checkbox', { name: 'Follow audio', exact: true })
  await followAudio.uncheck()
  const pausedPosition = await audio.evaluate((element) => element.currentTime)
  const originalPage = await pageNumber.inputValue()
  await readerPanel.getByRole('button', { name: 'Next', exact: true }).click()
  const manualPage = await pageNumber.inputValue()
  assert.equal(Number(manualPage), Number(originalPage) + 1, 'Next should turn the page in manual mode')
  assert(Math.abs((await audio.evaluate((element) => element.currentTime)) - pausedPosition) < 0.1, 'Manual page turns should leave audio in place')
  await readerPanel.getByRole('button', { name: 'Play from here', exact: true }).click()
  await page.waitForFunction((position) => {
    const audio = document.querySelector('audio')
    return audio && !audio.paused && !audio.seeking && audio.currentTime > position + 1
  }, pausedPosition)
  assert(await followAudio.isChecked(), 'Play from here should re-enable Follow audio')
  assert.equal(await pageNumber.inputValue(), manualPage, 'Play from here should start on the selected manual page')
  await readerPanel.getByRole('button', { name: 'Pause audio', exact: true }).click()

  await chapterMenu.locator('summary').click()
  assert.equal(await chapterMenu.getByRole('button').count(), 12, 'All 12 chapters should be selectable')
  await chapterMenu.getByRole('button', { name: /^12\. Alice’s Evidence/ }).click()
  await finalChapter.waitFor()
  const finalPage = await pageNumber.inputValue()
  const chapterStart = await audio.evaluate((element) => element.currentTime)
  assert(chapterStart > 8_000, 'The last chapter should seek into the last part of the recording')

  await saveBookmark()

  await page.getByRole('button', { name: 'Play audio', exact: true }).click()
  await page.waitForFunction((start) => {
    const audio = document.querySelector('audio')
    return !audio.paused && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && audio.currentTime > start + 0.75
  }, chapterStart)
  await page.locator('article [aria-current="true"]').waitFor()
  await page.getByRole('button', { name: 'Pause audio', exact: true }).click()
  assert(await audio.evaluate((element) => element.paused), 'The pause control should stop playback')

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const nextPage = await pageNumber.inputValue()
  assert.equal(Number(nextPage), Number(finalPage) + 1)
  const nextPageStart = await audio.evaluate((element) => element.currentTime)
  // Start just before the known boundary and let real playback turn the page.
  await audio.evaluate((element, time) => {
    element.currentTime = time
  }, nextPageStart - 1)
  await page.waitForFunction((value) => document.querySelector('#sample-page')?.value === value, finalPage)
  await page.getByRole('button', { name: 'Play audio', exact: true }).click()
  await page.waitForFunction((value) => document.querySelector('#sample-page')?.value === value, nextPage)
  await page.getByRole('button', { name: 'Pause audio', exact: true }).click()
  await saveBookmark()

  await bookmarkMenu.locator('summary').click()
  const bookmarkToDelete = bookmarkOnPage(nextPage)
  await bookmarkToDelete.waitFor()
  await bookmarkToDelete
    .locator('..')
    .getByRole('button', { name: /^Delete bookmark at / })
    .click()
  await page
    .getByRole('status')
    .filter({ hasText: /^Bookmark deleted\.$/ })
    .waitFor()
  await bookmarkToDelete.waitFor({ state: 'detached' })
  await bookmarkOnPage(finalPage).waitFor()

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  await book.waitFor()
  await openReader.click()
  await reader.waitFor()
  await bookmarkMenu.locator('summary').click()
  await bookmarkOnPage(finalPage).waitFor()
  assert.equal(await bookmarkToDelete.count(), 0, 'Deleted bookmark should stay deleted after reload')
  await bookmarkOnPage(finalPage).click()
  await finalChapter.waitFor()
  assert.equal(await pageNumber.inputValue(), finalPage, 'Bookmark should restore the saved page after reload')
  await page.waitForFunction((start) => Math.abs(document.querySelector('audio').currentTime - start) < 0.1, chapterStart)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Play audio', exact: true }).click()
  await page.waitForFunction((start) => {
    const audio = document.querySelector('audio')
    return !audio.paused && audio.currentTime > start + 0.75
  }, chapterStart)
  await page.getByRole('button', { name: /Back to book/ }).click()
  await book.waitFor()
  await appHeader.waitFor()
  assert.equal(page.url(), bookUrl, 'Back should return to the details on the same page')
  const returnedPosition = await audio.evaluate((element) => {
    if (!element.paused) throw new Error('Returning to the book should pause playback')
    return element.currentTime
  })
  assert(returnedPosition > chapterStart, 'Returning to the book should keep the listening position')
  await openReader.click()
  await reader.waitFor()
  await finalChapter.waitFor()
  assert(Math.abs((await audio.evaluate((element) => element.currentTime)) - returnedPosition) < 0.1, 'Reopening Read Along should keep the playback position')

  assert.deepEqual(errors, [], 'Browser did not complete the smoke test without JavaScript errors')
  console.log(
    'Read Along smoke passed: book details, playback and speed, embedded reader with visible app header, phrase search and playback, manual page turns, 12 chapters, highlighting and automatic page turn, bookmark deletion and restore after reload, and Back to book.'
  )
} finally {
  await browser.close()
}
