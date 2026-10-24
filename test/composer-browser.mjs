// Optional real-React/Chromium regression: node test/composer-browser.mjs
// Override DSH_TEST_DEPS / DSH_TEST_CHROME for another local installation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const deps = process.env.DSH_TEST_DEPS || '/Volumes/D/Project/deepseek-harness/node_modules/.pnpm'
const { chromium } = await import(pathToFileURL(deps + '/playwright@1.61.1/node_modules/playwright/index.mjs'))
const browser = await chromium.launch({ executablePath: process.env.DSH_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('https://usage.test/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><style>body{margin:0}.composer{display:flex;justify-content:flex-end;width:calc(100% - 24px);margin:12px;gap:4px}.sibling{flex:none;width:100px}</style><div class="composer"><div class="sibling">composer tools</div><div id="mount" style="display:flex;min-width:0;flex:1;justify-content:flex-end"></div></div>' }))
  await page.goto('https://usage.test/')
  await page.addScriptTag({ path: deps + '/react@18.3.1/node_modules/react/umd/react.development.js' })
  await page.addScriptTag({ path: deps + '/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/umd/react-dom.development.js' })
  await page.evaluate(() => {
    window.__ModuleLoader__ = { load: m => { window.plugin = m.factory(name => { if (name === 'react') return React; throw Error('fallback title') }) } }
  })
  await page.addScriptTag({ content: readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8') })
  await page.evaluate(() => {
    const t = plugin.__test
    t.store.schedule = () => {}
    t.store.cfg = { chips: true, enabled: {}, order: [] }
    t.store.data = { sources: Array.from({ length: 10 }, (_, i) => ({ id: i === 0 ? 'codex' : 'provider-' + i, label: 'Provider ' + i, status: 'ok', bars: [{ label: '5時間', usedPercent: 100 - i }, { label: '週', usedPercent: 90 - i }, { label: '月', usedPercent: 50 - i }] })) }
    window.root = ReactDOM.createRoot(document.querySelector('#mount'))
    root.render(React.createElement(React.StrictMode, null, React.createElement(t.CornerChips)))
  })
  const toggle = page.locator('.ub-chips-toggle')
  await toggle.waitFor()
  assert.equal(await page.locator('.ub-chip').count(), 0)
  assert.equal(await page.locator('.ub-chips svg').count(), 1)
  await toggle.click()
  assert.equal(await page.locator('.ub-chip').count(), 10)
  assert.equal(await page.locator('.ub-chip').first().innerText(), '100\n|\n90\n|\n50')
  assert.match(await page.locator('.ub-chip').first().getAttribute('title'), /5時間 100%[\s\S]*週 90%[\s\S]*月 50%/)
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const geometry = await page.evaluate(() => {
      const root = document.querySelector('.ub-chips').getBoundingClientRect()
      const mount = document.querySelector('#mount').getBoundingClientRect()
      const chips = [...document.querySelectorAll('.ub-chip')].map(n => n.getBoundingClientRect())
      return { right: root.right, mountRight: mount.right, width: root.width, mountWidth: mount.width, tops: chips.map(r => r.top), overflow: document.documentElement.scrollWidth > innerWidth }
    })
    assert.ok(Math.abs(geometry.right - geometry.mountRight) < 1)
    assert.ok(geometry.width <= geometry.mountWidth + 1)
    assert.equal(new Set(geometry.tops).size, 1)
    assert.equal(geometry.overflow, false)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const scroller = page.locator('.ub-chips-scroll')
  await scroller.evaluate(n => { n.scrollLeft = 100 })
  await page.waitForFunction(() => document.querySelector('.ub-chips-scroll').classList.contains('is-scrolling'))
  await page.waitForFunction(() => !document.querySelector('.ub-chips-scroll').classList.contains('is-scrolling'))
  assert.equal(await toggle.getAttribute('aria-label'), '使用量の一覧')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  await toggle.focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('.ub-chip').count(), 0)
  await page.keyboard.press('Space')
  await scroller.waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.ub-chip').count(), 0)
  // Config/data transitions must not change hook order; collapse/unmount clears scroll timers.
  await page.evaluate(() => { plugin.__test.store.cfg.chips = false; plugin.__test.store.emit() })
  await page.locator('.ub-chips').waitFor({ state: 'detached' })
  await page.evaluate(() => { plugin.__test.store.cfg.chips = true; plugin.__test.store.emit() })
  await toggle.waitFor()
  await toggle.click()
  await scroller.evaluate(n => { n.scrollLeft = 50; n.dispatchEvent(new Event('scroll')) })
  await page.evaluate(() => root.unmount())
  assert.deepEqual(errors, [])
  console.log('PASS: real React StrictMode + Chromium: compact/tap/keyboard, full values, 320/390/768/1280 alignment, scrolling, config transitions, cleanup')

  // The strip above the composer: two copies (a split view), a long row that scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    localStorage.removeItem('dsh-usage-bars.strip-collapsed')
    const t = plugin.__test
    t.store.cfg = { strip: true, enabled: {}, order: [] }
    document.querySelector('#mount').style.cssText = 'display:block'
    document.querySelector('#mount').innerHTML = '<div id="s1" style="width:360px;display:flex;flex-direction:column"></div><div id="s2" style="width:360px;display:flex;flex-direction:column"></div>'
    window.strips = [ReactDOM.createRoot(document.querySelector('#s1')), ReactDOM.createRoot(document.querySelector('#s2'))]
    strips.forEach(r => r.render(React.createElement(React.StrictMode, null, React.createElement(t.QuotaStrip))))
  })
  const strip = page.locator('#s1 .ub-strip')
  await strip.waitFor()
  assert.ok(await strip.evaluate(n => n.scrollWidth > n.clientWidth), 'the long row overflows sideways')
  // The scrollbar shows while moving and goes away when the movement stops.
  await strip.evaluate(n => { n.scrollLeft = 80 })
  await page.waitForFunction(() => document.querySelector('#s1 .ub-strip').classList.contains('is-scrolling'))
  await page.waitForFunction(() => !document.querySelector('#s1 .ub-strip').classList.contains('is-scrolling'))
  // On a device with a mouse the bar also shows while hovered.
  const hoverBox = await strip.boundingBox()
  await page.mouse.move(hoverBox.x + 20, hoverBox.y + hoverBox.height / 2)
  assert.match(await strip.evaluate(n => getComputedStyle(n).scrollbarColor), /rgba\(127, 127, 127, 0\.4\)/)
  // A vertical wheel scrolls it sideways (from the start, so the row's length does not matter).
  await strip.evaluate(n => { n.scrollLeft = 0 })
  await page.waitForTimeout(800)
  const before = await strip.evaluate(n => n.scrollLeft)
  const box = await strip.boundingBox()
  await page.mouse.move(box.x + 50, box.y + box.height / 2)
  await page.mouse.wheel(0, 120)
  await page.waitForFunction(start => document.querySelector('#s1 .ub-strip').scrollLeft > start, before)
  // Collapsing one strip collapses the other and is remembered; expanding re-binds the scroller.
  await page.locator('#s1 .ub-strip-toggle').click()
  await page.locator('#s2 .ub-strip').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => localStorage.getItem('dsh-usage-bars.strip-collapsed')), '1')
  assert.equal(await page.locator('#s2 .ub-strip-toggle').getAttribute('aria-expanded'), 'false')
  await page.locator('#s2 .ub-strip-toggle').click()
  await page.locator('#s1 .ub-strip').waitFor()
  await page.locator('#s1 .ub-strip').evaluate(n => { n.scrollLeft = 30 })
  await page.waitForFunction(() => document.querySelector('#s1 .ub-strip').classList.contains('is-scrolling'))
  // Another tab collapsing it (a storage event) collapses the strips here too.
  await page.evaluate(() => { localStorage.setItem('dsh-usage-bars.strip-collapsed', '1'); window.dispatchEvent(new StorageEvent('storage', { key: 'dsh-usage-bars.strip-collapsed' })) })
  await page.locator('#s1 .ub-strip').waitFor({ state: 'detached' })
  assert.equal(await page.locator('#s1 .ub-strip-toggle').getAttribute('aria-label'), '使用量バー')
  // A sessionStorage event is not about this setting.
  // (The stored value is changed quietly first, so that reacting to the wrong event would show.)
  await page.evaluate(() => { localStorage.setItem('dsh-usage-bars.strip-collapsed', '0'); sessionStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: sessionStorage })) })
  await page.waitForTimeout(200)
  assert.equal(await page.locator('#s1 .ub-strip').count(), 0, 'still collapsed')
  await page.evaluate(() => localStorage.setItem('dsh-usage-bars.strip-collapsed', '1'))
  // Even after this page failed to save once (storage full), another tab's change is still followed.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError') }
    document.querySelector('#s1 .ub-strip-toggle').click() // expand; the save fails
    Storage.prototype.setItem = real
  })
  await page.locator('#s1 .ub-strip').waitFor()
  await page.evaluate(() => { localStorage.setItem('dsh-usage-bars.strip-collapsed', '1'); window.dispatchEvent(new StorageEvent('storage', { key: 'dsh-usage-bars.strip-collapsed', storageArea: localStorage })) })
  await page.locator('#s1 .ub-strip').waitFor({ state: 'detached' })
  // Another tab clearing it (settings switched back on there) opens them again.
  await page.evaluate(() => { localStorage.removeItem('dsh-usage-bars.strip-collapsed'); window.dispatchEvent(new StorageEvent('storage', { key: 'dsh-usage-bars.strip-collapsed', storageArea: localStorage })) })
  await page.locator('#s1 .ub-strip').waitFor()
  await page.locator('#s2 .ub-strip').waitFor()
  await page.evaluate(() => strips.forEach(r => r.unmount()))
  assert.deepEqual(errors, [])
  console.log('PASS: strip: overflow scroll shows its bar only while moving, wheel scrolls sideways, collapse syncs across strips and persists, expand re-binds')
} finally { await browser.close() }
