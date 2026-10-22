import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createUsageService } from '../lib/index.js'
import { patchSchema, historySchema, safeSource } from '../lib/contracts.js'

const value = (id, usedPercent = 25) => ({ id, label: id, status: 'ok', bars: [{ label: 'Budget', usedPercent }] })
async function fixture(t, sources = { deepseek: async () => value('deepseek') }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-host-'))
  const configPath = path.join(dir, 'config.json'), historyPath = path.join(dir, 'history.json')
  const service = createUsageService({ sources, configPath, historyPath })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  return { service, dir, configPath, historyPath, patch: patch => service.updateConfig(patch) }
}

test('config merges, normalizes, hides secrets, and preserves cache for display patches', async t => {
  let calls = 0
  const { service, patch, configPath } = await fixture(t, { deepseek: async () => { calls++; return value('deepseek') }, openrouter: async () => value('openrouter') })
  await service.getUsage()
  assert.equal(calls, 1)
  let response = await patch({ keys: { DEEPSEEK_API_KEY: '  secret  ', UNKNOWN: 'ignored' }, enabled: { openrouter: false, bad: false }, warnAt: 95, overAt: 20, refreshSeconds: 2, order: ['deepseek', 'deepseek', 'bad'], showText: false, theme: 'dark' })
  let cfg = response
  assert.deepEqual(cfg.keysSet, { DEEPSEEK_API_KEY: true })
  assert.equal(cfg.keys, undefined)
  assert.ok(!JSON.stringify(response).includes('secret'))
  assert.equal(cfg.overAt, 95)
  assert.equal(cfg.refreshSeconds, 15)
  assert.deepEqual(cfg.order, ['deepseek'])
  assert.deepEqual(cfg.enabled, { openrouter: false })
  await service.getUsage()
  assert.equal(calls, 2, 'key patch invalidates provider cache')
  response = await patch({ showPlan: false, warnAt: 60, overAt: 85, keys: [], enabled: [], order: 'bad' })
  cfg = response
  assert.equal(cfg.showText, false)
  assert.equal(cfg.theme, 'dark')
  assert.equal(cfg.showPlan, false)
  assert.deepEqual(cfg.enabled, { openrouter: false })
  assert.deepEqual(cfg.keysSet, { DEEPSEEK_API_KEY: true })
  await service.getUsage()
  assert.equal(calls, 2, 'display-only patch does not invalidate cache')
  await patch({ keys: { DEEPSEEK_API_KEY: '  ', OPENROUTER_API_KEY: ' second ' } })
  const persisted = JSON.parse(await fs.readFile(configPath, 'utf8'))
  assert.deepEqual(persisted.keys, { OPENROUTER_API_KEY: 'second' })
  assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600)
})

test('disabling providers prevents calls and history is recorded and cleared', async t => {
  let calls = 0
  const { service, patch, historyPath } = await fixture(t, { deepseek: async () => { calls++; return value('deepseek') } })
  await patch({ enabled: { deepseek: false } })
  assert.deepEqual((await service.getUsage()).sources, [])
  assert.equal(calls, 0)
  await patch({ enabled: { deepseek: true } })
  assert.equal((await service.getUsage()).sources.length, 1)
  assert.equal(calls, 1)
  const history = (await service.getHistory(30))
  assert.equal(history['deepseek|Budget'][0][1], 25)
  assert.equal(service.clearHistory(), true)
  assert.deepEqual((await service.getHistory()), {})
  assert.deepEqual(JSON.parse(await fs.readFile(historyPath, 'utf8')), {})
})

test('late old-key responses cannot repopulate the cache or history', async t => {
  let release, started, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const didStart = new Promise(resolve => { started = resolve })
  const { service, patch } = await fixture(t, { deepseek: async () => {
    calls++
    if (calls === 1) { started(); await gate; return value('deepseek', 99) }
    return value('deepseek', 12)
  } })
  const oldRequest = service.getUsage()
  await didStart
  await patch({ keys: { DEEPSEEK_API_KEY: 'new-key' } })
  assert.equal((await service.getUsage()).sources[0].bars[0].usedPercent, 12)
  release()
  assert.equal((await oldRequest).sources[0].bars[0].usedPercent, 12)
  assert.equal((await service.getUsage()).sources[0].bars[0].usedPercent, 12)
  assert.equal(calls, 2)
  assert.deepEqual((await service.getHistory())['deepseek|Budget'].map(p => p[1]), [12])
})

