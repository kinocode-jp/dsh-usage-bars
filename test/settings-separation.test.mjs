import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
function settingsHarness() {
  let exports, cursor = 0
  const states = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useEffect() {}, useCallback: fn => fn, useRef: () => ({ current: null }),
  }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: entry => { exports = entry.factory(() => React) } } },
    document: { getElementById: () => true }, localStorage: { getItem: () => null },
    setInterval, clearInterval,
  })
  const fixture = {
    sourceIds: ['fake'], order: [], enabled: {}, keyNames: { fake: ['QUOTA_COOKIE'] }, keysSet: {},
    routes: { fake: { label: 'Fake', api: { enabled: false, modelCount: 0 } } },
    sourceProvider: { fake: 'fake' }, sourceRoute: { fake: 'api' },
    routeKeyNames: { fake: ['MODEL_ONLY_KEY'] }, providerLabels: { fake: 'Fake' },
  }
  exports.__test.store.cfg = fixture
  exports.__test.store.data = { sources: [{ id: 'fake', label: 'Fake', status: 'off', error: 'モデル登録側で無効' }] }
  function flatten(node, out = []) {
    if (node == null || typeof node === 'boolean') return out
    if (Array.isArray(node)) { node.forEach(value => flatten(value, out)); return out }
    if (typeof node !== 'object') { out.push({ text: String(node) }); return out }
    if (typeof node.type === 'function') return flatten(node.type({ ...node.props, children: node.children }), out)
    out.push(node)
    node.children.forEach(child => flatten(child, out))
    return out
  }
  return {
    store: exports.__test.store,
    render() { cursor = 0; return flatten(exports.__test.UsageSettings()) },
    services() { cursor = 0; return flatten(exports.__test.UsageServices()) },
    fixture,
  }
}
const text = nodes => nodes.map(n => n.text || '').join(' ')

test('usage settings expose quota-only tabs even when model route settings are supplied', () => {
  const h = settingsHarness()
  let nodes = h.render()
  const tabs = nodes.filter(n => n.type === 'button' && /\bub-tab\b/.test(n.props.className || ''))
  assert.deepEqual(tabs.map(n => text(n.children.map(value => ({ text: value })))), ['サービス', '表示', '通知', '履歴'])
  for (const tab of tabs) {
    tab.props.onClick()
    nodes = h.render()
    assert.doesNotMatch(text(nodes), /モデル登録\(dsh-model-routes\)|モデル登録のAPIキー/)
    assert.ok(!nodes.some(n => n.type === 'input' && n.props.placeholder === 'MODEL_ONLY_KEY'))
  }
  assert.equal(h.fixture.routes.fake.api.enabled, false, 'reading usage settings never enables a model route')
})

test('quota service credentials remain editable without exposing model-only credentials', () => {
  const h = settingsHarness()
  const nodes = h.services()
  const keyInputs = nodes.filter(n => n.type === 'input' && n.props.type === 'password')
  assert.equal(keyInputs.length, 1, 'only the quota credential is editable here')
  assert.match(keyInputs[0].props['aria-label'], /Cookie/, 'the field names the credential in Japanese')
  assert.equal(keyInputs[0].props.placeholder, 'ここに入力', 'no raw environment name in the placeholder')
  assert.ok(nodes.some(n => n.props?.title === 'QUOTA_COOKIE'), 'the environment name stays available as a tooltip')
  assert.ok(!nodes.some(n => n.props?.title === 'MODEL_ONLY_KEY'))
  assert.match(text(nodes), /モデル側で無効/, 'read-only route status remains available')
  assert.doesNotMatch(source, /call\('setRoute'/, 'usage settings must not mutate model registration')
})

test('credentials owned by Models show guidance instead of a second input', () => {
  const h = settingsHarness()
  h.fixture.keyNames = { fake: ['QUOTA_COOKIE', 'MODEL_ONLY_KEY'] }
  h.fixture.keysSet = { MODEL_ONLY_KEY: true }
  const nodes = h.services()
  const inputs = nodes.filter(n => n.type === 'input' && n.props.type === 'password')
  assert.deepEqual(inputs.map(n => n.props['aria-label']), ['Cookieを入力'],
    'only the credential Models cannot hold keeps an input here')
  assert.ok(!/モデル設定/.test(text(nodes)), 'no explanatory note next to the state')
  const shared = nodes.find(n => n.props?.title === 'MODEL_ONLY_KEY')
  assert.ok(shared, 'the shared key is still named, with its state')
  assert.ok(nodes.some(n => n.props?.className === 'ub-key-state' && text([{ text: n.children[0] }]) === '設定済み'))
})

test('credential fields appear only for enabled services', () => {
  const h = settingsHarness()
  h.fixture.enabled = { fake: false }
  const off = h.services().filter(n => n.type === 'input' && n.props.type === 'password')
  assert.equal(off.length, 0, 'a disabled service reserves no credential field')
  h.fixture.enabled = { fake: true }
  const on = h.services().filter(n => n.type === 'input' && n.props.type === 'password')
  assert.equal(on.length, 1, 'enabling the service is what reveals its credential field')
})

test('the service list mirrors Models and reveals unregistered services on demand', () => {
  const h = settingsHarness()
  h.fixture.routes = {}
  h.fixture.enabled = { fake: false }
  h.fixture.keysSet = {}
  const openService = render => render()
  assert.equal(openService(() => h.services()).filter(n => String(n.props?.className || '').includes('ub-service')).length, 0,
    'a service that Models does not register, is disabled, and has no key is hidden')
  const toggle = h.services().find(n => n.type === 'button' && n.props['aria-label'] === 'モデル未登録のサービスも表示')
  assert.ok(toggle, 'the reveal control is offered')
  toggle.props.onClick()
  const rows = h.services().filter(n => String(n.props?.className || '').includes('ub-service'))
  assert.equal(rows.length, 1, 'the control brings the row back')
})

test('service rows say a successful fetch plainly and name disabled services by label', () => {
  const h = settingsHarness()
  h.fixture.sourceLabels = { fake: 'Fake Quota' }
  h.fixture.routes = { fake: { label: 'Fake', api: { enabled: true, modelCount: 2 } } }
  h.fixture.enabled = { fake: true }
  const store = h.store
  store.data = { sources: [{ id: 'fake', label: 'Fake', status: 'ok' }] }
  let nodes = h.services()
  assert.match(text(nodes), /モデル登録あり（2件） ・ 取得できています/)
  assert.doesNotMatch(text(nodes), /取得中/, 'a successful fetch is not described as in progress')
  store.data = { sources: [] }
  h.fixture.enabled = { fake: false }
  nodes = h.services()
  assert.match(text(nodes), /Fake Quota/, 'a service without a status row still shows its label, not its id')
  assert.match(text(nodes), /使用量を表示しない/)
})

test('usage services render in the usage settings section, not in the Models page', () => {
  assert.doesNotMatch(source, /settings\.models\.footer/, 'the Models page keeps only model registration')
  const h = settingsHarness()
  const nodes = h.render()
  assert.ok(nodes.some(n => String(n.props?.className || '').split(' ').includes('ub-svc-list')), 'the services tab opens first')
})
