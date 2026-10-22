import { getJson, findKey, offNoKey, fail, clamp } from '../util.js'
const BASE = { id: 'ollama', label: 'Ollama' }
function section(html, title, label) {
  const i = html.search(new RegExp(title, 'i'))
  if (i < 0) return null
  const seg = html.slice(i, i + 1500)
  const p = seg.match(/(\d+(?:\.\d+)?)\s*%\s*used/i) || seg.match(/width:\s*(\d+(?:\.\d+)?)%/)
  if (!p) return null
  const bar = { label, usedPercent: clamp(p[1]) }
  const t = seg.match(/data-time="([^"]+)"/)
  if (t && !isNaN(Date.parse(t[1]))) bar.resetsAt = new Date(t[1]).toISOString()
  return bar
}
export default async function fetchOllama() {
  try {
    const names = ['OLLAMA_COOKIE']
    const cookie = await findKey(names)
    if (!cookie) return offNoKey(BASE, names)
    const r = await getJson('https://ollama.com/settings', { cookie, accept: 'text/html', 'user-agent': 'Mozilla/5.0' })
    if (r.status === 401 || r.status === 403) return { ...BASE, status: 'error', error: 'Cookieが期限切れです', bars: [] }
    if (!r.ok) return fail(BASE, r)
    const bars = [section(r.text, 'Session usage', '5時間'), section(r.text, 'Weekly usage', '週')].filter(Boolean)
    if (!bars.length) return { ...BASE, status: 'error', error: '使用量を解析できません', bars: [] }
    const pm = r.text.match(/Cloud Usage[\s\S]{0,400}?>\s*(Free|Pro|Max)\s*</i)
    return { ...BASE, status: 'ok', ...(pm ? { plan: pm[1] } : {}), bars }
  } catch { return { ...BASE, status: 'error', error: '取得に失敗しました', bars: [] } }
}