test('late responses for disabled providers are discarded', async t => {
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const didStart = new Promise(resolve => { started = resolve })
  const { service, patch } = await fixture(t, { deepseek: async () => { started(); await gate; return value('deepseek') } })
  const pending = service.getUsage()
  await didStart
  await patch({ enabled: { deepseek: false } })
  release()
  assert.deepEqual((await pending).sources, [])
  assert.deepEqual((await service.getHistory()), {})
})

test('factory instances have isolated config, cache, and history', async t => {
  let calls = 0
  const source = { deepseek: async () => { calls++; return value('deepseek') } }
  const first = await fixture(t, source), second = await fixture(t, source)
  await first.service.getUsage()
  await second.service.getUsage()
  assert.equal(calls, 2)
  await first.patch({ enabled: { deepseek: false } })
  assert.equal((await second.service.getUsage()).sources.length, 1)
  await first.service.clearHistory()
  assert.notDeepEqual((await second.service.getHistory()), {})
})


test('bounded plain patches reject unsafe inputs before mutation', async t => {
  const { service } = await fixture(t)
  for (const input of [null, [], 'bad', { x: 'x'.repeat(100001) }, { x: Infinity }, JSON.parse('{"__proto__":{"polluted":true}}')]) await assert.rejects(service.updateConfig(input))
  const cycle = {}; cycle.self = cycle
  assert.throws(() => patchSchema.parse(cycle))
  assert.equal((await service.getConfig()).showPlan, true)
  for (const days of [0, 31, '7', null, NaN, 1.5]) assert.throws(() => service.getHistory(days))
})

test('history codec accepts multiple full thirty-day series and detaches outputs', () => {
  const history = Object.fromEntries(['a', 'b', 'c'].map(key => [key, Array.from({ length: 3000 }, (_, i) => [Date.now() + i, i % 100])]))
  const parsed = historySchema.parse(history)
  assert.deepEqual(parsed, history)
  parsed.a[0][1] = -1
  assert.notEqual(history.a[0][1], -1)
  const safe = safeSource({ status: 'ok', bars: [{ label: 'bad' }, { usedPercent: NaN }, { usedPercent: 180 }, { usedPercent: -20 }], secret: 'private', modelBars: true }, 'fake')
  assert.equal(safe.modelBars, true)
  assert.deepEqual(safe.bars.map(b => b.usedPercent), [100, 0])
  assert.equal(safe.secret, undefined)
})

test('concurrent reads deduplicate, results detach, and disposal suppresses late data', async t => {
  let calls = 0, release, started
  const gate = new Promise(resolve => { release = resolve })
  const didStart = new Promise(resolve => { started = resolve })
  const { service } = await fixture(t, { fake: async () => { calls++; started(); await gate; return value('fake') } })
  const first = service.getUsage(), second = service.getUsage()
  await didStart
  assert.equal(calls, 1)
  release()
  const result = await first
  result.sources[0].bars[0].usedPercent = 99
  assert.equal((await second).sources[0].bars[0].usedPercent, 25)
  assert.equal((await service.getUsage()).sources[0].bars[0].usedPercent, 25)
  service.dispose(); service.dispose()
  await assert.rejects(service.getConfig(), /disposed/)
  await assert.rejects(service.getUsage(), /disposed/)
})

test('dispose while pending never records late usage', async t => {
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const didStart = new Promise(resolve => { started = resolve })
  const { service, historyPath } = await fixture(t, { fake: async () => { started(); await gate; return value('fake') } })
  const pending = service.getUsage()
  await didStart
  service.dispose(); release()
  assert.deepEqual((await pending).sources, [])
  await assert.rejects(fs.readFile(historyPath), { code: 'ENOENT' })
})

