import { getJson, findKey, offNoKey, fail, clamp } from '../util.js'

const pct = d => {
  const limit = Number(d?.limit)
  if (!(limit > 0)) return null
  const used = d.used != null ? Number(d.used) : limit - Number(d.remaining)
  return Number.isFinite(used) ? clamp((used / limit) * 100) : null
}
const when = s => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : undefined }

export default async function fetchKimi() {
  const base = { id: 'kimi', label: 'Kimi', bars: [] }
  try {
    const names = ['KIMI_AUTH_TOKEN', 'KIMI_COOKIE']
    let token = await findKey(names)
    if (!token) return offNoKey(base, names)
    const m = token.match(/kimi-auth=([^;\s]+)/)
    if (m) token = m[1]
    else if (/[;=]/.test(token) && !/^[\w.-]+$/.test(token.replace(/^Bearer\s+/i, ''))) return { ...base, status: 'error', error: 'Cookie に kimi-auth が見つかりません', bars: [] }
    token = token.replace(/^Bearer\s+/i, '')
    const r = await getJson('https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages', {
      authorization: 'Bearer ' + token, cookie: 'kimi-auth=' + token,
      'content-type': 'application/json', accept: 'application/json', origin: 'https://www.kimi.com',
      'connect-protocol-version': '1',
    }, { method: 'POST', body: JSON.stringify({ scope: ['FEATURE_CODING'] }) })
    if (r.status === 401 || r.status === 403) return { ...base, status: 'error', error: 'トークンが無効か期限切れです' }
    if (!r.ok || !r.data) return fail(base, r)
    const list = r.data.usages ?? []
    const u = list.find(x => x.scope === 'FEATURE_CODING') ?? list[0]
    if (!u) return { ...base, status: 'error', error: '使用量データを解析できません' }
    const bars = []
    for (const l of u.limits ?? []) {
      const p = pct(l.detail)
      if (p == null) continue
      const dur = Number(l.window?.duration), unit = l.window?.timeUnit ?? ''
      const min = unit.includes('HOUR') ? dur * 60 : unit.includes('DAY') ? dur * 1440 : dur
      const label = min % 1440 === 0 && min >= 1440 ? min / 1440 + '日' : min % 60 === 0 && min ? min / 60 + '時間' : '短期'
      bars.push({ label, usedPercent: p, resetsAt: when(l.detail?.resetTime) })
    }
    const w = pct(u.detail)
    if (w != null) bars.push({ label: '週', usedPercent: w, resetsAt: when(u.detail?.resetTime) })
    if (!bars.length) return { ...base, status: 'error', error: '使用量データを解析できません' }
    return { ...base, status: 'ok', bars }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました' }
  }
}
