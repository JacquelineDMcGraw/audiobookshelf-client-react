import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const demoUrl = process.env.READ_ALONG_SMOKE_URL ?? 'https://jacquelinedmcgraw.github.io/audiobookshelf-client-react/'
const expectedJs = process.env.READ_ALONG_EXPECTED_JS
const playwrightModule = process.env.READ_ALONG_PLAYWRIGHT_MODULE ?? 'playwright'
const { chromium } = createRequire(import.meta.url)(playwrightModule)
const repoUrl = 'https://github.com/JacquelineDMcGraw/audiobookshelf-client-react'

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

  const reader = page.getByRole('heading', { name: 'Read Along', exact: true })
  const audio = page.locator('audio')
  const pageNumber = page.getByRole('combobox', { name: 'Page', exact: true })
  const chapterMenu = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Chapters$/ }) })
  const bookmarkMenu = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Bookmarks$/ }) })
  const bookmarkOnPage = (pageIndex) => bookmarkMenu.getByRole('button', { name: new RegExp(`^Page ${Number(pageIndex) + 1}\\b`) })
  const saveBookmark = async () => {
    await page.getByRole('button', { name: 'Save bookmark', exact: true }).click()
    await page.getByText('Bookmark saved in this browser.', { exact: true }).waitFor()
  }
  const finalChapter = page.getByRole('heading', { name: 'Alice’s Evidence', exact: true })

  await reader.waitFor()
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio')
    return audio?.readyState >= HTMLMediaElement.HAVE_METADATA && audio.duration > 9_000 && audio.duration < 10_000
  })
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
  await reader.waitFor()
  await bookmarkMenu.locator('summary').click()
  await bookmarkOnPage(finalPage).waitFor()
  assert.equal(await bookmarkToDelete.count(), 0, 'Deleted bookmark should stay deleted after reload')
  await bookmarkOnPage(finalPage).click()
  await finalChapter.waitFor()
  assert.equal(await pageNumber.inputValue(), finalPage, 'Bookmark should restore the saved page after reload')
  await page.waitForFunction((start) => Math.abs(document.querySelector('audio').currentTime - start) < 0.1, chapterStart)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: /Back to start/ }).click()
  await page.getByRole('heading', { name: 'Audiobooks', exact: true }).waitFor()
  const back = page.getByRole('link', { name: 'Back to GitHub repository', exact: true })
  assert.equal(await back.getAttribute('href'), repoUrl)
  await page.getByRole('button', { name: 'Read Along', exact: true }).click()
  await reader.waitFor()

  assert.deepEqual(errors, [], 'Browser did not complete the smoke test without JavaScript errors')
  console.log(
    'Read Along smoke passed: 12 chapters, playback and highlighting, automatic page turn, bookmark deletion and restore after reload, and library navigation.'
  )
} finally {
  await browser.close()
}