test('モデル登録側で無効な枠のクォータは取得しない', async t => {
  let calls = 0
  const routeCalls = []
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-route-'))
  const routed = createUsageService({
    sources: { commandcode: async () => { calls++; return value('commandcode') }, deepseek: async () => value('deepseek', 50) },
    configPath: path.join(dir, 'config.json'), historyPath: path.join(dir, 'history.json'),
    modelRoutes: () => ({ snapshot: () => ({ routes: { commandcode: { label: 'Command Code', subscription: null, api: { enabled: false, routeId: 'commandcode-api', modelCount: 0 } }, openai: { subscription: { enabled: true, routeId: 'openai-codex', modelCount: 3, models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }] }, api: null } } }), setRouteEnabled: async (...args) => { routeCalls.push(args) } }),
  })
  t.after(async () => { routed.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  const usage = await routed.getUsage()
  assert.equal(usage.sources.find(s => s.id === 'commandcode').status, 'off')
  assert.match(usage.sources.find(s => s.id === 'commandcode').error, /モデル登録側で無効/)
  assert.equal(usage.sources.find(s => s.id === 'deepseek').status, 'ok')
  assert.equal(calls, 0, '無効な枠は取得しない')
  const cfg = await routed.getConfig()
  assert.equal(cfg.sourceProvider.commandcode, 'commandcode')
  assert.equal(cfg.sourceRoute.commandcode, 'api')
  assert.equal(cfg.routes.commandcode.api.enabled, false)
  assert.equal(cfg.routes.commandcode.label, 'Command Code')
  assert.deepEqual(cfg.registeredModels, ['GPT-6 Astra'])
  const toggled = await routed.setRoute('commandcode', 'api', true)
  assert.deepEqual(routeCalls, [['commandcode', 'api', true]])
  assert.equal(toggled.routes.commandcode.api.enabled, false, 'モックの snapshot は変わらない')
  await assert.rejects(routed.setRoute('commandcode', 'bad', true), /subscription か api/)
})

test('キーはDSH資格情報に保存し、設定ファイルへ複製しない', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-creds-'))
  const configPath = path.join(dir, 'config.json')
  const stored = new Map()
  const credentials = {
    set: async (name, value) => { stored.set(name, value) },
    unset: async name => { stored.delete(name) },
    describe: async name => ({ configured: stored.has(name) }),
  }
  const service = createUsageService({ sources: { deepseek: async () => value('deepseek') }, configPath, historyPath: path.join(dir, 'history.json'), credentials })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  let cfg = await service.updateConfig({ keys: { DEEPSEEK_API_KEY: ' secret ', ANTHROPIC_API_KEY: ' route-key ' } })
  assert.deepEqual(cfg.keysSet, { DEEPSEEK_API_KEY: true, ANTHROPIC_API_KEY: true })
  assert.equal(stored.get('ANTHROPIC_API_KEY'), 'route-key')
  assert.equal(stored.get('DEEPSEEK_API_KEY'), 'secret')
  assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')).keys, {})
  assert.ok(!JSON.stringify(cfg).includes('secret'))
  cfg = await service.updateConfig({ keys: { DEEPSEEK_API_KEY: '  ' } })
  assert.equal(stored.has('DEEPSEEK_API_KEY'), false)
  assert.deepEqual(cfg.keysSet, { ANTHROPIC_API_KEY: true })
  assert.equal(cfg.routeKeyNames.claude[0], 'ANTHROPIC_API_KEY')
  assert.equal(cfg.providerLabels.claude, 'Claude')
})

test('既存の平文キーを資格情報へ移行し、旧別名も保持する', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-migrate-'))
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(configPath, JSON.stringify({ keys: { DEEPSEEK_API_KEY: 'old', ZAI_API_KEY: 'legacy' } }))
  const stored = new Map()
  const credentials = {
    set: async (name, value) => { stored.set(name, value) },
    unset: async name => { stored.delete(name) },
    describe: async name => ({ configured: stored.has(name) }),
  }
  const service = createUsageService({ sources: { deepseek: async () => value('deepseek') }, configPath, historyPath: path.join(dir, 'history.json'), credentials })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  const cfg = await service.getConfig()
  assert.equal(stored.get('DEEPSEEK_API_KEY'), 'old')
  assert.equal(stored.get('ZAI_API_KEY'), 'legacy')
  assert.deepEqual(cfg.keysSet, { DEEPSEEK_API_KEY: true, ZAI_API_KEY: true })
  assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')).keys, {})
})

test('資格情報が無い環境ではモデル登録用キーを保存しない', async t => {
  const { service } = await fixture(t)
  await assert.rejects(service.updateConfig({ keys: { ANTHROPIC_API_KEY: 'x' } }), /資格情報/)
  await assert.rejects(service.updateConfig({ keys: { COMMANDCODE_API_KEY: 'x' } }), /資格情報/)
  assert.deepEqual((await service.getConfig()).keysSet, {})
})

