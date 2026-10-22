// Factory (Droid): ~/.factory/auth.json の access_token(Bearer) / FACTORY_TOKEN / FACTORY_COOKIE
import fs from 'node:fs'
import path from 'node:path'
import { getJson, findKey, offNoKey, fail, clamp, iso, home } from '../util.js'

const ID = 'factory'
const base = { id: ID, label: 'Factory (Droid)' }

function fileToken() {
  try { return JSON.parse(fs.readFileSync(path.join(home, '.factory', 'auth.json'), 'utf8')).access_token || '' } catch { return '' }
}
function pct(u) {
  if (!u || typeof u !== 'object') return null
  const allow = Number(u.totalAllowance), used = Number(u.orgTotalTokensUsed ?? u.userTokens)
  // 手元計算を優先 (allowance が極端に大きい場合は無制限扱いで usedRatio を使う)
  if (allow > 0 && allow < 1e12 && Number.isFinite(used)) return clamp(used / allow * 100)
  const r = Number(u.usedRatio)
  if (Number.isFinite(r)) return clamp(r <= 1.001 ? r * 100 : r)
  return null
}

export default async function fetchFactory() {
  try {
    const cookie = await findKey(['FACTORY_COOKIE'])
    const token = (await findKey(['FACTORY_TOKEN', 'FACTORY_API_KEY'])) || fileToken()
    if (!cookie && !token) return offNoKey(base, ['FACTORY_TOKEN'])
    const headers = {
      accept: 'application/json', 'content-type': 'application/json',
      origin: 'https://app.factory.ai', referer: 'https://app.factory.ai/', 'x-factory-client': 'web-app',
    }
    if (token) headers.authorization = 'Bearer ' + token
    if (cookie) headers.cookie = cookie
    const root = 'https://api.factory.ai'
    const me = await getJson(root + '/api/app/auth/me', headers)
    if (me.status === 401 || me.status === 403) return { ...base, status: 'error', error: '認証に失敗しました(トークン期限切れ)', bars: [] }
    const sub = me.data?.organization?.subscription
    const plan = sub?.orbSubscription?.plan?.name || sub?.factoryTier || undefined
    const r = await getJson(root + '/api/organization/subscription/usage', headers, { method: 'POST', body: JSON.stringify({ useCache: true }) })
    if (!r.ok) return fail(base, r)
    const u = r.data?.usage
    const bars = []
    const resetsAt = iso(Number(u?.endDate)) || undefined
    for (const [label, key] of [['標準', 'standard'], ['プレミアム', 'premium']]) {
      const p = pct(u?.[key])
      if (p != null) bars.push({ label, usedPercent: p, ...(resetsAt && { resetsAt }) })
    }
    if (!bars.length) return { ...base, status: 'error', error: '使用量を取得できません', plan, bars: [] }
    return { ...base, status: 'ok', plan, bars }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
