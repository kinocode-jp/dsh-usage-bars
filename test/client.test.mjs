import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
export function clientHarness() {
  let exports
  const notices = [], removals = []
  const Notification = function(title) { notices.push(title) }; Notification.permission = 'granted'
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: m => { exports = m.factory(() => ({ createElement() {}, useState() {}, useEffect() {}, useCallback() {} })) } } },
    document: { getElementById: () => true }, localStorage: { getItem: () => null, removeItem: key => removals.push(key) },
    Notification, setInterval, clearInterval,
    fetch: () => assert.fail('Client must use DSH RPC, not HTTP'),
  })
  vm.runInContext(source, context)
  return { ...exports.__test, module: exports, notices, context, removals }
}
const success = value => ({ ok: true, value })
function setData(store, used, reset = '2030-01-01T00:00:00Z', extra = {}) {
  store.data = { sources: [{ id: 'codex', label: 'Codex', status: 'ok', bars: [{ label: '週', usedPercent: used, resetsAt: reset }], ...extra }] }
}
test('Notification: threshold edits do not announce reset or crossing', () => {
  const { store, notices } = clientHarness(); store.cfg = { notify: true }
  setData(store, 80); store.notify(); store.cfg.warnAt = 85; store.notify()
  assert.equal(notices.length, 0)
  store.cfg.warnAt = 70; store.notify(); assert.equal(notices.length, 0)
})
test('Notification: real reset and crossing notify once, stale values do not', () => {
  const { store, notices } = clientHarness(); store.cfg = { notify: true }
  setData(store, 60); store.notify(); setData(store, 80); store.notify(); store.notify()
  assert.equal(notices.length, 1)
  setData(store, 1, '2030-01-08T00:00:00Z'); store.notify(); store.notify()
  assert.equal(notices.length, 2); assert.match(notices[1], /リセット/)
  setData(store, 99, '2030-01-08T00:00:00Z', { stale: true }); store.notify(); assert.equal(notices.length, 2)
})
test('RPC wrapper unwraps DSH result and reports errors without HTTP', async () => {
  const { store, call } = clientHarness()
  store.bind({ getConfig: async () => success({ refreshSeconds: 60 }) })
  assert.equal((await call('getConfig')).refreshSeconds, 60)
  store.bind({ getConfig: async () => ({ ok: false, error: { message: 'fixture-error' } }) })
  await assert.rejects(call('getConfig'), /fixture-error/)
  store.bind(null); await assert.rejects(call('getConfig'), /接続できません/)
})
test('Polling uses saved interval after initial async config load, cleans timers on unbind', async () => {
  const { store, context } = clientHarness()
  const active = new Map(); let next = 0
  context.setInterval = (_fn, delay) => { const id = ++next; active.set(id, delay); return id }
  context.clearInterval = id => active.delete(id)
  store.bind({ getConfig: async () => success({ refreshSeconds: 3600 }), getUsage: async () => success({ sources: [] }) })
  const unsubscribe = store.subscribe(() => {})
  await store.refresh()
  assert.deepEqual([...active.values()], [3600000])
  store.bind(null); assert.equal(active.size, 0); assert.equal(store.cfg, null)
  unsubscribe()
})
test('Unmount during a request discards its late result', async () => {
  const { store } = clientHarness()
  let finish
  store.bind({ getConfig: () => new Promise(resolve => { finish = resolve }) })
  const pending = store.refresh(); await Promise.resolve()
  store.bind(null); finish(success({ refreshSeconds: 60 })); await pending
  assert.equal(store.cfg, null); assert.equal(store.data, null)
})
test('Client mounts six DSH methods automatically, cleans remote contribution and slots', async () => {
  const { module, store, CONTRIBUTION, removals } = clientHarness()
  const registrations = [], cleanups = []; let unmounted = 0
  const service = { getConfig: async () => success({ refreshSeconds: 60 }), getUsage: async () => success({ sources: [] }) }
  const slots = { inject: (_target, fn) => { const off = fn(); if (off) cleanups.push(off) }, register: (options) => { registrations.push(options); return () => {} } }
  await module.apply({ remote: { $mount: async c => { assert.equal(c, CONTRIBUTION); return () => unmounted++ } },
    get: k => k === 'remote.usageBars' ? service : k === 'slots' ? slots : undefined,
    effect: fn => { const off = fn(); if (off) cleanups.push(off) },
  })
  assert.equal(CONTRIBUTION.descriptors.length, 6); assert.equal(registrations.length, 4, 'the usage service list lives in the usage settings section, not the Models footer')
  assert.ok(!registrations.some(options => options.name === 'settings.models.footer'))
  // The strip leads the dock above the composer, ahead of DSH's todo (0), goal (10) and queue (20) rows.
  const strip = registrations.find(options => options.id === 'usage-bars-strip')
  assert.equal(strip.name, 'conversation.input.dock')
  assert.ok(strip.order < 0, 'order ' + strip.order + ' sorts before every stock dock row')
  assert.deepEqual(removals, ['dsh-usage-bars.connection-token'])
  assert.equal((await module.__test.call('getConfig')).refreshSeconds, 60)
  cleanups.forEach(off => off()); assert.equal(unmounted, 1); assert.equal(store.cfg, null)
})