test('設定保存は直列化され、待機中の別パッチを失わない', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-queue-'))
  const stored = new Map()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const credentials = {
    set: async (name, value) => { await gate; stored.set(name, value) },
    unset: async name => { stored.delete(name) },
    describe: async name => ({ configured: stored.has(name) }),
  }
  const service = createUsageService({ sources: { deepseek: async () => value('deepseek') }, configPath: path.join(dir, 'config.json'), historyPath: path.join(dir, 'history.json'), credentials })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  const first = service.updateConfig({ keys: { DEEPSEEK_API_KEY: 'k' } })
  const second = service.updateConfig({ showPlan: false })
  release()
  await Promise.all([first, second])
  const cfg = await service.getConfig()
  assert.equal(stored.get('DEEPSEEK_API_KEY'), 'k')
  assert.equal(cfg.showPlan, false)
})

test('環境変数由来の値が新しければ古い設定値を書き込まない', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-env-'))
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(configPath, JSON.stringify({ keys: { DEEPSEEK_API_KEY: 'old-config' } }))
  const writes = []
  const credentials = {
    set: async (name, value) => { writes.push([name, value]) },
    unset: async () => {},
    describe: async name => name === 'DEEPSEEK_API_KEY' ? { configured: true, source: 'env' } : { configured: false },
    resolve: async () => ({ value: 'new-env' }),
  }
  const service = createUsageService({ sources: { deepseek: async () => value('deepseek') }, configPath, historyPath: path.join(dir, 'history.json'), credentials })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  assert.deepEqual((await service.getConfig()).keysSource, { DEEPSEEK_API_KEY: 'env' })
  assert.deepEqual(writes, [], '環境変数の新しい値を古い設定値で上書きしない')
  assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')).keys, {}, '古い平文は残さない')
})

test('環境変数由来でも同じ値ならファイルへ保存して移行する', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-env2-'))
  const configPath = path.join(dir, 'config.json')
  await fs.writeFile(configPath, JSON.stringify({ keys: { DEEPSEEK_API_KEY: 'same' } }))
  const writes = []
  const credentials = {
    set: async (name, value) => { writes.push([name, value]) },
    unset: async () => {},
    describe: async name => name === 'DEEPSEEK_API_KEY' ? { configured: true, source: 'env' } : { configured: false },
    resolve: async () => ({ value: 'same' }),
  }
  const service = createUsageService({ sources: { deepseek: async () => value('deepseek') }, configPath, historyPath: path.join(dir, 'history.json'), credentials })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  await service.getConfig()
  assert.deepEqual(writes, [['DEEPSEEK_API_KEY', 'same']])
  assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')).keys, {})
})


test('Antigravity: モデルルートの自前接続にアカウントがあれば、その残り枠を使い、無ければアプリから読む', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-agy-'))
  let quota = { status: 'ok', email: 'a@example.com', bars: [{ model: 'gemini-3.8-flash-tiered', label: 'Gemini 3.8 Flash', remainingFraction: 0.25, resetTime: '2026-10-23T00:00:00Z' }] }
  let localCalls = 0
  const service = createUsageService({ sources: { antigravity: async () => { localCalls++; return value('antigravity') } }, configPath: path.join(dir, 'config.json'), historyPath: path.join(dir, 'history.json'),
    modelRoutes: { snapshot: () => ({ routes: {} }), antigravityQuota: async () => quota } })
  t.after(async () => { service.dispose(); await fs.rm(dir, { recursive: true, force: true }) })
  const first = (await service.getUsage()).sources.find(source => source.id === 'antigravity')
  assert.deepEqual([first.status, first.bars[0].usedPercent, first.bars[0].label, localCalls], ['ok', 75, 'Gemini 3.8 Flash', 0])
  assert.match(first.plan, /a@example\.com/)
  service.dispose()
  quota = { status: 'off', bars: [] }
  const second = createUsageService({ sources: { antigravity: async () => { localCalls++; return value('antigravity') } }, configPath: path.join(dir, 'config.json'), historyPath: path.join(dir, 'history.json'),
    modelRoutes: { snapshot: () => ({ routes: {} }), antigravityQuota: async () => quota } })
  t.after(() => second.dispose())
  await second.getUsage()
  assert.equal(localCalls, 1)
})
