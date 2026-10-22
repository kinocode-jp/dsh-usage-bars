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
  await page.setContent('<style>body{margin:0}.composer{display:flex;justify-content:flex-end;width:calc(100% - 24px);margin:12px;gap:4px}.sibling{flex:none;width:100px}</style><div class="composer"><div class="sibling">composer tools</div><div id="mount" style="display:flex;min-width:0;flex:1;justify-content:flex-end"></div></div>')
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
  const toggle = page.getByRole('button', { name: '使用量を表示' })
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
  await page.getByRole('button', { name: '使用量を折りたたむ' }).focus()
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
} finally { await browser.close() }
