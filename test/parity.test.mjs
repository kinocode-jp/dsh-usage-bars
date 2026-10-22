import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createUsageService } from '../lib/index.js'
import { TYPERT } from '../lib/typert.host.js'

// Exercises the browser contribution against the real DSH client and host
// gateways. No HTTP listener and no live provider is involved.
const runtime = process.env.DSH_RUNTIME_ROOT || '/tmp/dshx/dsh'
let modules
try {
  const require = createRequire(path.join(runtime, 'package.json'))
  modules = {
    cordis: await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href),
    registry: await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-registry')).href),
    host: await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway')).href),
    client: await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway/client')).href),
  }
} catch (error) {
  if (process.env.DSH_RUNTIME_ROOT) throw error
}
if (!modules && process.env.DSH_REQUIRE_RUNTIME === '1') throw new Error('DSH_REQUIRE_RUNTIME=1 ですがDSHランタイムを解決できません。DSH_RUNTIME_ROOT を設定してください')


function browserContribution() {
  const source = fsSync.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let exports
  const context = vm.createContext({
    window: { __ModuleLoader__: { load: m => { exports = m.factory(() => ({ createElement() {}, useState() {}, useEffect() {}, useCallback() {} })) } } },
    localStorage: { getItem: () => null, removeItem() {} },
    document: { getElementById: () => true, head: { appendChild() {} }, createElement: () => ({}) },
    Notification: Object.assign(function () {}, { permission: 'denied' }),
    setInterval, clearInterval, Headers, AbortSignal,
  })
  vm.runInContext(source, context)
  return exports.__test.CONTRIBUTION
}

test('browser contribution round-trips all six services through the real client gateway', { skip: !modules && 'Install DSH or set DSH_RUNTIME_ROOT for real runtime coverage' }, async t => {
  const { Context, Service } = modules.cordis
  const { TypertRegistry } = modules.registry
  const { TypertGatewayService } = modules.host
  const { apply: applyClient } = modules.client
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-parity-'))
  const host = new Context()
  const service = createUsageService({
    configPath: path.join(dir, 'config.json'), historyPath: path.join(dir, 'history.json'),
    sources: { fake: async () => ({ id: 'fake', label: 'Fake', status: 'ok', bars: [{ label: 'Budget', usedPercent: 42 }] }) },
    modelRoutes: () => ({ snapshot: () => ({ routes: {} }), setRouteEnabled: async () => {} }),
  })
  t.after(async () => { service.dispose(); await host.fiber.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  host.provide('remoteAccess', { decide: () => ({ kind: 'allow' }) })
  await host.plugin(TypertRegistry)
  host.provide('usageBars', service)
  await host.plugin(TypertGatewayService, { websocketHeartbeatIntervalMs: 30000, streamInboxBytes: 1048576 })
  const unregister = host.typert.register(TYPERT)

  const client = new Context()
  await client.plugin(TypertRegistry)
  let transported = 0
  class Connection extends Service {
    constructor(ctx) {
      super(ctx, 'connection')
      this.interactions = 'none'
      this.rpc = {
        open: async function* () {},
        call: async (channel, endpoint, payload, signal) => {
          assert.equal(channel, '/api'); transported++
          const peer = { principal: { kind: 'owner' }, signal: signal ?? new AbortController().signal }
          return host.typertGateway.dispatchRpc(endpoint, { args: payload.args }, signal, peer)
        },
      }
    }
    openWebSocket() { throw new Error('streams are disabled in this test') }
    registerGenerationSource() { return () => {} }
    start() { return { stop() {} } }
  }
  await client.plugin(Connection)
  await client.plugin({ apply: applyClient })
  const contribution = browserContribution()
  await client.remote.$mount(contribution)
  const remote = client.get('remote.usageBars')
  assert.ok(remote, 'remote.usageBars must exist')

  const config = await remote.getConfig()
  assert.equal(config.ok, true, JSON.stringify(config))
  assert.deepEqual(config.value.sourceIds, ['fake'])
  assert.equal(config.value.keysSet.DEEPSEEK_API_KEY, undefined)

  const saved = await remote.updateConfig({ showPlan: false, keys: { DEEPSEEK_API_KEY: 'parity-secret' } })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.value.showPlan, false)
  assert.deepEqual(saved.value.keysSet, { DEEPSEEK_API_KEY: true })
  assert.ok(!JSON.stringify(saved).includes('parity-secret'))

  const usage = await remote.getUsage()
  assert.equal(usage.ok, true, JSON.stringify(usage))
  assert.equal(usage.value.sources[0].bars[0].usedPercent, 42)
  assert.equal(usage.value.sources[0].secret, undefined)

  const history = await remote.getHistory(30)
  assert.equal(history.ok, true, JSON.stringify(history))
  assert.equal(history.value['fake|Budget'][0][1], 42)
  assert.equal((await remote.getHistory(undefined)).ok, true, 'explicit undefined uses the host default')
  const routed = await remote.setRoute('fake', 'api', false)
  assert.equal(routed.ok, true, JSON.stringify(routed))
  assert.deepEqual((await remote.clearHistory()).value, true)
  assert.deepEqual((await remote.getHistory(7)).value, {})
  assert.ok(transported >= 6)

  const beforeInvalid = transported
  for (const [method, arg] of [['getHistory', 0], ['getHistory', 31], ['getHistory', '7'], ['updateConfig', []], ['updateConfig', null]]) {
    const reply = await remote[method](arg)
    assert.equal(reply.ok, false, method + ' ' + JSON.stringify(arg))
  }
  assert.ok(transported > beforeInvalid, 'host codecs reject invalid arguments')
  unregister()
  assert.equal((await remote.getConfig()).ok, false)
})
