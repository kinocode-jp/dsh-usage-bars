// Kilo: KILO_API_KEY / ~/.local/share/kilo/auth.json (kilo.access, `kilo login`)
import fs from 'node:fs'
import path from 'node:path'
import { getJson, findKey, offNoKey, clamp, home } from '../util.js'

const base = { id: 'kilo', label: 'Kilo' }
const PROCS = ['user.getCreditBlocks', 'kiloPass.getState']
const TIERS = { tier_19: 'Starter', tier_49: 'Pro', tier_199: 'Expert' }

function cliToken() {
  try { return String(JSON.parse(fs.readFileSync(path.join(home, '.local/share/kilo/auth.json'), 'utf8')).kilo?.access || '').trim() } catch { return '' }
}
function payload(entry) {
  const d = entry?.result?.data
  return d && typeof d === 'object' && 'json' in d ? d.json : d
}
async function call(token) {
  const input = Object.fromEntries(PROCS.map((_, i) => [String(i), { json: null }]))
  const url = 'https://app.kilo.ai/api/trpc/' + PROCS.join(',') + '?batch=1&input=' + encodeURIComponent(JSON.stringify(input))
  return getJson(url, { authorization: 'Bearer ' + token, accept: 'application/json' })
}

export default async function fetchKilo() {
  try {
    const apiKey = await findKey(['KILO_API_KEY'])
    const cli = cliToken()
    if (!apiKey && !cli) return offNoKey(base, ['KILO_API_KEY'])
    let r = apiKey ? await call(apiKey) : null
    if ((!r || r.status === 401 || r.status === 403) && cli && cli !== apiKey) r = await call(cli)
    if (r.status === 401 || r.status === 403) return { ...base, status: 'error', error: '認証に失敗しました', bars: [] }
    if (!r.ok) return { ...base, status: 'error', error: 'HTTP ' + r.status, bars: [] }
    const entries = Array.isArray(r.data) ? r.data : [r.data?.['0'], r.data?.['1']]
    const bars = []
    let plan, text
    const blocks = payload(entries[0])?.creditBlocks
    if (Array.isArray(blocks)) {
      const sum = k => blocks.reduce((s, b) => s + (Number(b?.[k]) || 0), 0) / 1e6
      const total = sum('amount_mUsd'), rem = sum('balance_mUsd')
      if (total > 0) { bars.push({ label: 'クレジット', usedPercent: clamp((total - rem) / total * 100) }); text = `残 $${rem.toFixed(2)} / $${total.toFixed(2)}` }
    }
    const p = payload(entries[1])
    const sub = p?.subscription && typeof p.subscription === 'object' ? p.subscription : (p?.currentPeriodBaseCreditsUsd != null ? p : null)
    if (sub) {
      plan = TIERS[sub.tier] || sub.tier || 'Kilo Pass'
      const total = (Number(sub.currentPeriodBaseCreditsUsd) || 0) + (Number(sub.currentPeriodBonusCreditsUsd) || 0)
      const used = Number(sub.currentPeriodUsageUsd) || 0
      const t = Date.parse(sub.nextBillingAt || sub.nextRenewalAt || sub.renewsAt || sub.renewAt)
      if (total > 0) bars.push({ label: '月', usedPercent: clamp(used / total * 100), ...(Number.isFinite(t) && { resetsAt: new Date(t).toISOString() }) })
    }
    if (!bars.length) return { ...base, status: 'error', error: '使用量を取得できません', bars: [] }
    return { ...base, status: 'ok', ...(plan && { plan }), bars, ...(text && { text }) }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
