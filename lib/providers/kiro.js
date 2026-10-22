import os from 'node:os'
import { execFile } from 'node:child_process'
import { clamp, iso, home } from '../util.js'
import fs from 'node:fs'

const base = { id: 'kiro', label: 'Kiro' }
const bins = ['kiro-cli', home + '/.local/bin/kiro-cli', '/usr/local/bin/kiro-cli', '/opt/homebrew/bin/kiro-cli', '/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli']

function run(bin) {
  return new Promise(resolve => {
    execFile(bin, ['chat', '--no-interactive', '/usage'], { timeout: 20000, maxBuffer: 1 << 20, cwd: os.tmpdir(), env: Object.fromEntries([...['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR'].map(k => [k, process.env[k]]), ...Object.entries(process.env).filter(([k]) => k.startsWith('KIRO_') || k.startsWith('AWS_')), ['NO_COLOR', '1'], ['TERM', 'dumb']].filter(([, v]) => v !== undefined)) },
      (err, stdout, stderr) => resolve({ err, out: String(stdout || '') + '\n' + String(stderr || '') })).stdin?.end()
  })
}
const strip = s => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

function resetDate(mm, dd) {
  const now = new Date()
  let t = new Date(now.getFullYear(), mm - 1, dd)
  if (t.getTime() < now.getTime() - 864e5) t = new Date(now.getFullYear() + 1, mm - 1, dd)
  return iso(t.getTime())
}

export default async function fetchKiro() {
  try {
    let res = null
    for (const b of bins) {
      if (b.includes('/') && !fs.existsSync(b)) continue
      res = await run(b)
      if (!(res.err && res.err.code === 'ENOENT')) break
      res = null
    }
    if (!res) return { ...base, status: 'off', error: 'kiro-cli が見つかりません', bars: [] }
    const text = strip(res.out)
    if (/not logged in|please log ?in|login required/i.test(text)) return { ...base, status: 'off', error: 'kiro-cli にログインしていません', bars: [] }
    const bars = []
    const plan = (text.match(/\|\s*(KIRO[^\s|┃]*(?:\s+[A-Z+]+)?)/i) || [])[1]?.trim()
    const m = text.match(/(\d+(?:\.\d+)?)%\s*(?:\(resets on (\d{1,2})\/(\d{1,2})\))?/)
    if (m) bars.push({ label: '月', usedPercent: clamp(m[1]), ...(m[2] ? { resetsAt: resetDate(+m[2], +m[3]) } : {}) })
    const b = text.match(/Bonus credits:?[\s\S]*?(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*credits used(?:,\s*expires in (\d+) days)?/i)
    if (b && +b[2] > 0) bars.push({ label: 'ボーナス', usedPercent: clamp((+b[1] / +b[2]) * 100), ...(b[3] ? { resetsAt: iso(Date.now() + b[3] * 864e5) } : {}) })
    if (!bars.length) return { ...base, status: 'error', error: '使用量を解析できません', bars: [] }
    return { ...base, status: 'ok', plan, bars }
  } catch {
    return { ...base, status: 'error', error: '取得に失敗しました', bars: [] }
  }
}
