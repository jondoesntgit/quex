// Smoke test: onboarding -> tasks -> build -> next day. Saves screenshots.
import { chromium } from 'playwright'
const out = process.argv[2] ?? '.'
const url = process.argv[3] ?? 'http://localhost:5199/'
const mobile = process.argv[4] === 'mobile'
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } : { viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(url)
await page.waitForSelector('text=Found village', { timeout: 20000 })
await page.screenshot({ path: `${out}/01-onboard.png` })
await page.fill('input[type=text]', 'Jonathan')
await page.locator('.choice').first().click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/02-pick.png` })
await page.click('text=Found village')
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/03-village.png` })
// complete the big task and two small ones
const slots = page.locator('.slot')
await slots.nth(0).locator('input').fill('Lay out PCB')
await slots.nth(0).locator('button[title=full]').click()
await slots.nth(1).locator('button[title=half]').click()
await slots.nth(3).locator('button[title=full]').click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/04-tasks.png` })
// collapse the sheet and tap the village's neighbour hex (centre of screen is the village)
await page.locator('.tab.on').click()
await page.waitForTimeout(200)
const box = await page.locator('.map canvas').boundingBox()
await page.mouse.click(box.x + box.width / 2 + 96, box.y + box.height / 2 + 10)
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/05-inspect.png` })
console.log('ERRORS', JSON.stringify(errors))
await browser.close()
