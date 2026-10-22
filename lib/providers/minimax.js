import { getJson, findKey, offNoKey, fail, clamp, iso } from '../util.js'

const ts = v => { v = Number(v); return v > 0 ? (v < 1e12 ? v * 1000 : v) : 0 }

export default async function fetchMinimax() {
  const base = { id: 'minimax', label: 'MiniMax', bars: [] }
  try {
    const names = ['MINIMAX_API_KEY']
    const key = await findKey(names)
    if (!key) return offNoKey(base, names)
    const override = process.env.MINIMAX_REMAINS_URL || ''
    let url = 'https://api.minimax.io/v1/coding_plan/remains'
    if (override) {
      let u = null; try { u = new URL(override) } catch {}
      if (!u || u.protocol !== 'https:' || !['api.minimax.io', 'api.minimaxi.com'].includes(u.hostname)) return { ...base, status: 'error', error: 'MINIMAX_REMAINS_URL は api.minimax.io / api.minimaxi.com の https のみ許可します' }
      url = u.toString()
    }
    const r = await getJson(url, { authorization: 'Bearer ' + key, accept: 'application/json' })
    if (r.status === 401 || r.status === 403) return { ...base, status: 'error', error: 'APIキーが無効です' }
    if (!r.ok || !r.data) return fail(base, r)
    const code = r.data.base_resp?.status_code
    if (code) return { ...base, status: 'error', error: '認証エラー (' + code + ')' }
    const list = r.data.model_remains ?? r.data.data?.model_remains ?? []
    if (!Array.isArray(list) || !list.length) return { ...base, status: 'error', error: '使用量データを解析できません' }
    const bars = []
    // current_*_usage_count は残り回数
    const mk = (label, total, remain, reset) => {
      total = Number(total); remain = Number(remain)
      if (!(total > 0) || !Number.isFinite(remain)) return
      bars.push({ label, usedPercent: clamp(((total - remain) / total) * 100), ...(reset ? { resetsAt: reset } : {}) })
    }
    const main = list.find(x => /^MiniMax-M/i.test(x.model_name ?? '')) ?? list[0]
    const remainsMs = Number(main.remains_time)
    const reset = iso(ts(main.end_time) || (remainsMs > 0 ? Date.now() + remainsMs : 0))
    mk('5時間', main.current_interval_total_count, main.current_interval_usage_count, reset)
    mk('週', main.current_weekly_total_count, main.current_weekly_usage_count, iso(ts(main.weekly_end_time)))
    if (!bars.length) return { ...base, status: 'error', error: '使用量データを解析できません' }
    return { ...base, status: 'ok', plan: main.model_name, bars }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました' }
  }
}
