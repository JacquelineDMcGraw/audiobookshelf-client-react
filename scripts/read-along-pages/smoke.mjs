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
  const audio = page.locator('audio')
  const pageNumber = page.getByRole('combobox', { name: 'Page', exact: true })
  const chapterMenu = page.locator('details:visible').filter({ has: page.locator('summary', { hasText: /^Chapters$/ }) })
  const bookmarkMenu = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Bookmarks$/ }) })
  const bookmarkOnPage = (pageIndex) => bookmarkMenu.getByRole('button', { name: new RegExp(`^Page ${Number(pageIndex) + 1}\\b`) })
  const saveBookmark = async () => {
    await page.getByRole('button', { name: 'Save bookmark', exact: true }).click()
    await page.getByText('Bookmark saved in this browser.', { exact: true }).waitFor()
  }
  const finalChapter = page.getByRole('heading', { name: 'Alice’s Evidence', exact: true })

  await book.waitFor()
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
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  assert(await audio.evaluate((element) => element.paused), 'Pause on the book page should stop playback')
  const bookPosition = await audio.evaluate((element) => element.currentTime)
  await openReader.click()
  await reader.waitFor()
  await book.waitFor({ state: 'hidden' })
  assert(Math.abs((await audio.evaluate((element) => element.currentTime)) - bookPosition) < 0.1, 'Opening Read Along should keep the playback position')

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
    'Read Along smoke passed: book details and playback, 12 chapters, highlighting and automatic page turn, bookmark deletion and restore after reload, and Back to book.'
  )
} finally {
  await browser.close()
}
