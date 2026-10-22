import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getJson, clamp, iso, home } from '../util.js'

const base = { id: 'vertexai', label: 'Vertex AI' }
const gdir = process.env.CLOUDSDK_CONFIG || path.join(home, '.config', 'gcloud')
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

function projectId(adc) {
  for (const k of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT']) if (process.env[k]) return process.env[k]
  try {
    const name = fs.readFileSync(path.join(gdir, 'active_config'), 'utf8').trim() || 'default'
    const m = fs.readFileSync(path.join(gdir, 'configurations', 'config_' + name), 'utf8').match(/^project\s*=\s*(\S+)/m)
    if (m) return m[1]
  } catch {}
  return adc.quota_project_id || adc.project_id || ''
}
async function token(adc) {
  const form = o => ({ method: 'POST', body: new URLSearchParams(o).toString() })
  const hdr = { 'content-type': 'application/x-www-form-urlencoded' }
  const url = 'https://oauth2.googleapis.com/token'
  let r
  if (adc.type === 'service_account') {
    const b = o => Buffer.from(JSON.stringify(o)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const head = b({ alg: 'RS256', typ: 'JWT' }) + '.' + b({ iss: adc.client_email, scope: 'https://www.googleapis.com/auth/monitoring.read', aud: url, iat: now, exp: now + 3600 })
    const sig = crypto.sign('RSA-SHA256', Buffer.from(head), adc.private_key).toString('base64url')
    r = await getJson(url, hdr, form({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + sig }))
  } else {
    r = await getJson(url, hdr, form({ client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token, grant_type: 'refresh_token' }))
  }
  return r.data?.access_token || ''
}
async function series(project, tok, metric, start, end) {
  const filter = `metric.type="serviceruntime.googleapis.com/quota/${metric}" AND resource.type="consumer_quota" AND resource.label.service="aiplatform.googleapis.com"`
  const q = new URLSearchParams({ filter, 'interval.startTime': start, 'interval.endTime': end, 'aggregation.alignmentPeriod': '3600s', 'aggregation.perSeriesAligner': 'ALIGN_MAX', pageSize: '500' })
  const r = await getJson(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries?${q}`, { authorization: 'Bearer ' + tok })
  if (!r.ok) throw Object.assign(new Error('http'), { status: r.status })
  const out = new Map()
  for (const s of r.data?.timeSeries ?? []) {
    const k = [s.metric?.labels?.quota_metric, s.metric?.labels?.limit_name, s.resource?.labels?.location].join('|')
    const pts = s.points ?? []
    const v = Math.max(0, ...pts.map(p => Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0)))
    out.set(k, Math.max(out.get(k) ?? 0, v))
  }
  return out
}

export default async function fetchVertexAI() {
  try {
    const adc = readJson(process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(gdir, 'application_default_credentials.json'))
    if (!adc) return { ...base, status: 'off', error: 'gcloud ADC が未設定です', bars: [] }
    const project = projectId(adc)
    if (!project) return { ...base, status: 'error', error: 'プロジェクトIDが未設定です', bars: [] }
    const tok = await token(adc)
    if (!tok) return { ...base, status: 'error', error: '認証に失敗しました', bars: [] }
    const end = new Date(), start = new Date(end.getTime() - 6 * 3600e3)
    const [usage, limit] = await Promise.all([
      series(project, tok, 'allocation/usage', start.toISOString(), end.toISOString()),
      series(project, tok, 'limit', start.toISOString(), end.toISOString())])
    let best = null
    for (const [k, u] of usage) {
      const l = limit.get(k)
      if (l > 0 && (best === null || u / l > best)) best = u / l
    }
    if (best === null) return { ...base, status: 'ok', plan: project, bars: [], text: 'クォータ情報なし' }
    return { ...base, status: 'ok', plan: project, bars: [{ label: 'クォータ', usedPercent: clamp(best * 100) }] }
  } catch (e) {
    return { ...base, status: 'error', error: e?.status ? 'HTTP ' + e.status : '取得に失敗しました', bars: [] }
  }
}
