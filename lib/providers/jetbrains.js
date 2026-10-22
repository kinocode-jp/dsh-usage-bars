import fs from 'node:fs'
import path from 'node:path'
import { clamp, home } from '../util.js'

const base = { id: 'jetbrains', label: 'JetBrains AI' }
const roots = process.platform === 'darwin'
  ? [path.join(home, 'Library/Application Support/JetBrains'), path.join(home, 'Library/Application Support/Google')]
  : [path.join(home, '.config/JetBrains'), path.join(home, '.config/Google')]

const decode = s => s.replace(/&#10;/g, '\n').replace(/&#13;/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const attr = (xml, name) => { const m = xml.match(new RegExp(name + '="([^"]*)"')); if (!m) return null; try { return JSON.parse(decode(m[1])) } catch { return null } }

function findFiles() {
  const out = []
  const custom = process.env.JETBRAINS_IDE_BASE_PATH
  const dirs = custom ? [custom] : roots.flatMap(r => { try { return fs.readdirSync(r).map(d => path.join(r, d)) } catch { return [] } })
  for (const d of dirs) {
    const f = path.join(d, 'options', 'AIAssistantQuotaManager2.xml')
    try { out.push({ f, ide: path.basename(d), t: fs.statSync(f).mtimeMs }) } catch {}
  }
  return out.sort((a, b) => b.t - a.t)
}

export default async function fetchJetBrains() {
  try {
    const best = findFiles()[0]
    if (!best) return { ...base, status: 'off', error: 'JetBrains AI のクォータファイルがありません', bars: [] }
    const xml = fs.readFileSync(best.f, 'utf8')
    const q = attr(xml, 'quotaInfo'), n = attr(xml, 'nextRefill')
    const max = Number(q?.maximum)
    if (!q || !(max > 0)) return { ...base, status: 'error', error: 'クォータを解析できません', bars: [] }
    const avail = Number(q.tariffQuota?.available)
    const used = Number.isFinite(avail) ? max - avail : Number(q.current)
    const ts = Date.parse(n?.next)
    return { ...base, status: 'ok', plan: best.ide,
      bars: [{ label: '現在', usedPercent: clamp((used / max) * 100), ...(ts ? { resetsAt: new Date(ts).toISOString() } : {}) }] }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
