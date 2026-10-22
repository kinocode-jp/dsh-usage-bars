// 各サービスの残り使用量を取得する(ホスト側・Node)。
// 返す形: { id, label, status:'ok'|'error'|'off', error?, plan?, bars:[{label, usedPercent, resetsAt?}], text? }
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getJson, findKey } from './util.js'

const run = promisify(execFile)
const home = os.homedir()
const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
const clamp = n => Math.max(0, Math.min(100, Number(n)))
const iso = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '')

/** DSH の .credentials.yaml から refs / records を雑に読む(折り返し行に対応)。 */
function dshCredential(refName) {
  try {
    const text = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8')
    const esc = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = text.match(new RegExp('^[ ]{2}' + esc + ':[ \\t]*(.+?)[ \\t]*(?:#.*)?$', 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch { return '' }
}
function dshRecordField(record, field) {
  try {
    const text = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8')
    const i = text.indexOf(record + ':')
    if (i < 0) return ''
    const block = text.slice(i, i + 6000)
    const m = block.match(new RegExp('\\b' + field + ':\\s*((?:"(?:[^"\\\\]|\\\\.)*"|[^\\n]*))', 's'))
    if (!m) return ''
    return m[1].replace(/\\\n\s*/g, '').replace(/\\\s*\n\s*/g, '').replace(/^"|"$/g, '').replace(/\s+/g, '')
  } catch { return '' }
}

// ── Codex ───────────────────────────────────────────────
export async function fetchCodex() {
  const base = { id: 'codex', label: 'Codex' }
  let auth
  try { auth = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'auth.json'), 'utf8')) }
  catch { return { ...base, status: 'off', error: '~/.codex/auth.json がありません', bars: [] } }
  const token = auth?.tokens?.access_token
  if (!token) return { ...base, status: 'off', error: 'Codex にサインインしていません', bars: [] }
  const headers = { authorization: 'Bearer ' + token, 'user-agent': 'codex-tui/0.149.1' }
  if (auth.tokens.account_id) headers['chatgpt-account-id'] = auth.tokens.account_id
  const r = await getJson('https://chatgpt.com/backend-api/wham/usage', headers)
  if (!r.ok || !r.data) return { ...base, status: 'error', error: 'HTTP ' + r.status + (r.status === 401 ? '(Codex を一度使うとトークンが更新されます)' : ''), bars: [] }
  const limit = r.data.rate_limit ?? {}
  const bars = []
  const add = (label, w) => { if (w && Number.isFinite(Number(w.used_percent))) bars.push({ label, usedPercent: clamp(w.used_percent), resetsAt: iso((w.reset_at ?? 0) * 1000) }) }
  add('5時間', limit.primary_window); add('週', limit.secondary_window)
  return { ...base, status: bars.length ? 'ok' : 'error', error: bars.length ? undefined : '使用量が取得できません', plan: r.data.plan_type, bars }
}

