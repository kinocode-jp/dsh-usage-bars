import crypto from 'node:crypto'
import { getJson, findKey, offNoKey, fail, clamp, iso } from '../util.js'
const BASE = { id: 'opencode', label: 'OpenCode' }
const URL_ = 'https://opencode.ai/_server'
const WS_ID = 'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f'
const SUB_ID = '7abeebee372f304e050aaaf92be863f4a86490e382f8c79db68fd94040d691b4'
const bad = error => ({ ...BASE, status: 'error', error, bars: [] })
function win(text, key, label) {
  const i = text.indexOf(key)
  if (i < 0) return null
  const seg = text.slice(i, i + 300)
  const p = seg.match(/usagePercent\s*"?\s*:\s*([\d.]+)/)
  if (!p) return null
  const bar = { label, usedPercent: clamp(p[1]) }
  const s = seg.match(/resetInSec\s*"?\s*:\s*(\d+)/)
  if (s) { const at = iso(Date.now() + Number(s[1]) * 1000); if (at) bar.resetsAt = at }
  return bar
}
export default async function fetchOpenCode() {
  try {
    const names = ['OPENCODE_COOKIE']
    const cookie = await findKey(names)
    if (!cookie) return offNoKey(BASE, names)
    const h = id => ({ cookie, 'x-server-id': id, 'x-server-instance': 'server-fn:' + crypto.randomUUID(), origin: 'https://opencode.ai', referer: 'https://opencode.ai', 'user-agent': 'Mozilla/5.0', accept: '*/*' })
    let wid = ((await findKey(['OPENCODE_WORKSPACE_ID', 'CODEXBAR_OPENCODE_WORKSPACE_ID'])).match(/wrk_[A-Za-z0-9]+/) || [])[0]
    if (!wid) {
      const w = await getJson(URL_ + '?id=' + WS_ID, h(WS_ID))
      if (w.status === 401 || w.status === 403) return bad('Cookieが期限切れです')
      if (!w.ok) return fail(BASE, w)
      wid = (w.text.match(/wrk_[A-Za-z0-9]+/) || [])[0]
      if (!wid) return bad('ワークスペースが見つかりません')
    }
    const r = await getJson(URL_, { ...h(SUB_ID), 'content-type': 'application/json' }, { method: 'POST', body: JSON.stringify([wid]) })
    if (!r.ok) return fail(BASE, r)
    const bars = [win(r.text, 'rollingUsage', '5時間'), win(r.text, 'weeklyUsage', '週')].filter(Boolean)
    if (!bars.length) return bad('使用量を解析できません')
    return { ...BASE, status: 'ok', bars }
  } catch { return bad('取得に失敗しました') }
}
