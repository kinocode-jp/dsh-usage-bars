import { getJson, findKey, offNoKey, fail, clamp } from '../util.js'

const NAMES = ['CURSOR_COOKIE']
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)

export default async function fetchCursor() {
  const base = { id: 'cursor', label: 'Cursor' }
  try {
    let cookie = await findKey(NAMES)
    if (!cookie) return offNoKey(base, NAMES)
    cookie = cookie.replace(/^cookie:\s*/i, '').trim()
    // 値だけ貼られた場合はセッショントークンとして扱う
    if (!cookie.includes('=')) cookie = 'WorkosCursorSessionToken=' + cookie
    const r = await getJson('https://cursor.com/api/usage-summary', { Cookie: cookie, Accept: 'application/json' })
    if (r.status === 401 || r.status === 403) return { ...base, status: 'error', error: 'Cookieが無効または期限切れです', bars: [] }
    if (!r.ok || !r.data) return fail(base, r)
    const d = r.data
    const ind = d.individualUsage ?? {}
    const plan = ind.plan ?? {}
    const od = ind.onDemand ?? {}
    const end = d.billingCycleEnd
    const resetsAt = end && !isNaN(Date.parse(end)) ? new Date(end).toISOString() : undefined
    const bars = []
    let p = num(plan.totalPercentUsed)
    if (p === null) { const u = num(plan.used), l = num(plan.limit); if (u !== null && l) p = (u / l) * 100 }
    if (p !== null) bars.push({ label: '月', usedPercent: clamp(p), ...(resetsAt && { resetsAt }) })
    const ou = num(od.used), ol = num(od.limit)
    if (ou !== null && ol) bars.push({ label: '従量課金', usedPercent: clamp((ou / ol) * 100), ...(resetsAt && { resetsAt }) })
    const out = { ...base, status: 'ok', plan: d.membershipType, bars }
    if (ou !== null) out.text = '従量課金: $' + (ou / 100).toFixed(2) + (ol ? ' / $' + (ol / 100).toFixed(2) : '')
    return out
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
