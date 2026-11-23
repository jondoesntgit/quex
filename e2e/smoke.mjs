// Smoke test: found a village, earn actions, gather (with the confirmation), build a home in the city,
// lay cobblestone, and try the split window. Saves screenshots; exits 1 if a step fails or the page errors.
//   node e2e/smoke.mjs [screenshot dir] [url] [mobile]
// Run it against a dev server with the offline build (writes nothing to the live database):
//   VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199
import { chromium } from 'playwright'
const out = process.argv[2] ?? '.'
const url = process.argv[3] ?? 'http://localhost:5199/'
const mobile = process.argv[4] === 'mobile'
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } : { viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(8000)
const errors = [], failed = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failed.push(what) }
const text = async (sel) => (await page.locator(sel).innerText().catch(() => '')).replace(/\n+/g, ' | ')

await page.goto(url)
await page.getByPlaceholder('Your name').waitFor({ timeout: 20000 })
await page.screenshot({ path: `${out}/01-onboard.png` })
await page.getByPlaceholder('Your name').fill('Jonathan')
await page.getByText('Choose where to settle').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/02-pick.png` })

// tap land until the map says it can be settled
const found = page.locator('button', { hasText: 'Found village' })
const box = await page.locator('.map canvas').boundingBox()
let settled = false
for (const [fx, fy] of [[0.33, 0.41], [0.45, 0.35], [0.55, 0.5], [0.4, 0.6], [0.3, 0.3], [0.6, 0.3], [0.5, 0.65], [0.7, 0.45]]) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(500)
  if (await found.isEnabled().catch(() => false)) { settled = true; break }
}
check(settled, 'found a spot that can be settled')
await found.click({ force: true })
await page.waitForTimeout(2200)
await page.screenshot({ path: `${out}/03-village.png` })
check(/\b25\b/.test((await page.locator('.chip').allInnerTexts()).join(' ')), 'a new village starts with 25 people')

// earn actions: the big task, then every slot
const slots = page.locator('.slot')
await slots.nth(0).locator('input').fill('Lay out PCB')
for (let k = 0; k < 6; k++) await slots.nth(k).locator('button[title=full]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/04-tasks.png` })
await page.locator('.tab', { hasText: 'Village' }).click()
await page.waitForTimeout(300)
const cap = (await text('.sheet')).match(/(\d+)\/(\d+)/)
check(cap && cap[1] === '25' && cap[2] === '30', `the village tab shows 25 of 30 places (${cap ? cap[0] : 'none'})`)
await page.locator('.tab.on').click() // collapse the sheet
await page.waitForTimeout(300)

// splitting asks first, and says it can't be undone
await page.locator('.token', { hasText: 'B' }).first().click()
await page.waitForTimeout(250)
check(/can't be undone/.test(await text('.confirm')), 'splitting says it cannot be undone')
await page.getByRole('button', { name: 'No, keep it whole' }).click()
check((await page.locator('.token').allInnerTexts()).includes('B'), 'saying no keeps the action whole')

// gather stone, through the confirmation
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
await page.mouse.click(cx, cy)
await page.waitForTimeout(350)
await page.getByRole('button', { name: /^Gather…/ }).click()
await page.getByRole('button', { name: /Pick up loose stone/ }).click()
await page.waitForTimeout(250)
check(/You spend/i.test(await text('.confirm')) && /You get/i.test(await text('.confirm')), 'gathering shows what is spent and what you get')
await page.screenshot({ path: `${out}/05-gather-confirm.png` })
await page.getByRole('button', { name: 'Yes, do it' }).click()
await page.waitForTimeout(400)

// a home in the city: find a cobbled hex beside the square
let built = false
const offs = []
for (let dy = -150; dy <= 150; dy += 30) for (let dx = -200; dx <= 200; dx += 48) offs.push([dx, dy + (Math.abs(dx / 48) % 2 ? 16 : 0)])
for (const [dx, dy] of offs) {
  if (!dx && !dy) continue
  await page.mouse.click(cx + dx, cy + dy)
  await page.waitForTimeout(150)
  if (!/Cobbled city/.test(await text('.inspector')) || /'s Village/.test(await text('.inspector'))) continue
  await page.getByRole('button', { name: /^Build…/ }).click()
  const cottage = page.getByRole('button', { name: /^Cottage/ })
  if (await cottage.isEnabled().catch(() => false)) {
    await cottage.click()
    await page.waitForTimeout(250)
    check(/room for 12/i.test(await text('.confirm')), 'a cottage says it gives room for 12')
    await page.screenshot({ path: `${out}/06-cottage-confirm.png` })
    await page.getByRole('button', { name: 'Yes, do it' }).click()
    await page.waitForTimeout(500)
    built = true
    break
  }
  await page.keyboard.press('Escape')
}
check(built, 'built a cottage on the cobbles')
await page.keyboard.press('Escape')
await page.locator('.tab', { hasText: 'Village' }).click()
await page.waitForTimeout(300)
const cap2 = (await text('.sheet')).match(/(\d+)\/(\d+)/)
check(cap2 && Number(cap2[2]) === 42, `the cap is 42 after one cottage (${cap2 ? cap2[0] : 'none'})`)
await page.locator('.tab.on').click()
await page.waitForTimeout(300)

// cobblestone on an open hex beside the city
let laid = false
for (const [dx, dy] of offs) {
  await page.mouse.click(cx + dx, cy + dy)
  await page.waitForTimeout(150)
  const build = page.getByRole('button', { name: /^Build…/ })
  if (!(await build.count())) continue
  await build.click()
  const lay = page.getByRole('button', { name: /^Lay cobblestone/ })
  if (await lay.count() && await lay.isEnabled()) {
    await lay.click()
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: 'Yes, do it' }).click()
    await page.waitForTimeout(500)
    laid = true
    break
  }
  await page.keyboard.press('Escape')
}
check(laid, 'laid cobblestone beside the city')
await page.keyboard.press('Escape')
await page.mouse.move(cx, cy)
await page.mouse.wheel(0, -120)
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/07-city.png` })

check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
await browser.close()
if (failed.length) { console.log(`FAILED: ${failed.length}`); process.exit(1) }
console.log('smoke test passed')
