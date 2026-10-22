// 各 providers/*.js が共有するヘルパー。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
export const home = os.homedir()
export const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
// テストや起動後に DSH_HOME が変わっても同じ保存先を見る。
const currentDshHome = () => process.env.DSH_HOME || path.join(home, '.dsh')
export const clamp = n => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(100, Number(n))) : 0)
export const iso = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '')

export const MAX_BODY = 2 * 1024 * 1024
export async function getJson(url, headers = {}, { method = 'GET', body, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { method, headers: { 'accept-encoding': 'identity', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, timeoutMs)) })
  const chunks = []; let size = 0
  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BODY) {
          await reader.cancel().catch(() => {})
          const error = new Error('応答サイズが上限(2MB)を超えました')
          error.code = 'RESPONSE_TOO_LARGE'
          throw error
        }
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
  }
  const text = Buffer.concat(chunks).toString('utf8')
  let data = null
  try { data = JSON.parse(text) } catch {}
  const retry = response.headers.get('retry-after')
  const seconds = retry === null || !retry.trim() ? 0 : Number(retry)
  const retryAfter = Number.isFinite(seconds) ? Math.max(0, seconds) : Math.max(0, (Date.parse(retry) - Date.now()) / 1000) || 0
  return { status: response.status, ok: response.ok, data, text, retryAfter }
}
export function dshCredential(refName) {
  try {
    const text = fs.readFileSync(path.join(currentDshHome(), '.credentials.yaml'), 'utf8')
    const esc = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = text.match(new RegExp('^[ ]{2}' + esc + ':[ \\t]*(.+?)[ \\t]*(?:#.*)?$', 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  } catch { return '' }
}
export function usageBarsConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(currentDshHome(), 'storages', 'usage-bars', 'config.json'), 'utf8')) } catch { return {} }
}
// DSH の資格情報サービス(あれば)を優先して解決する。プラグイン起動時に設定する。
let credentialResolver = null
export function setCredentialResolver(resolver) { credentialResolver = typeof resolver === 'function' ? resolver : null }

/** DSH 資格情報 → 環境変数 → usage-bars 設定の keys → .credentials.yaml、の順にキー(や Cookie)を探す。 */
export async function findKey(names) {
  const cfg = usageBarsConfig().keys ?? {}
  for (const n of names) {
    let resolved = ''
    if (credentialResolver) { try { resolved = (await credentialResolver(n)) || '' } catch {} }
    const v = resolved || process.env[n] || cfg[n] || dshCredential(n)
    if (v) return v
  }
  return ''
}
export const offNoKey = (base, names) => ({ ...base, status: 'off', error: names[0] + ' が未設定です', bars: [] })
export const fail = (base, r) => ({ ...base, status: 'error', error: 'HTTP ' + r.status, bars: [] })
