// Read-only live gateway regression. Uses existing device session; never changes config.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { WebSessions } from '/Volumes/D/Project/dsh-mobile/lib/web-sessions.mjs'
import { chromium } from '/Volumes/D/Project/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
const state = JSON.parse(await readFile(homedir() + '/.dsh/mobile-bridge/state.json', 'utf8'))
const device = Object.keys(state.devices)[0]
const session = new WebSessions({ secret: () => state.webSessionSecret, isActive: id => Object.hasOwn(state.devices, id) }).create(device)
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 DSHMobile/0.3.7' })
  await context.addCookies([{ name: session.cookieName, value: session.value, url: 'https://100.99.7.50:3543', secure: true, httpOnly: true }])
  const page = await context.newPage()
  await page.goto('https://100.99.7.50:3543', { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForFunction(() => window.__dshMobileBridgeClient === 1, { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-mobile-bridge:open-session', { detail: { sessionId: 'session-bce9ab52-11dd-43bb-8724-f18e8b7be66d' } })))
  await page.locator('.ub-chips-toggle').waitFor({ timeout: 20000 })
  for (const width of [320, 390, 600, 768]) {
    await page.setViewportSize({ width, height: 844 })
    for (const expanded of [false, true]) {
      if (expanded) await page.locator('.ub-chips-toggle').click()
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('.ub-chips'), dock = root.closest('[data-composer-dock]')
        const r = root.getBoundingClientRect(), d = dock.getBoundingClientRect(), b = root.querySelector('button').getBoundingClientRect()
        const others = [...dock.querySelectorAll('button')].filter(n => !root.contains(n)).map(n => n.getBoundingClientRect())
        const scroll = root.querySelector('.ub-chips-scroll')
        return { root: { x: r.x, right: r.right, w: r.width }, dock: { x: d.x, right: d.right, w: d.width }, button: { x: b.x, right: b.right, w: b.width }, othersRight: Math.max(...others.map(r => r.right)), scrollWidth: scroll?.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth }
      })
      assert.ok(Math.abs(geometry.root.right - geometry.dock.right) < 1, JSON.stringify(geometry))
      assert.ok(geometry.button.x >= geometry.root.x - 1)
      assert.ok(geometry.othersRight <= geometry.root.x + 1, JSON.stringify(geometry))
      assert.equal(geometry.overflow, false)
      if (expanded) { assert.ok(geometry.scrollWidth >= 39); await page.locator('.ub-chips-toggle').click() }
      console.log('PASS live', width, expanded ? 'expanded' : 'compact', JSON.stringify(geometry))
    }
  }
} finally { await browser.close() }
