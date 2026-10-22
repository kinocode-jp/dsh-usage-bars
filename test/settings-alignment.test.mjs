import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Settings controls mirror DSH's General section. These values are the measured
// General dimensions; a change here is a deliberate design decision, not a tweak.
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp("'" + escaped + "\\{([^}]*)\\}'"))
  assert.ok(match, `expected a stylesheet rule for ${selector}`)
  return match[1]
}

test('settings rows use the General inset, separator, and type scale', () => {
  assert.match(rule('.ub-srow'), /padding:16px 0/)
  assert.match(rule('.ub-srow'), /border-bottom:\.5px solid/)
  assert.match(rule('.ub-srow'), /gap:24px/)
  assert.match(rule('.ub-srow-title'), /font-size:14px;line-height:22px/)
  assert.match(rule('.ub-srow-desc'), /font-size:12px;line-height:18px/)
})

test('controls use the shared 36px and 28px button sizes with their radii', () => {
  const tab = rule('.ub-tab')
  assert.match(tab, /height:36px/)
  assert.match(tab, /border-radius:var\(--dsw-radius-md,12px\)/)
  assert.match(tab, /font-size:14px;line-height:22px/)
  const action = rule('.ub-set .ub-btn')
  assert.match(action, /height:28px/)
  assert.match(action, /border-radius:var\(--dsw-radius-sm,8px\)/)
  assert.match(action, /font-size:12px;line-height:18px/)
  assert.match(rule('.ub-set .ub-btn-lg'), /height:36px/)
})

test('choice and numeric controls are soft-filled 36px fields, text entry stays bordered', () => {
  const choice = rule('.ub-set input[type=number],.ub-set select')
  assert.match(choice, /height:36px/)
  assert.match(choice, /background:var\(--dsw-alias-bg-module-platform,#f5f6f7\)/)
  assert.match(choice, /border:0/)
  const text = rule('.ub-set input[type=text],.ub-set input[type=password]')
  assert.match(text, /height:32px/)
  assert.match(text, /border:\.5px solid/)
})

test('booleans render the standard 36x20 switch instead of a checkbox', () => {
  const sw = rule('.ub-switch')
  assert.match(sw, /width:36px;height:20px/)
  assert.match(sw, /border-radius:999px/)
  assert.match(source, /role: 'switch'/)
  assert.ok(!/type: 'checkbox'/.test(source), 'settings must not render bare checkboxes')
})

test('wide tables scroll inside their own frame so the page never overflows', () => {
  assert.match(rule('.ub-tablewrap'), /overflow-x:auto/)
  assert.match(source, /min-width:520px/)
})

test('credential rows name the key in Japanese instead of showing the environment name', () => {
  assert.match(source, /const keyLabel = n => \/COOKIE\/i\.test\(n\) \? 'Cookie'/)
  assert.match(source, /el\('span', \{ className: 'ub-key-name', title: n \}/)
  assert.match(source, /'ここに入力'/)
  assert.ok(!/placeholder: cfg\.keysSet\[n\]/.test(source), 'the env name must not be the placeholder')
  assert.ok(!/el\('tbody', null, rows\)/.test(source), 'services are stacked rows, not a table that clips on phones')
})
