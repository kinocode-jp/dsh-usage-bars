// DSH の Typert ゲートウェイ経由で公開する、ホスト側の使用量サービス。
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { SOURCES, antigravityFromModelRoutes } from './sources.js'
import { dshHome, setCredentialResolver } from './util.js'
import { QUOTA_SOURCES, keyNamesBySource, provider, quotaRoute, routeKeyNames, sourceToProvider } from './vendor/catalog/index.js'
import { patchSchema, daysSchema, safeSource, plainJson } from './contracts.js'
import { TYPERT } from './typert.host.js'

export const name = 'usage-bars'
const TTL_MS = { codex: 60_000, claude: 5 * 60_000, antigravity: 30_000 }
// 設定画面に出す認証情報の名前は共有カタログから取得する。
// クォータ用と、モデル登録ルートが参照するAPIキー名の両方を許可する。
export const KEY_NAMES = keyNamesBySource()
const ROUTE_KEY_NAMES = routeKeyNames()

const DEFAULTS = { enabled: {}, order: [], collapsedDefault: false, showReset: true, showText: true, showPlan: true, warnAt: 70, overAt: 90, refreshSeconds: 60,
  style: 'standard', theme: 'auto', strip: false, chips: false, notify: false, pace: true, history: true }
const BOOLEAN_KEYS = ['collapsedDefault', 'showReset', 'showText', 'showPlan', 'strip', 'chips', 'notify', 'pace', 'history']
const ROUTE_KEY_SET = new Set(Object.values(ROUTE_KEY_NAMES).flat())
// 旧版や手動設定で使われていた別名。移行時に捨てず、資格情報へ移す。
const LEGACY_KEY_NAMES = ['ZAI_API_KEY', 'BIGMODEL_API_KEY', 'KIMI_API_KEY', 'KIMI_COOKIE', 'WARP_TOKEN', 'FACTORY_TOKEN', 'COPILOT_TOKEN', 'GITHUB_COPILOT_TOKEN', 'CODEXBAR_OPENCODE_WORKSPACE_ID']
const KEY_SET = new Set([...Object.values(KEY_NAMES).flat(), ...Object.values(ROUTE_KEY_NAMES).flat(), ...LEGACY_KEY_NAMES])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const num = (v, lo, hi, d) => ((typeof v !== 'number' && typeof v !== 'string') || v === '' || !Number.isFinite(Number(v)) ? d : Math.max(lo, Math.min(hi, Number(v))))

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + randomBytes(12).toString('hex') + '.tmp'
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, file)
  } finally {
    try { fs.unlinkSync(tmp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

// パスを省略するとメモリ内だけで動作する。サービス生成時に実際の使用量は読まない。
export function createUsageService({ sources = SOURCES, configPath, historyPath, modelRoutes, credentials } = {}) {
  let disposed = false
  const credentialsOf = () => (typeof credentials === 'function' ? credentials() : credentials) || null
  const modelRoutesOf = () => (typeof modelRoutes === 'function' ? modelRoutes() : modelRoutes) || null
  const active = () => { if (disposed) throw new Error('Usage service is disposed') }
  const cache = new Map()
  let generation = 0, history = null, historyDirty = false, memoryConfig = {}
  const isSource = id => typeof id === 'string' && Object.hasOwn(sources, id)
  function normalize(raw) {
    raw = object(raw) ? raw : {}
    const cfg = { ...DEFAULTS, enabled: {}, order: [], keys: {} }
    if (object(raw.enabled)) for (const [id, value] of Object.entries(raw.enabled)) if (isSource(id) && typeof value === 'boolean') cfg.enabled[id] = value
    if (Array.isArray(raw.order)) cfg.order = [...new Set(raw.order.filter(isSource))]
    for (const key of BOOLEAN_KEYS) if (typeof raw[key] === 'boolean') cfg[key] = raw[key]
    if (['standard', 'compact', 'simple'].includes(raw.style)) cfg.style = raw.style
    if (['auto', 'light', 'dark', 'warm'].includes(raw.theme)) cfg.theme = raw.theme
    cfg.warnAt = num(raw.warnAt, 1, 100, 70)
    cfg.overAt = Math.max(cfg.warnAt, num(raw.overAt, 1, 100, 90))
    cfg.refreshSeconds = num(raw.refreshSeconds, 15, 3600, 60)
    if (object(raw.keys)) for (const [key, value] of Object.entries(raw.keys)) if (KEY_SET.has(key) && typeof value === 'string' && value.trim()) cfg.keys[key] = value.trim()
    return cfg
  }
  function config() {
    if (!configPath) return normalize(memoryConfig)
    try { return normalize(JSON.parse(fs.readFileSync(configPath, 'utf8'))) } catch { return normalize({}) }
  }
  // 平文キーが残っている場合、資格情報へ1回だけ移して設定ファイルから消す。
  let migration = null
  async function ensureMigrated() {
    active()
    if (migration) return migration
    const store = credentialsOf()
    if (!store || typeof store.set !== 'function' || !configPath) return
    migration = (async () => {
      const initial = config()
      const names = Object.keys(initial.keys || {})
      if (!names.length) return
      const migrated = []
      for (const name of names) {
        active()
        let source = ''
        try {
          const described = await store.describe?.(name)
          if (described?.configured) source = described.source || 'unknown'
        } catch {}
        active()
        if (source !== 'file') {
          let resolved = ''
          try { resolved = (await store.resolve?.(name))?.value ?? '' } catch {}
          active()
          // 環境変数側に新しい値がある場合、古い設定値で上書きせず、平文も残さない。
          if (source && resolved && resolved !== initial.keys[name]) { migrated.push(name); continue }
          active()
          await store.set(name, initial.keys[name])
          active()
        }
        migrated.push(name)
      }
      active()
      if (!migrated.length) return
      // 待機中に表示設定が変わっていても失わないよう、保存直前に読み直す。
      let fresh = {}
      try { fresh = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
      const keys = object(fresh.keys) ? { ...fresh.keys } : {}
      for (const name of migrated) delete keys[name]
      fresh.keys = keys
      writeAtomic(configPath, JSON.stringify(normalize(fresh), null, 2))
      generation++
      cache.clear()
    })().catch(() => { migration = null })
    return migration
  }
  async function publicConfig() {
    active()
    const { keys, ...cfg } = config()
    const keysSet = Object.fromEntries(Object.keys(keys).map(key => [key, true]))
    const keysSource = {}
    const store = credentialsOf()
    if (store && typeof store.describe === 'function') {
      for (const name of KEY_SET) {
        active()
        try {
          const described = await store.describe(name)
          if (described?.configured) { keysSet[name] = true; keysSource[name] = described.source || 'stored' }
        } catch {}
      }
    }
    active()
    for (const id of Object.keys(sources)) observeRoute(id)
    return plainJson({ ...cfg, keysSet, keysSource, keyNames: KEY_NAMES, sourceIds: Object.keys(sources),
      sourceProvider: Object.fromEntries(Object.keys(sources).map(id => [id, sourceToProvider(id)])),
      sourceRoute: Object.fromEntries(Object.keys(sources).map(id => [id, quotaRoute(id)])),
      // 使用量を取得していない(無効の)サービスにも、IDではなく表示名を出すため。
      sourceLabels: Object.fromEntries(Object.keys(sources).map(id => [id, QUOTA_SOURCES[id]?.labels?.ja ?? id])),
      routes: routeSnapshot(), routeKeyNames: ROUTE_KEY_NAMES,
      registeredModels: (() => {
        const routes = routeSnapshot() || {}
        const models = []
        for (const record of Object.values(routes)) for (const kind of ['subscription', 'api']) {
          const route = record?.[kind]
          if (!route?.enabled || !Array.isArray(route.models)) continue
          for (const model of route.models) models.push(model.name || model.id)
        }
        return [...new Set(models)]
      })(),
      providerLabels: Object.fromEntries(Object.keys(ROUTE_KEY_NAMES).map(id => [id, provider(id)?.labels?.ja ?? id])) })
  }
  async function saveConfig(patch) {
    active()
    patch = patchSchema.parse(patch)
    const raw = config(), merged = { ...raw }
    // Invalid patch members do not erase existing settings.
    if (object(patch.enabled)) merged.enabled = { ...raw.enabled, ...Object.fromEntries(Object.entries(patch.enabled).filter(([id, value]) => isSource(id) && typeof value === 'boolean')) }
    if (Array.isArray(patch.order)) merged.order = patch.order
    for (const key of BOOLEAN_KEYS) if (typeof patch[key] === 'boolean') merged[key] = patch[key]
    if (['standard', 'compact', 'simple'].includes(patch.style)) merged.style = patch.style
    if (['auto', 'light', 'dark', 'warm'].includes(patch.theme)) merged.theme = patch.theme
    for (const key of ['warnAt', 'overAt', 'refreshSeconds']) if (Object.hasOwn(patch, key)) merged[key] = patch[key]
    let keysChanged = false
    if (object(patch.keys)) {
      merged.keys = { ...raw.keys }
      const store = credentialsOf()
      const entries = Object.entries(patch.keys).filter(([key, value]) => KEY_SET.has(key) && typeof value === 'string')
      // 書き込み前に全件検証し、途中で拒否されて一部だけ保存されるのを避ける。
      for (const [key] of entries) {
        if (ROUTE_KEY_SET.has(key) && !(store && typeof store.set === 'function')) {
          throw new Error('この環境ではDSHの資格情報に保存できないため、モデル登録用キーは保存できません')
        }
      }
      for (const [key, value] of entries) {
        active()
        keysChanged = true
        const trimmed = value.trim()
        // DSH の資格情報に保存できるならそちらを唯一の保存先にし、設定ファイルからは消す。
        if (store && typeof store.set === 'function') {
          if (trimmed) await store.set(key, trimmed)
          else if (typeof store.unset === 'function') await store.unset(key)
          active()
          delete merged.keys[key]
        } else if (trimmed) merged.keys[key] = trimmed
        else delete merged.keys[key]
      }
    }
    active()
    const next = normalize(merged)
    if (configPath) writeAtomic(configPath, JSON.stringify(next, null, 2))
    else memoryConfig = next
    if (keysChanged || JSON.stringify(raw.enabled) !== JSON.stringify(next.enabled)) {
      generation++
      cache.clear()
    }
  }
  function historyStore() {
    if (history) return history
    try {
      const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
      history = object(raw) ? Object.fromEntries(Object.entries(raw).filter(([, points]) => Array.isArray(points)).map(([key, points]) => [key, points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))])) : {}
    } catch { history = {} }
    return history
  }
  function record(value) {
    if (!value || value.status !== 'ok' || value.stale || !Array.isArray(value.bars) || !config().history) return
    const store = historyStore(), now = Date.now()
    for (const bar of value.bars) {
      if (!Number.isFinite(bar.usedPercent)) continue
      const key = value.id + '|' + bar.label
      const points = store[key] ?? (store[key] = [])
      if (points.length && now - points[points.length - 1][0] < 5 * 60_000) continue
      points.push([now, Math.round(bar.usedPercent * 10) / 10])
      while (points.length > 3000 || (points.length && now - points[0][0] > 30 * 86400_000)) points.shift()
      historyDirty = true
    }
  }
  function flushHistory() {
    if (!historyDirty) return
    try { if (historyPath) writeAtomic(historyPath, JSON.stringify(history)); historyDirty = false } catch {}
  }
  function routeSnapshot() {
    try { return modelRoutesOf()?.snapshot?.()?.routes ?? null } catch { return null }
  }
  function routeBlock(id) {
    const providerId = sourceToProvider(id), kind = quotaRoute(id)
    if (!providerId || !kind) return null
    try {
      const record = modelRoutesOf()?.snapshot?.()?.routes?.[providerId]
      const route = record?.[kind]
      return route && route.enabled === false ? route : null
    } catch { return null }
  }
  // External model-route mutations have no notification API. Remember observed
  // OFF/ON transitions per source so an old request cannot cross that boundary.
  const observedRoutes = new Map()
  function observeRoute(id) {
    const blocked = !!routeBlock(id), previous = observedRoutes.get(id)
    const epoch = previous ? previous.epoch + (previous.blocked !== blocked ? 1 : 0) : 0
    if (previous && previous.blocked !== blocked) cache.delete(id)
    const state = { blocked, epoch }
    observedRoutes.set(id, state)
    return state
  }
  // Antigravity は、dsh-model-routes の自前接続(ログイン済みアカウント)があればそちらの残り枠を使う。
  // 無いときや読めないときは、従来どおりローカルの Antigravity アプリから読む。
  async function fetchSource(id) {
    const quota = id === 'antigravity' ? modelRoutesOf()?.antigravityQuota : undefined
    if (typeof quota === 'function') {
      // 失敗は model-routes 側で status: 'error' として返る。ここで投げられるのは接続の不具合だけなので、従来の取得へ回す。
      try { const value = antigravityFromModelRoutes(await quota()); if (value) return value } catch {}
    }
    return sources[id]()
  }
  async function load(id) {
    if (disposed || config().enabled[id] === false) return null
    const startedRoute = observeRoute(id)
    if (startedRoute.blocked) return { id, label: QUOTA_SOURCES[id]?.labels?.ja ?? provider(sourceToProvider(id))?.labels?.ja ?? id, status: 'off', error: 'モデル登録側で無効', bars: [] }
    const hit = cache.get(id)
    if (hit?.pending) return hit.pending
    if (hit && Date.now() - hit.at < (TTL_MS[id] ?? 5 * 60_000)) return hit.value
    const startedGeneration = generation
    const pending = Promise.resolve().then(() => fetchSource(id)).then(value => safeSource(value, id)).catch(error => ({ id, label: id, status: 'error', error: String(error?.message ?? error), bars: [] }))
      .then(value => {
        // 遅れて届いた応答でキャッシュや古いキーの履歴を上書きしない。
        if (disposed) return null
        const route = observeRoute(id)
        if (startedGeneration !== generation || startedRoute.epoch !== route.epoch) return load(id)
        if (route.blocked) return { id, label: value.label, status: 'off', error: 'モデル登録側で無効', bars: [] }
        cache.set(id, { at: Date.now(), value }); record(value); return value
      })
    cache.set(id, { pending })
    return pending
  }
  let saveQueue = Promise.resolve()
  const enqueueSave = task => {
    const guarded = () => { active(); return task() }
    const run = saveQueue.then(guarded, guarded)
    saveQueue = run.catch(() => {})
    return run
  }
  const service = {
    async getConfig() { active(); await ensureMigrated(); return publicConfig() },
    updateConfig(patch) {
      active()
      return enqueueSave(async () => { await ensureMigrated(); await saveConfig(patch); return publicConfig() })
    },
    async getUsage() {
      active()
      await ensureMigrated()
      const list = await Promise.all(Object.keys(sources).map(load))
      flushHistory()
      return plainJson({ at: Date.now(), sources: list.filter(value => value && config().enabled[value.id] !== false) })
    },
    getHistory(days) {
      active()
      const since = Date.now() - daysSchema.parse(days) * 86400_000
      return plainJson(Object.fromEntries(Object.entries(historyStore()).map(([key, points]) => [key, points.filter(p => p[0] >= since)])), 8_000_000)
    },
    clearHistory() { active(); history = {}; historyDirty = true; flushHistory(); return true },
    async setRoute(providerId, kind, enabled) {
      active()
      if (typeof providerId !== 'string' || !providerId || providerId.length > 128) throw new TypeError('プロバイダIDが不正です')
      if (kind !== 'subscription' && kind !== 'api') throw new TypeError('枠は subscription か api を指定してください')
      if (typeof enabled !== 'boolean') throw new TypeError('有効/無効は真偽値で指定してください')
      const routes = modelRoutesOf()
      if (typeof routes?.setRouteEnabled !== 'function') throw new Error('モデル登録側のサービスが見つかりません')
      // Invalidate both edges of an asynchronous route mutation, including failures.
      generation++; cache.clear()
      try { await routes.setRouteEnabled(providerId, kind, enabled) }
      finally { generation++; cache.clear() }
      active()
      return publicConfig()
    },
    dispose() { if (disposed) return; disposed = true; generation++; cache.clear(); flushHistory() },
  }
  Object.defineProperty(service, 'typertRemote', { value: { service, serviceKey: 'usageBars', namespace: 'usageBars' } })
  return service
}

export function apply(ctx) {
  const storage = path.join(dshHome, 'storages', 'usage-bars')
  const service = createUsageService({ configPath: path.join(storage, 'config.json'), historyPath: path.join(storage, 'history.json'),
    modelRoutes: () => ctx.get?.('modelRoutes'), credentials: () => ctx.get?.('credentials') })
  setCredentialResolver(async name => { const store = ctx.get?.('credentials'); if (!store?.resolve) return ''; return (await store.resolve(name))?.value ?? '' })
  ctx.provide('usageBars', service)
  ctx.effect(() => () => { setCredentialResolver(null); service.dispose() }, 'usage-bars: service')
  // パッケージ導入時は typert-loader が検出する。file: の直接導入時だけ
  // 自前で登録し、レジストリが後から来る場合にも備える。
  ctx.inject?.(['typert'], typertCtx => {
    const registry = typertCtx.typert
    if (!registry.getPackage(TYPERT.package, 'host') && ctx.fiber?.entry?.options.name?.startsWith('file:')) {
      const unregister = registry.register(TYPERT)
      if (typeof unregister === 'function') typertCtx.effect(() => unregister, 'usage-bars: typert manifest')
    }
  })
}