// ── Claude(OAuth) ──────────────────────────────────────
let keychainCache = { at: 0, value: null }
async function claudeTokens() {
  const out = []
  const add = (from, token, expiresAt) => { if (typeof token === 'string' && token.startsWith('sk-ant-')) out.push({ from, token, expiresAt: Number(expiresAt) || 0 }) }
  try { const o = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8'))?.claudeAiOauth; add('~/.claude', o?.accessToken, o?.expiresAt) } catch {}
  // Keychain の読み取りは許可ダイアログが出うるため、ファイルに無いときだけ、30分に1回まで試す。
  if (!out.length && process.platform === 'darwin') {
    if (Date.now() - keychainCache.at > 30 * 60_000) {
      keychainCache = { at: Date.now(), value: null }
      try { const { stdout } = await run('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }); keychainCache.value = JSON.parse(stdout)?.claudeAiOauth ?? null } catch {}
    }
    add('Keychain', keychainCache.value?.accessToken, keychainCache.value?.expiresAt)
  }
  add('DSH', dshRecordField('llm-pi-ai/anthropic', 'access'), dshRecordField('llm-pi-ai/anthropic', 'expires'))
  return out.sort((a, b) => b.expiresAt - a.expiresAt)
}
// 状態は取得元(トークン)ごとに保持。アカウントが変わった場合に旧残量を返さない。
export function createClaudeFetcher({ tokens = claudeTokens, request = getJson, now = Date.now } = {}) {
  let backoffUntil = 0, last = null, identity = ''
  return async function fetchClaude() {
    const base = { id: 'claude', label: 'Claude' }
    const candidates = await tokens()
    if (!candidates.length) return { ...base, status: 'off', error: 'Claude のサインイン情報が見つかりません', bars: [] }
    const found = candidates.find(c => c.expiresAt === 0 || c.expiresAt > now() + 60000)
    if (!found) return { ...base, status: 'error', error: 'トークンの期限切れ。Claude (OAuth) を一度使うと更新されます', bars: [] }
    if (identity !== found.token) { identity = found.token; backoffUntil = 0; last = null }
    const limited = () => last ? { ...last, stale: true } : {
      ...base, status: 'error', error: '一時的に制限中(429)。約' + Math.max(1, Math.ceil((backoffUntil - now()) / 60000)) + '分後に再試行します', bars: [] }
    if (now() < backoffUntil) return limited()
    const r = await request('https://api.anthropic.com/api/oauth/usage', { authorization: 'Bearer ' + found.token, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'claude-code/2.1.0', 'content-type': 'application/json' })
    if (r.status === 429) { backoffUntil = now() + Math.max(r.retryAfter * 1000 || 0, 10 * 60 * 1000); return limited() }
    if (!r.ok || !r.data) return { ...base, status: 'error', error: 'HTTP ' + r.status + '(取得元: ' + found.from + ')', bars: [] }
    const bars = []
    for (const [label, w] of [['5時間', r.data.five_hour], ['週', r.data.seven_day], ['週 Opus', r.data.seven_day_opus], ['週 Sonnet', r.data.seven_day_sonnet]]) {
      if (w && w.utilization !== null && w.utilization !== undefined && Number.isFinite(Number(w.utilization))) bars.push({ label, usedPercent: clamp(w.utilization), resetsAt: w.resets_at ?? '' })
    }
    last = { ...base, status: bars.length ? 'ok' : 'error', error: bars.length ? undefined : '使用量が取得できません', bars }
    return last
  }
}
export const fetchClaude = createClaudeFetcher()

// ── DeepSeek 残高 ───────────────────────────────────────
export async function fetchDeepSeek() {
  const base = { id: 'deepseek', label: 'DeepSeek' }
  const key = await findKey(['DEEPSEEK_API_KEY'])
  if (!key) return { ...base, status: 'off', error: 'DEEPSEEK_API_KEY が未設定です', bars: [] }
  const r = await getJson('https://api.deepseek.com/user/balance', { authorization: 'Bearer ' + key, accept: 'application/json' })
  if (!r.ok || !r.data) return { ...base, status: 'error', error: 'HTTP ' + r.status, bars: [] }
  const text = (r.data.balance_infos ?? []).map(b => (b.currency === 'CNY' ? '¥' : '$') + b.total_balance + (b.currency === 'CNY' ? ' CNY' : ' USD')).join(' / ')
  return { ...base, status: 'ok', bars: [], text: text || '残高情報なし' }
}

// ── Antigravity(ローカル language server) ─────────────────
export async function antigravityPorts(pid, execute = run) {
  if (!/^\d+$/.test(pid)) return []
  try {
    const { stdout } = await execute('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pid], { timeout: 5000, maxBuffer: 1024 * 1024 })
    // -a は PID / TCP / LISTEN の条件を AND する。出力側でも所有PIDを照合。
    return [...new Set(stdout.split('\n').filter(line => line.trim().split(/\s+/)[1] === pid)
      .flatMap(line => [...line.matchAll(/:(\d+)\s+\(LISTEN\)/g)].map(m => m[1])))]
  } catch { return [] }
}
export async function fetchAntigravity() {
  const base = { id: 'antigravity', label: 'Antigravity' }
  let ps
  try { ps = (await run('ps', ['-ax', '-o', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 })).stdout } catch { return { ...base, status: 'off', error: 'ps を実行できません', bars: [] } }
  const line = ps.split('\n').find(l => /language_server/.test(l) && /antigravity/i.test(l) && /--csrf_token/.test(l))
  if (!line) return { ...base, status: 'off', error: 'Antigravity が起動していません', bars: [] }
  const pid = line.trim().split(/\s+/)[0]
  const csrf = (line.match(/--csrf_token\s+(\S+)/) ?? [])[1]
  const extPort = (line.match(/--extension_server_port\s+(\d+)/) ?? [])[1]
  const ports = await antigravityPorts(pid)
  const body = JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en', ideVersion: 'unknown' } })
  const call = (scheme, port, rpc) => new Promise(resolve => {
    const req = (scheme === 'https' ? https : require_http()).request({ host: '127.0.0.1', port, path: '/exa.language_server_pb.LanguageServerService/' + rpc, method: 'POST', rejectUnauthorized: false, timeout: 4000,
      headers: { 'content-type': 'application/json', 'x-codeium-csrf-token': csrf, 'connect-protocol-version': '1', 'content-length': Buffer.byteLength(body) } }, res => {
      let t = ''; res.on('data', c => { t += c }); res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(t) : null) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null) }); req.end(body)
  })
  let status = null
  for (const port of ports) { status = await call('https', port, 'GetUserStatus'); if (status) break }
  if (!status && extPort && ports.includes(extPort)) status = await call('http', extPort, 'GetUserStatus')
  if (!status) return { ...base, status: 'error', error: 'language server に接続できません', bars: [] }
  const configs = status.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? []
  const bars = []
  for (const c of configs) {
    const q = c.quotaInfo; const f = Number(q?.remainingFraction)
    if (!q || !Number.isFinite(f)) continue
    bars.push({ label: String(c.label ?? c.modelOrAlias?.model ?? 'model'), usedPercent: clamp((1 - f) * 100), resetsAt: q.resetTime ?? '' })
  }
  return { ...base, status: bars.length ? 'ok' : 'error', error: bars.length ? undefined : 'クォータ情報なし', plan: status.userStatus?.planStatus?.planInfo?.planName, bars, modelBars: true }
}
/** dsh-model-routes の自前 Antigravity 接続が返す残り枠を、バーの形にする。アカウントが無ければ null(従来の取得へ)。 */
export function antigravityFromModelRoutes(quota) {
  if (!quota || quota.status === 'off' || !Array.isArray(quota.bars)) return null
  const base = { id: 'antigravity', label: 'Antigravity' }
  if (quota.status !== 'ok') return { ...base, status: 'error', error: String(quota.error || 'クォータ情報なし'), bars: [] }
  const bars = quota.bars.filter(bar => Number.isFinite(Number(bar?.remainingFraction))).map(bar => ({ label: String(bar.label ?? bar.model ?? 'model'), usedPercent: clamp((1 - Number(bar.remainingFraction)) * 100), resetsAt: String(bar.resetTime ?? '') }))
  return { ...base, status: bars.length ? 'ok' : 'error', error: bars.length ? undefined : 'クォータ情報なし', plan: quota.email ? 'モデルルート: ' + quota.email : 'モデルルート', bars, modelBars: true }
}
const offNoKey = (base, names) => ({ ...base, status: 'off', error: names[0] + ' が未設定です', bars: [] })
const fail = (base, r) => ({ ...base, status: 'error', error: 'HTTP ' + r.status, bars: [] })

// ── CommandCode ────────────────────────────────────────
export async function fetchCommandCode() {
  const base = { id: 'commandcode', label: 'CommandCode' }
  let key = await findKey(['COMMANDCODE_API_KEY'])
  if (!key) { try { const a = JSON.parse(fs.readFileSync(path.join(home, '.commandcode', 'auth.json'), 'utf8')); key = a.apiKey || '' } catch {} }
  if (!key) return offNoKey(base, ['COMMANDCODE_API_KEY'])
  const h = { authorization: 'Bearer ' + key }
  const [c, sub] = await Promise.all([getJson('https://api.commandcode.ai/alpha/billing/credits', h), getJson('https://api.commandcode.ai/alpha/billing/subscriptions', h).catch(() => null)])
  if (!c.ok || !c.data) return fail(base, c)
  const bars = []
  const w = c.data.windowLimits ?? {}
  for (const [k, label] of [['fiveHour', '5時間'], ['weekly', '週']]) {
    const x = w[k]
    if (x && Number(x.cap) > 0 && (Number(x.used) > 0 || Number(x.resetAt) > 0)) bars.push({ label, usedPercent: clamp(x.used / x.cap * 100), resetsAt: iso(Number(x.resetAt)) })
  }
  const monthly = Number(c.data.credits?.monthlyCredits)
  const planId = sub?.data?.data?.planId
  return { ...base, status: 'ok', plan: planId ? String(planId).replace('individual-', '') : undefined, bars, text: Number.isFinite(monthly) ? '月次クレジット残 $' + monthly.toFixed(2) : undefined }
}

// ── OpenRouter ─────────────────────────────────────────
export async function fetchOpenRouter() {
  const base = { id: 'openrouter', label: 'OpenRouter' }
  const key = await findKey(['OPENROUTER_API_KEY'])
  if (!key) return offNoKey(base, ['OPENROUTER_API_KEY'])
  const r = await getJson((process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1') + '/credits', { authorization: 'Bearer ' + key })
  if (!r.ok || !r.data?.data) return fail(base, r)
  const total = Number(r.data.data.total_credits), used = Number(r.data.data.total_usage)
  const bars = total > 0 ? [{ label: 'クレジット', usedPercent: clamp(used / total * 100) }] : []
  return { ...base, status: 'ok', bars, text: '残 $' + (total - used).toFixed(2) + ' / $' + total.toFixed(2) }
}

// ── z.ai / 智谱 ────────────────────────────────────────
export async function fetchZai() {
  const base = { id: 'zai', label: 'Z.ai' }
  const key = await findKey(['Z_AI_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'])
  if (!key) return offNoKey(base, ['Z_AI_API_KEY'])
  const urls = process.env.Z_AI_QUOTA_URL ? [process.env.Z_AI_QUOTA_URL] : ['https://api.z.ai/api/monitor/usage/quota/limit', 'https://open.bigmodel.cn/api/monitor/usage/quota/limit']
  let last = null
  for (const url of urls) {
    const r = await getJson(url, { authorization: 'Bearer ' + key, accept: 'application/json' }).catch(() => null)
    if (!r) continue
    last = r
    const limits = r.data?.data?.limits
    if (!r.ok || !Array.isArray(limits)) continue
    const bars = limits.filter(l => Number.isFinite(Number(l.percentage))).map(l => ({
      label: l.type === 'TOKENS_LIMIT' ? 'トークン' : l.type === 'TIME_LIMIT' ? '時間枠' : String(l.type ?? '枠'),
      usedPercent: clamp(l.percentage), resetsAt: iso(Number(l.nextResetTime)) }))
    if (bars.length) return { ...base, status: 'ok', plan: r.data.data.level, bars }
  }
  return last ? fail(base, last) : { ...base, status: 'error', error: '接続できません', bars: [] }
}

// ── Kimi K2 ────────────────────────────────────────────
export async function fetchKimiK2() {
  const base = { id: 'kimik2', label: 'Kimi K2' }
  const key = await findKey(['KIMI_K2_API_KEY', 'KIMI_API_KEY'])
  if (!key) return offNoKey(base, ['KIMI_K2_API_KEY'])
  const r = await getJson('https://kimi-k2.ai/api/user/credits', { authorization: 'Bearer ' + key })
  if (!r.ok || !r.data) return fail(base, r)
  const d = r.data.data ?? r.data
  const used = Number(d.consumed ?? d.used), left = Number(d.remaining ?? d.balance)
  const total = Number.isFinite(used) && Number.isFinite(left) ? used + left : NaN
  return { ...base, status: 'ok', bars: total > 0 ? [{ label: 'クレジット', usedPercent: clamp(used / total * 100) }] : [], text: Number.isFinite(left) ? '残 ' + left : undefined }
}

// ── Gemini CLI(OAuth) ─────────────────────────────────
export async function fetchGemini() {
  const base = { id: 'gemini', label: 'Gemini CLI' }
  let creds
  try { creds = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'oauth_creds.json'), 'utf8')) } catch { return { ...base, status: 'off', error: '~/.gemini/oauth_creds.json がありません', bars: [] } }
  if (!creds.access_token) return { ...base, status: 'off', error: 'Gemini CLI にサインインしていません', bars: [] }
  if (Number(creds.expiry_date) && Number(creds.expiry_date) < Date.now() + 60000) return { ...base, status: 'error', error: 'トークンの期限切れ。gemini CLI を一度使うと更新されます', bars: [] }
  const h = { authorization: 'Bearer ' + creds.access_token, 'content-type': 'application/json' }
  const load = await getJson('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', h, { method: 'POST', body: JSON.stringify({ metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } }) }).catch(() => null)
  const project = load?.data?.cloudaicompanionProject
  const tier = load?.data?.currentTier?.id
  const r = await getJson('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', h, { method: 'POST', body: JSON.stringify(project ? { project } : {}) })
  if (!r.ok || !r.data) return fail(base, r)
  const lowest = {}
  for (const b of r.data.buckets ?? []) {
    const f = Number(b.remainingFraction); if (!Number.isFinite(f) || !b.modelId) continue
    const kind = /pro/i.test(b.modelId) ? 'Pro' : /flash/i.test(b.modelId) ? 'Flash' : b.modelId
    if (!lowest[kind] || f < lowest[kind].f) lowest[kind] = { f, reset: b.resetTime ?? '' }
  }
  const bars = Object.entries(lowest).map(([label, v]) => ({ label, usedPercent: clamp((1 - v.f) * 100), resetsAt: v.reset }))
  return { ...base, status: bars.length ? 'ok' : 'error', error: bars.length ? undefined : 'クォータ情報なし', plan: tier, bars }
}

