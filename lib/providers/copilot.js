import fs from 'node:fs'
import path from 'node:path'
import { getJson, findKey, offNoKey, fail, clamp, home } from '../util.js'

const NAMES = ['COPILOT_API_KEY', 'COPILOT_TOKEN', 'GITHUB_COPILOT_TOKEN']

// Copilot CLI/エディタプラグインが書く apps.json / hosts.json から oauth_token を探す
function fileToken() {
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'github-copilot')
  for (const f of ['apps.json', 'hosts.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      for (const [k, v] of Object.entries(j)) if (k.includes('github.com') && v?.oauth_token) return v.oauth_token
    } catch {}
  }
  return ''
}

const pct = q => {
  if (!q || q.unlimited) return null
  const r = Number(q.percentRemaining ?? q.percent_remaining)
  return Number.isFinite(r) ? clamp(100 - r) : null
}

export default async function fetchCopilot() {
  const base = { id: 'copilot', label: 'GitHub Copilot' }
  try {
    const token = (await findKey(NAMES)) || fileToken()
    if (!token) return offNoKey(base, NAMES)
    const r = await getJson('https://api.github.com/copilot_internal/user', {
      Authorization: 'token ' + token, Accept: 'application/json',
      'Editor-Version': 'vscode/1.96.2', 'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7', 'X-Github-Api-Version': '2025-04-01',
    })
    if (!r.ok || !r.data) return r.status === 401 ? { ...base, status: 'error', error: '認証エラー(トークン無効)', bars: [] } : fail(base, r)
    const d = r.data
    const qs = d.quotaSnapshots ?? d.quota_snapshots ?? {}
    const reset = d.quotaResetDate ?? d.quota_reset_date
    const resetsAt = reset && !isNaN(Date.parse(reset)) ? new Date(reset).toISOString() : undefined
    const bars = []
    const p = pct(qs.premiumInteractions ?? qs.premium_interactions)
    if (p !== null) bars.push({ label: 'プレミアム', usedPercent: p, ...(resetsAt && { resetsAt }) })
    const c = pct(qs.chat)
    if (c !== null) bars.push({ label: 'チャット', usedPercent: c, ...(resetsAt && { resetsAt }) })
    return { ...base, status: 'ok', plan: d.copilotPlan ?? d.copilot_plan, bars }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
