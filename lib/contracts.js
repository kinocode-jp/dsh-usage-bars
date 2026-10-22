// 依存ライブラリなしの厳格な Typert コーデック。DSH は schema.parse と create() の
// 両方を扱える。常に切り離した素の JSON を返し、プロバイダのオブジェクトは渡さない。
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
export function plainJson(value, maxBytes = 100_000) {
  let count = 0
  const visit = (v, depth = 0) => {
    if (++count > (maxBytes <= 100_000 ? 20_000 : Math.min(2_000_000, maxBytes / 4)) || depth > 12) throw new TypeError('JSON の構造が複雑すぎます')
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1))
    if (!isObject(v)) throw new TypeError('素の JSON ではありません')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new TypeError('安全でない JSON キーです')
      return [k, visit(x, depth + 1)]
    }))
  }
  const result = visit(value)
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) throw new TypeError('JSON が大きすぎます')
  return result
}
export const patchSchema = { parse(value) {
  if (!isObject(value)) throw new TypeError('設定の変更内容はオブジェクトで指定してください')
  return plainJson(value)
} }
export const daysSchema = { parse(value) {
  if (value === undefined) return 7
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 30) throw new TypeError('日数は 1〜30 の整数で指定してください')
  return value
} }
const recordSchema = { parse(value) { if (!isObject(value)) throw new TypeError('オブジェクトではありません'); return plainJson(value, 8_000_000) } }
export const configSchema = recordSchema
export const historySchema = { parse(value) {
  const result = recordSchema.parse(value)
  for (const points of Object.values(result)) if (!Array.isArray(points) || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new TypeError('履歴の形式が不正です')
  return result
} }
export const usageSchema = { parse(value) {
  const result = recordSchema.parse(value)
  if (!Number.isFinite(result.at) || !Array.isArray(result.sources)) throw new TypeError('使用量の形式が不正です')
  return result
} }
export const clearedSchema = { parse(value) { if (value !== true) throw new TypeError('true ではありません'); return true } }
export function safeSource(value, id) {
  if (!isObject(value)) throw new TypeError('プロバイダの応答が不正です')
  const result = { id, label: typeof value.label === 'string' ? value.label : id, status: ['ok', 'error', 'off'].includes(value.status) ? value.status : 'error', bars: [] }
  for (const key of ['error', 'plan', 'text']) if (typeof value[key] === 'string') result[key] = value[key].slice(0, 8192)
  if (typeof value.stale === 'boolean') result.stale = value.stale
  if (value.modelBars === true) result.modelBars = true
  if (Array.isArray(value.bars)) result.bars = value.bars.slice(0, 100).filter(bar => isObject(bar) && Number.isFinite(bar.usedPercent)).map(bar => {
    const next = { label: typeof bar.label === 'string' ? bar.label.slice(0, 1024) : '' }
    if (Number.isFinite(bar.usedPercent)) next.usedPercent = Math.max(0, Math.min(100, bar.usedPercent))
    for (const key of ['resetsAt', 'text']) if (typeof bar[key] === 'string') next[key] = bar[key].slice(0, 8192)
    return next
  })
  return result
}

export const providerNameSchema = { parse(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\r\n]/.test(value)) throw new TypeError('プロバイダIDが不正です')
  return value
} }
export const routeKindSchema = { parse(value) {
  if (value !== 'subscription' && value !== 'api') throw new TypeError('枠は subscription か api を指定してください')
  return value
} }
export const enabledSchema = { parse(value) {
  if (typeof value !== 'boolean') throw new TypeError('有効/無効は真偽値で指定してください')
  return value
} }
