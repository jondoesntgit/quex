// Longer play-through on desktop: build, tick, friend, caravan.
import { chromium } from 'playwright'
const out = process.argv[2] ?? '.'
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` })
await page.goto('http://localhost:5199/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('text=Found village')
await page.fill('input[type=text]', 'Jonathan')
await page.locator('.choice').nth(3).click() // farmers
await page.click('text=Found village')
await page.waitForTimeout(600)
const slots = page.locator('.slot')
for (const i of [0, 1, 2, 3, 4]) await slots.nth(i).locator('button[title=full]').click()
await page.waitForTimeout(200)
// find a buildable neighbour hex by probing around the centre
const box = await page.locator('.map canvas').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
let built = false
for (const [dx, dy] of [[96, 32], [-96, 32], [0, 64], [96, -32], [-96, -32], [0, -64], [192, 0], [-192, 0]]) {
  await page.mouse.click(cx + dx, cy + dy)
  await page.waitForTimeout(250)
  const b = page.locator('button:has-text("Build…")')
  if (await b.count()) {
    await b.click()
    const house = page.locator('.action:has-text("House"):not([disabled])')
    if (await house.count()) { await house.first().click(); built = true; break }
    await page.locator('text=← back').click()
  }
  const close = page.locator('.inspector .close')
  if (await close.count()) await close.click()
}
console.log('built house:', built)
await page.waitForTimeout(300)
await shot('p1-built')
// add a hot-seat friend
await page.click('.tab:has-text("Party")')
await page.click('text=+ Local friend')
await page.fill('.modal input[type=text]', 'Wife')
await page.locator('.modal .choice').first().click()
await page.click('.modal >> text=Found village')
await page.waitForTimeout(600)
await shot('p2-friend')
// friend sends a caravan to Jonathan
await page.click('.tab:has-text("Today")')
await page.locator('.slot').nth(1).locator('button[title=full]').click()
await page.click('.tab:has-text("Party")')
const party = await page.locator('.sheet-body').innerText()
console.log('party:', party.replace(/\s+/g, ' ').slice(0, 300))
// skip a day -> ticks
await page.click('text=Skip to tomorrow')
await page.waitForTimeout(600)
await page.click('.tab:has-text("Log")')
await page.waitForTimeout(200)
console.log('log:', (await page.locator('.sheet-body').innerText()).replace(/\n/g, ' | ').slice(0, 600))
await shot('p3-log')
await page.click('.tab:has-text("Village")')
await page.waitForTimeout(200)
console.log('village:', (await page.locator('.sheet-body').innerText()).replace(/\n/g, ' | ').slice(0, 500))
await shot('p4-village')
console.log('ERRORS', JSON.stringify(errors))
await browser.close()
