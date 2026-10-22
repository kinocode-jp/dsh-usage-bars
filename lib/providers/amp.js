import { getJson, findKey, offNoKey, fail, clamp, iso } from '../util.js'
const BASE = { id: 'amp', label: 'Amp' }
const num = (s, k) => { const m = s.match(new RegExp('\\b' + k + '\\s*"?\\s*:\\s*(-?[\\d.]+)')); return m ? Number(m[1]) : NaN }
export default async function fetchAmp() {
  try {
    const names = ['AMP_COOKIE']
    const cookie = await findKey(names)
    if (!cookie) return offNoKey(BASE, names)
    const r = await getJson('https://ampcode.com/settings', { cookie, accept: 'text/html', 'user-agent': 'Mozilla/5.0' })
    if (r.status === 401 || r.status === 403) return { ...BASE, status: 'error', error: 'Cookieが期限切れです', bars: [] }
    if (!r.ok) return fail(BASE, r)
    const i = r.text.indexOf('freeTierUsage')
    if (i < 0) return { ...BASE, status: 'error', error: '使用量を解析できません', bars: [] }
    const seg = r.text.slice(i, i + 600)
    const quota = num(seg, 'quota'), used = num(seg, 'used')
    if (!(quota > 0) || !Number.isFinite(used)) return { ...BASE, status: 'error', error: '使用量を解析できません', bars: [] }
    const rate = num(seg, 'hourlyReplenishment')
    const bar = { label: '無料枠', usedPercent: clamp((used / quota) * 100) }
    if (rate > 0 && used > 0) { const at = iso(Date.now() + (used / rate) * 3600000); if (at) bar.resetsAt = at }
    return { ...BASE, status: 'ok', plan: 'Free', bars: [bar] }
  } catch { return { ...BASE, status: 'error', error: '取得に失敗しました', bars: [] } }
}
