// Found a village by tapping the map, then try to crowd it with a hot-seat friend.
import { chromium } from 'playwright'
const out = process.argv[2] ?? '.'
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` })
await page.goto(process.env.APP_URL ?? 'http://localhost:5199/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('text=Choose where to settle')
await page.fill('input[type=text]', 'Jonathan')
await page.click('text=Choose where to settle')
await page.waitForSelector('.placebar')
await page.click('.zoom button:has-text("－")')
await page.waitForTimeout(200)
await shot('f1-place')
const box = await page.locator('.map canvas').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
const bar = () => page.locator('.placebar').innerText()
async function settleNear(offsets) {
  for (const [dx, dy] of offsets) {
    await page.mouse.click(cx + dx, cy + dy)
    await page.waitForTimeout(150)
    const t = await bar()
    if (t.includes('Settle here as')) return t
    console.log('  tap', dx, dy, '->', t.split('\n')[0])
  }
  return null
}
const ring = []
for (let r = 0; r <= 400; r += 40) for (let a = 0; a < 6; a++) ring.push([Math.round(r * Math.cos(a)), Math.round(r * 0.5 * Math.sin(a))])
console.log('first site:', (await settleNear(ring))?.split('\n').slice(0, 2).join(' / '))
await shot('f2-picked')
await page.click('.placebar >> text=Found village')
await page.waitForTimeout(600)
await shot('f3-founded')
// friend: tapping right next to the first village must be refused
await page.click('.tab:has-text("Party")')
await page.click('text=+ Local friend')
await page.fill('.modal input[type=text]', 'Wife')
await page.click('text=Choose where to settle')
await page.waitForSelector('.placebar')
await page.waitForTimeout(300)
await shot('f4-friend-place')
await page.mouse.click(cx, cy)
await page.waitForTimeout(150)
console.log('tap on village:', (await bar()).split('\n')[0])
const far = []
for (let r = 200; r <= 600; r += 40) for (let a = 0; a < 8; a++) far.push([Math.round(r * Math.cos(a * 0.8)), Math.round(r * 0.5 * Math.sin(a * 0.8))])
console.log('friend site:', (await settleNear(far))?.split('\n').slice(0, 2).join(' / '))
await page.click('.placebar >> text=Found village')
await page.waitForTimeout(600)
await shot('f5-two-villages')
console.log('ERRORS', JSON.stringify(errors))
await browser.close()
