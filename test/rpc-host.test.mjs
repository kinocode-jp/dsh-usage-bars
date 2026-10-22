import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createUsageService } from '../lib/index.js'
import { TYPERT } from '../lib/typert.host.js'

// Opt-in runtime location; no runtime dependency is added to the plugin.
// In CI set DSH_RUNTIME_ROOT to the installed DSH directory.
const runtime = process.env.DSH_RUNTIME_ROOT || '/tmp/dshx/dsh'
let modules
let typertLoader
try {
  const require = createRequire(path.join(runtime, 'package.json'))
  modules = await Promise.all(['@deepseek-ai/cordis', '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-gateway', '@deepseek-ai/dsh-api-gateway/client'].map(name => import(pathToFileURL(require.resolve(name)).href)))
  typertLoader = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-loader')).href)
} catch (error) {
  if (process.env.DSH_RUNTIME_ROOT) throw error
}
if (!modules && process.env.DSH_REQUIRE_RUNTIME === '1') throw new Error('DSH_REQUIRE_RUNTIME=1 ですがDSHランタイムを解決できません。DSH_RUNTIME_ROOT を設定してください')


test('real DSH registry and gateway dispatch all six strict methods without a listener', { skip: !modules && 'Install DSH or set DSH_RUNTIME_ROOT for real runtime coverage' }, async t => {
  const [{ Context }, { TypertRegistry }, { TypertGatewayService }] = modules
  typertLoader.validateTypertManifest(TYPERT.package, TYPERT)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-rpc-'))
  const ctx = new Context()
  const service = createUsageService({ configPath: path.join(dir, 'config.json'), historyPath: path.join(dir, 'history.json'), sources: {
    fake: async () => ({ id: 'fake', label: 'Fake', status: 'ok', bars: [{ label: 'Budget', usedPercent: 42 }], secret: 'must not escape' }),
  }, modelRoutes: () => ({ snapshot: () => ({ routes: {} }), setRouteEnabled: async () => {} }) })
  t.after(async () => { service.dispose(); await ctx.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  ctx.provide('remoteAccess', { decide: () => ({ kind: 'deny', reason: 'test-denial' }) })
  await ctx.plugin(TypertRegistry)
  ctx.provide('usageBars', service)
  await ctx.plugin(TypertGatewayService, { websocketHeartbeatIntervalMs: 30000, streamInboxBytes: 1048576 })
  // Verify ./typert package export, not an alternate registration fixture.
  const exported = await import('@kinocode/dsh-usage-bars/typert')
  assert.equal(exported.TYPERT, TYPERT)
  const unregister = ctx.typert.register(exported.TYPERT)
  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal }
  const call = (method, args = {}, who = peer) => ctx.typertGateway.dispatchRpc('usageBars/' + method, { args }, undefined, who)
  let reply = await call('getConfig')
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.deepEqual(reply.value.sourceIds, ['fake'])
  reply = await call('updateConfig', { patch: { showPlan: false, keys: { DEEPSEEK_API_KEY: 'fake-private-value' } } })
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal(reply.value.showPlan, false)
  assert.deepEqual(reply.value.keysSet, { DEEPSEEK_API_KEY: true })
  assert.ok(!JSON.stringify(reply).includes('fake-private-value'))
  reply = await call('getUsage')
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal(reply.value.sources[0].bars[0].usedPercent, 42)
  assert.equal(reply.value.sources[0].secret, undefined)
  reply = await call('setRoute', { provider: 'fake', kind: 'api', enabled: false })
  assert.equal(reply.ok, true, JSON.stringify(reply))
  reply = await call('getHistory', { days: 30 })
  assert.equal(reply.ok, true)
  assert.equal(reply.value['fake|Budget'][0][1], 42)
  assert.equal((await call('getHistory')).ok, true)
  assert.deepEqual(await call('clearHistory'), { ok: true, value: true })
  assert.deepEqual((await call('getHistory')).value, {})
  for (const [method, args] of [['getUsage', { sources: ['fake'] }], ['getConfig', { extra: true }], ['updateConfig', {}], ['updateConfig', { patch: [] }], ['updateConfig', { patch: { x: 'x'.repeat(100001) } }], ['getHistory', { days: '7' }], ['getHistory', { days: 31 }], ['setRoute', { provider: '', kind: 'api', enabled: true }], ['setRoute', { provider: 'fake', kind: 'other', enabled: true }], ['setRoute', { provider: 'fake', kind: 'api', enabled: 'yes' }], ['dispose', {}]]) {
    assert.equal((await call(method, args)).ok, false, method)
  }
  // Load the real browser module and mount its contribution in the real client
  // gateway; the in-memory connection only replaces the physical carrier.
  let browser
  const sandbox = { window: { __ModuleLoader__: { load: def => { browser = def.factory(() => ({})) } } }, document: { getElementById: () => true }, console, setTimeout, clearTimeout }
  vm.runInNewContext(await fs.readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  const client = new Context()
  t.after(() => client.fiber.dispose())
  await client.plugin(TypertRegistry)
  client.provide('connection', { interactions: 'none', rpc: {
    open() {}, call: (prefix, endpoint, payload, signal) => ctx.typertGateway.dispatchRpc(endpoint, payload, signal, peer),
  } })
  await client.plugin(modules[3])
  await client.remote.$mount(browser.__test.CONTRIBUTION)
  const remote = client.get('remote.usageBars')
  assert.equal((await remote.getConfig()).ok, true)
  assert.equal((await remote.updateConfig({ showText: false })).value.showText, false)
  assert.equal((await remote.getUsage()).value.sources[0].id, 'fake')
  assert.equal((await remote.getHistory(7)).ok, true)
  assert.deepEqual(await remote.clearHistory(), { ok: true, value: true })
  assert.equal((await remote.getHistory(1.5)).ok, false)
  const noService = ctx.isolate('usageBars').isolate('typertGateway')
  await noService.plugin(TypertGatewayService, { websocketHeartbeatIntervalMs: 30000, streamInboxBytes: 1048576 })
  assert.equal((await noService.typertGateway.dispatchRpc('usageBars/getConfig', { args: {} }, undefined, peer)).ok, false)
  const denied = await call('getConfig', {}, { ...peer, principal: { kind: 'guest' } })
  assert.equal(denied.ok, false)
  const disposedPeer = new AbortController(); disposedPeer.abort()
  assert.equal((await call('getConfig', {}, { ...peer, signal: disposedPeer.signal })).ok, false)
  unregister()
  assert.equal((await call('getConfig')).ok, false)
})