import ampSource from './providers/amp.js'
import copilotSource from './providers/copilot.js'
import cursorSource from './providers/cursor.js'
import factorySource from './providers/factory.js'
import jetbrainsSource from './providers/jetbrains.js'
import kiloSource from './providers/kilo.js'
import kimiSource from './providers/kimi.js'
import kiroSource from './providers/kiro.js'
import minimaxSource from './providers/minimax.js'
import ollamaSource from './providers/ollama.js'
import opencodeSource from './providers/opencode.js'
import vertexaiSource from './providers/vertexai.js'
import warpSource from './providers/warp.js'
import httpModule from 'node:http'
function require_http() { return httpModule }

export const SOURCES = { codex: fetchCodex, claude: fetchClaude, gemini: fetchGemini, antigravity: fetchAntigravity, commandcode: fetchCommandCode, deepseek: fetchDeepSeek, openrouter: fetchOpenRouter, zai: fetchZai, kimik2: fetchKimiK2, amp: ampSource, copilot: copilotSource, cursor: cursorSource, factory: factorySource, jetbrains: jetbrainsSource, kilo: kiloSource, kimi: kimiSource, kiro: kiroSource, minimax: minimaxSource, ollama: ollamaSource, opencode: opencodeSource, vertexai: vertexaiSource, warp: warpSource }
