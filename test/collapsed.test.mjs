import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ── 簡易な偽の React と、DSH 標準 Tooltip の代役 ──
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const tooltips = []
function Tooltip(props) { tooltips.push(props); return props.children }
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
  useState: initial => [initial, () => {}],
  useEffect() {}, useCallback: fn => fn, useRef: () => ({ current: null }),
}
const storageWrites = []
let stripState = null
function load({ withTooltip = true, collapsed = null, expanded = false, stripCollapsed = null, tab = null } = {}) {
  stripState = stripCollapsed
  let loaded
  const window = { __ModuleLoader__: { load: m => { loaded = m } } }
  const localStorage = {
    getItem: key => (key === 'dsh-usage-bars.strip-collapsed' ? stripState : collapsed),
    setItem: (key, value) => storageWrites.push([key, value]),
    removeItem: key => storageWrites.push([key, null]),
  }
  new Function('window', 'document', 'localStorage', 'setInterval', 'clearInterval', source)(window, { getElementById: () => true }, localStorage, () => 0, () => {})
  const useState = initial => { const value = typeof initial === 'function' ? initial() : initial; if (tab && value === 'services') return [tab, () => {}]; return [value === false ? expanded : value, () => {}] }
  const mod = loaded.factory(name => name === 'react' ? { ...fakeReact, useState } : withTooltip ? { Tooltip } : (() => { throw new Error('no primitives') })())
  return mod.__test
}
function render(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) { node.forEach(n => render(n, out)); return out }
  if (typeof node === 'string' || typeof node === 'number') { out.push({ text: String(node) }); return out }
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children }), out)
  out.push(node)
  node.children.forEach(child => render(child, out))
  return out
}
const textOf = nodes => nodes.map(n => n.text ?? '').filter(Boolean).join(' ')
const hasClass = (n, name) => String(n?.props?.className || '').split(' ').includes(name)
const labelText = label => textOf(render(label))

const HOUR = 3600e3
const iso = ms => new Date(Date.now() + ms).toISOString()
// 80% 使用で 5時間枠の残り 4 時間 = 1 時間で 80% 消費 → 約 15 分で尽きる
const paceBar = (over = {}) => ({ label: '5時間', usedPercent: 80, resetsAt: iso(4 * HOUR), ...over })
const calmBar = (over = {}) => ({ label: '週', usedPercent: 10, resetsAt: iso(6 * 24 * HOUR), ...over })
const cfgOf = (over = {}) => ({ enabled: {}, order: [], collapsedDefault: false, showReset: true, showText: true, showPlan: true, warnAt: 70, overAt: 90, refreshSeconds: 60, style: 'standard', theme: 'auto', pace: true, ...over })
const src = (id, label, bars, over = {}) => ({ id, label, status: 'ok', bars, ...over })

test('ペース警告: 文は出さず、モデル名の横に ⚠ を出す', () => {
  tooltips.length = 0
  const t = load()
  const s = src('codex', 'Codex', [paceBar(), calmBar()])
  const nodes = render(t.Source({ s, cfg: cfgOf(), open: true, onToggle() {} }))
  assert.ok(!/このペースだと/.test(textOf(nodes)), '行に長い警告文を出さない')
  assert.ok(!nodes.some(n => hasClass(n, 'ub-pace')), '旧 .ub-pace を使わない')
  const marks = nodes.filter(n => hasClass(n, 'ub-pace-mark'))
  assert.equal(marks.length, 1, '警告があるバーだけに ⚠')
  // ⚠ は、モデル名(ラベル)と同じ要素の中にある
  const label = nodes.find(n => hasClass(n, 'ub-label') && n.children.some(c => hasClass(c, 'ub-label-text') && labelText(c) === '5時間'))
  assert.ok(label, '⚠ のあるラベル')
  assert.ok(render(label).some(n => hasClass(n, 'ub-pace-mark')), 'ラベルの横に ⚠')
  const calm = nodes.find(n => hasClass(n, 'ub-label') && n.children.some(c => hasClass(c, 'ub-label-text') && labelText(c) === '週'))
  assert.ok(!render(calm).some(n => hasClass(n, 'ub-pace-mark')), '警告のないバーには出さない')
})

test('ペース警告: ホバー・フォーカス・タップでツールチップに文を出す', () => {
  tooltips.length = 0
  const t = load()
  render(t.Source({ s: src('codex', 'Codex', [paceBar()]), cfg: cfgOf(), open: true, onToggle() {} }))
  const tip = tooltips.find(p => typeof p.label === 'string')
  assert.match(tip.label, /^このペースだと約\d+分後に枠が尽きます$/)
  assert.equal(tip.openOnClick, true, 'タップで開く')
  assert.equal(tip.portal, true, 'スクロール領域に隠れない')
  assert.equal(tip.side, 'top')
  const mark = render(t.PaceMark({ pace: { minutes: 864 } })).find(n => hasClass(n, 'ub-pace-mark'))
  assert.equal(mark.props.tabIndex, 0, 'キーボードで focus できる')
  assert.equal(mark.props['aria-label'], 'このペースだと約14時間24分後に枠が尽きます')
})

test('ペース文: 分・時間の表記', () => {
  const t = load()
  assert.equal(t.paceText({ minutes: 15 }), 'このペースだと約15分後に枠が尽きます')
  assert.equal(t.paceText({ minutes: 864 }), 'このペースだと約14時間24分後に枠が尽きます')
  assert.equal(t.paceText({ minutes: 60 }), 'このペースだと約1時間0分後に枠が尽きます')
})

test('ペース警告: Tooltip が無い環境では title 属性で代用する', () => {
  const t = load({ withTooltip: false })
  const mark = render(t.PaceMark({ pace: { minutes: 15 } })).find(n => hasClass(n, 'ub-pace-mark'))
  assert.equal(mark.props.title, 'このペースだと約15分後に枠が尽きます')
})

test('折りたたみ: 「Co 12%」の名前ではなく、アイコン + 使用率を出す', () => {
  tooltips.length = 0
  const t = load({ collapsed: '1' })
  t.store.cfg = cfgOf(); t.store.data = { sources: [
    src('codex', 'Codex', [{ label: '5時間', usedPercent: 12 }]),
    src('claude', 'Claude', [{ label: '週', usedPercent: 90 }]),
    src('gemini', 'Gemini CLI', [{ label: 'Pro', usedPercent: 42 }]),
  ] }
  const nodes = render(t.UsageCard({}))
  const sum = nodes.find(n => hasClass(n, 'ub-sum'))
  assert.ok(sum, 'サマリーがある')
  const items = render(sum).filter(n => hasClass(n, 'ub-sum-item'))
  assert.equal(items.length, 3)
  const text = textOf(render(sum))
  assert.deepEqual(items.map(item => textOf(render(item)).trim()), ['12%', '90%', '42%'])
  assert.ok(!/\b(Co|Cl|Ge)\b/.test(text), '頭文字の名前を出さない')
  for (const item of items) assert.ok(render(item).some(n => n.type === 'svg' && hasClass(n, 'ub-icon')), '各項目にアイコン')
})

test('折りたたみ: ホバー(フォーカス)で詳細のツールチップを出す', () => {
  tooltips.length = 0
  const t = load()
  const s = src('claude', 'Claude', [paceBar(), calmBar({ usedPercent: 33 })], { plan: 'Max' })
  const item = render(t.SummaryItem({ s, cfg: cfgOf() })).find(n => hasClass(n, 'ub-sum-item'))
  assert.ok(hasClass(item, 'warn') || hasClass(item, 'over'), '使用率の色は従来どおり')
  assert.equal(item.props.tabIndex, 0)
  const tip = tooltips.at(-1)
  assert.equal(tip.openOnClick, false, 'タップはヘッダーの開閉に使う')
  const detail = labelText(tip.label)
  assert.match(detail, /Claude/)
  assert.match(detail, /Max/)
  assert.match(detail, /5時間\s*80%/)
  assert.match(detail, /週\s*33%/)
  assert.match(detail, /リセットまで/)
  assert.match(detail, /⚠ このペースだと約\d+分後に枠が尽きます/)
})

test('折りたたみの詳細: エラー・前回値・テキストも出し、モデル別の枠は登録済みだけ', () => {
  const t = load()
  const s = src('codex', 'Codex', [{ label: '5時間', usedPercent: 50 }], { status: 'error', error: '取得できません(401)', stale: true, text: '残 100' })
  const detail = labelText(t.SourceDetail({ s, cfg: cfgOf() }))
  assert.match(detail, /\(前回値\)/)
  assert.match(detail, /取得できません\(401\)/)
  assert.match(detail, /残 100/)
  const models = src('gemini', 'Gemini CLI', [{ label: 'gemini-2.5-pro', usedPercent: 20 }, { label: 'other-model', usedPercent: 60 }], { modelBars: true })
  const only = labelText(t.SourceDetail({ s: models, cfg: cfgOf({ registeredModels: ['Gemini 2.5 Pro'] }) }))
  assert.match(only, /gemini-2\.5-pro/)
  assert.ok(!/other-model/.test(only))
})

test('折りたたみの代用: Tooltip が無い環境では、詳細を title 属性に入れる', () => {
  const t = load({ withTooltip: false })
  const s = src('codex', 'Codex', [paceBar()], { plan: 'Plus' })
  const item = render(t.SummaryItem({ s, cfg: cfgOf() })).find(n => hasClass(n, 'ub-sum-item'))
  assert.match(item.props.title, /^Codex · Plus\n5時間 80% \/ リセットまで .* \/ ⚠ このペースだと約\d+分後に枠が尽きます$/)
})

test('折りたたみ: カードに collapsed が付き、半透明になる(ホバーで戻る)', () => {
  const data = { sources: [src('codex', 'Codex', [{ label: '5時間', usedPercent: 12 }])] }
  const closed = load({ collapsed: '1' }); closed.store.cfg = cfgOf(); closed.store.data = data
  const open = load({ collapsed: '0' }); open.store.cfg = cfgOf(); open.store.data = data
  const cardOf = t => render(t.UsageCard({})).find(n => hasClass(n, 'ub-card'))
  assert.ok(hasClass(cardOf(closed), 'collapsed'))
  assert.ok(!hasClass(cardOf(open), 'collapsed'))
  const css = closed.css
  assert.match(css, /\.ub-card\.collapsed\{opacity:\.62\}/)
  assert.match(css, /\.ub-card\.collapsed:hover,\.ub-card\.collapsed:focus-within\{opacity:1\}/)
})

test('スタイル: 見出しの下線をなくし、旧ペース表示のスタイルも残さない', () => {
  const css = load().css
  const head = css.split('\n').find(rule => rule.startsWith('.ub-head{'))
  assert.ok(head && !/border-bottom/.test(head), '見出し(使用量)の下線は不要')
  assert.ok(!css.includes('.ub-pace{') && !css.includes('.ub-pace '), '旧 .ub-pace')
})

test('アイコン: 主要なプロバイダは専用、それ以外は頭文字を丸で囲む', () => {
  const t = load()
  for (const id of ['claude', 'codex', 'gemini', 'antigravity', 'deepseek']) assert.ok(t.ICONS[id], id)
  const draw = s => render(t.ProviderIcon({ s }))
  assert.ok(!draw({ id: 'claude', label: 'Claude' }).some(n => n.type === 'text'), '専用アイコンに文字は不要')
  const mono = draw({ id: 'openrouter', label: 'OpenRouter' })
  assert.deepEqual(mono.filter(n => n.type === 'text').map(n => textOf(render(n))), ['OP'])
  assert.deepEqual(draw({ id: 'zai', label: 'Z.ai' }).filter(n => n.type === 'text').map(n => textOf(render(n))), ['ZA'])
  assert.deepEqual(draw({ id: 'x', label: '日本語' }).filter(n => n.type === 'text').map(n => textOf(render(n))), ['?'], '英数字が無いときは ?')
  const svg = draw({ id: 'claude', label: 'Claude' }).find(n => n.type === 'svg')
  assert.equal(svg.props['aria-hidden'], 'true', '名前は aria-label / ツールチップで伝える')
})

test('折りたたみ: アイコンが多くても見出しは縮まず、アイコンは折り返す', () => {
  const css = load().css
  assert.match(css, /\.ub-head>span:not\(\.ub-sum\)\{flex:none;white-space:nowrap\}/, '「使用量」が縦に潰れない')
  const sum = css.split('\n').find(rule => rule.startsWith('.ub-sum{'))
  assert.match(sum, /flex-wrap:wrap/)
  assert.match(sum, /min-width:0/)
})

// ───────── 入力欄の上の横バー / 角のチップ ─────────
const stripData = () => ({ sources: [
  src('codex', 'Codex', [{ label: '5時間', usedPercent: 12, resetsAt: iso(3 * HOUR) }, { label: '週', usedPercent: 10, resetsAt: iso(6 * 24 * HOUR) }], { plan: 'Plus' }),
  src('claude', 'Claude', [paceBar()]),
  src('openrouter', 'OpenRouter', [{ label: 'クレジット', usedPercent: 21 }]),
] })

test('横バー: 頭文字の名前をやめ、アイコン + 枠名 + 使用率だけを出す(プログレスバーなし)', () => {
  tooltips.length = 0
  const t = load(); t.store.cfg = cfgOf({ strip: true }); t.store.data = stripData()
  const nodes = render(t.QuotaStrip())
  const text = textOf(nodes)
  assert.ok(!/\b(Co|Cl|Op)\s/.test(text), '「Co 5時間」のような頭文字を出さない')
  const items = nodes.filter(n => hasClass(n, 'ub-strip-item'))
  assert.equal(items.length, 4, 'Codex 2枠 + Claude 1枠 + OpenRouter 1枠')
  for (const item of items) {
    const inner = render(item)
    assert.ok(inner.some(n => n.type === 'svg' && hasClass(n, 'ub-icon')), 'アイコン')
    assert.ok(!inner.some(n => hasClass(n, 'ub-track') || hasClass(n, 'ub-fill')), 'プログレスバーは出さない')
    assert.ok(inner.some(n => hasClass(n, 'ub-strip-pct')), '使用率')
    assert.match(textOf(inner).trim(), /\d+%$/, '末尾は使用率')
  }
  assert.match(textOf(render(items[0])), /5時間/)
  assert.match(textOf(render(items[0])), /12%/)
})

test('横バー: ペース警告は ⚠ にして、モデル名の横に出す(ツールチップで文)', () => {
  tooltips.length = 0
  const t = load(); t.store.cfg = cfgOf({ strip: true }); t.store.data = stripData()
  const nodes = render(t.QuotaStrip())
  assert.ok(!/このペースだと/.test(textOf(nodes)), '横バーに警告文を出さない')
  const marks = nodes.filter(n => hasClass(n, 'ub-pace-mark'))
  assert.equal(marks.length, 1, '警告のある枠だけ')
  const items = nodes.filter(n => hasClass(n, 'ub-strip-item'))
  const claude = items.find(item => /5時間/.test(textOf(render(item))) && render(item).some(n => hasClass(n, 'ub-pace-mark')))
  assert.ok(claude, '⚠ は Claude の 5時間 の項目の中')
  // ⚠ は、名前(アイコン+枠名)とバーの間にある
  const kinds = claude.children.map(c => hasClass(c, 'ub-pace-mark') || (typeof c.type === 'function' && c.type.name === 'PaceMark') ? 'mark' : 'other')
  assert.equal(kinds[1], 'mark')
  const paceTip = tooltips.find(p => typeof p.label === 'string' && /このペースだと/.test(p.label))
  assert.equal(paceTip.openOnClick, true)
})

test('横バー: 各項目にホバー/タップで詳細(名前・プラン・使用率・リセット)を出す', () => {
  tooltips.length = 0
  const t = load(); t.store.cfg = cfgOf({ strip: true }); t.store.data = stripData()
  render(t.QuotaStrip())
  const details = tooltips.filter(p => typeof p.label !== 'string').map(p => labelText(p.label))
  assert.ok(details.length >= 8, '名前側と使用率側の両方にツールチップ')
  const codex = details.find(d => /Codex/.test(d) && /5時間/.test(d))
  assert.match(codex, /Plus/)
  assert.match(codex, /12%/)
  assert.match(codex, /リセットまで/)
  assert.ok(!/週/.test(codex), 'その枠だけの詳細(同じサービスの別の枠は含めない)')
  assert.ok(tooltips.filter(p => typeof p.label !== 'string').every(p => p.openOnClick === true), 'タップで開く')
})

test('横バー: Tooltip が無い環境では title 属性で詳細を出す', () => {
  const t = load({ withTooltip: false }); t.store.cfg = cfgOf({ strip: true }); t.store.data = stripData()
  const nodes = render(t.QuotaStrip())
  const named = nodes.filter(n => hasClass(n, 'ub-strip-name'))
  assert.match(named[0].props.title, /^Codex · Plus\n5時間 12% \/ リセットまで/)
})

test('横バー: 長すぎるときは折り返さず横スクロールにする', () => {
  const css = load().css
  const strip = css.split('\n').find(rule => rule.startsWith('.ub-strip{'))
  assert.match(strip, /flex-wrap:nowrap/, '折り返さない')
  assert.match(strip, /overflow-x:auto/, '横スクロール')
  assert.match(strip, /overflow-y:hidden/)
  assert.match(strip, /overscroll-behavior-x:contain/, '端まで来ても外側をスクロールさせない')
  assert.match(css, /\.ub-strip-item\{[^}]*flex:none[^}]*white-space:nowrap/, '項目は縮めず、改行しない')
  assert.ok(!/\.ub-strip\{[^}]*flex-wrap:wrap/.test(css))
})

test('角のチップ: 全枠をアイコン + 数字 | 数字にまとめ、詳細を維持', () => {
  tooltips.length = 0
  const t = load({ expanded: true }); t.store.cfg = cfgOf({ chips: true }); t.store.data = stripData()
  const nodes = render(t.CornerChips())
  const chips = nodes.filter(n => hasClass(n, 'ub-chip'))
  assert.equal(chips.length, 3)
  assert.deepEqual(chips.map(c => textOf(render(c)).replace(/^OP\s*/, '').trim()), ['12 | 10', '80', '21'])
  assert.ok(!/5時間|週|%/.test(textOf(nodes)), 'コンパクト行には枠名と単位を出さない')
  assert.ok(!/\b(Co|Cl|Op)\b/.test(textOf(nodes)))
  for (const chip of chips) { assert.ok(render(chip).some(n => n.type === 'svg' && hasClass(n, 'ub-icon'))); assert.equal(chip.props.tabIndex, 0) }
  const details = tooltips.filter(p => typeof p.label !== 'string').map(p => labelText(p.label))
  assert.match(details[0], /Codex[\s\S]*Plus[\s\S]*5時間[\s\S]*12%[\s\S]*週[\s\S]*10%/)
  assert.match(details[1], /⚠ このペースだと/)
  assert.ok(tooltips.every(p => p.openOnClick === true))
})

test('入力欄ドック: 初期状態は1アイコンで、既存chips設定で非表示', () => {
  const t = load(); t.store.cfg = cfgOf({ chips: true }); t.store.data = stripData()
  const nodes = render(t.CornerChips())
  assert.equal(nodes.filter(n => hasClass(n, 'ub-chips-toggle')).length, 1)
  assert.equal(nodes.filter(n => n.type === 'svg').length, 1)
  assert.equal(nodes.filter(n => hasClass(n, 'ub-chip')).length, 0)
  assert.equal(nodes.find(n => hasClass(n, 'ub-chips-toggle')).props['aria-expanded'], false)
  t.store.cfg.chips = false
  assert.equal(t.CornerChips(), null)
  t.store.cfg.chips = true; t.store.data = { sources: [] }
  assert.equal(t.CornerChips(), null)
})

test('入力欄ドック: 登録モデルと並び順を守り、3枠目以降も省略しない', () => {
  const t = load({ expanded: true })
  t.store.cfg = cfgOf({ chips: true, order: ['claude', 'gemini'], registeredModels: ['Gemini Pro'], enabled: { codex: false } })
  t.store.data = { sources: [
    src('codex', 'Codex', [calmBar()]),
    src('gemini', 'Gemini', [{ label: 'Gemini Pro', usedPercent: 20 }, { label: 'Other', usedPercent: 90 }], { modelBars: true }),
    src('claude', 'Claude', [calmBar({ usedPercent: 0 }), calmBar({ usedPercent: 90 }), calmBar({ usedPercent: 100 })]),
  ] }
  const chips = render(t.CornerChips()).filter(n => hasClass(n, 'ub-chip'))
  assert.deepEqual(chips.map(c => textOf(render(c))), ['0 | 90 | 100', '20'])
  assert.match(chips[0].props['aria-label'], /^Claude/)
})

test('横バー: 縦のホイールを横スクロールに変え、端では変換しない', () => {
  const t = load()
  const node = (over = {}) => ({ scrollWidth: 800, clientWidth: 300, scrollLeft: 100, ...over })
  const event = (deltaY, deltaX = 0) => ({ deltaY, deltaX, prevented: false, preventDefault() { this.prevented = true } })
  let n = node(), e = event(40)
  assert.equal(t.wheelToScroll(e, n), true)
  assert.equal(n.scrollLeft, 140)
  assert.equal(e.prevented, true)
  n = node(); e = event(-30)
  assert.equal(t.wheelToScroll(e, n), true); assert.equal(n.scrollLeft, 70)
  // 収まっているとき・横方向の操作・端では、そのまま(ページの縦スクロールを妨げない)
  for (const [n2, e2, label] of [
    [node({ scrollWidth: 300 }), event(40), '収まっている'],
    [node(), event(5, 40), '横の操作が主'],
    [node({ scrollLeft: 0 }), event(-40), '左端で上へ'],
    [node({ scrollLeft: 500 }), event(40), '右端で下へ'],
  ]) { const before = n2.scrollLeft; assert.equal(t.wheelToScroll(e2, n2), false, label); assert.equal(n2.scrollLeft, before, label); assert.equal(e2.prevented, false, label) }
  assert.equal(t.wheelToScroll(event(10), null), false)
})

test('横バー: 使用率の文字色で状態を示す(バーの代わり)', () => {
  const t = load(); t.store.cfg = cfgOf({ strip: true, warnAt: 70, overAt: 90 })
  t.store.data = { sources: [src('a', 'A', [{ label: 'x', usedPercent: 10 }, { label: 'y', usedPercent: 75 }]), src('b', 'B', [{ label: 'z', usedPercent: 95 }])] }
  const pcts = render(t.QuotaStrip()).filter(n => hasClass(n, 'ub-strip-pct')).map(n => n.props.className)
  assert.deepEqual(pcts, ['ub-strip-meter ub-strip-pct', 'ub-strip-meter ub-strip-pct warn', 'ub-strip-meter ub-strip-pct over'])
  const css = t.css
  assert.match(css, /\.ub-strip-pct\.warn\{color:var\(--dsw-alias-state-warn-primary/)
  assert.match(css, /\.ub-strip-pct\.over\{color:var\(--dsw-alias-state-error-primary/)
  assert.ok(!css.includes('.ub-strip-item .ub-track'), '横バー用のバー幅指定は不要')
})

test('横バー: 新規セッションの中央寄せの列でも縮まず、上下が切れない', () => {
  const css = load().css
  assert.match(css, /\.ub-strip-wrap\{[^}]*flex:none/, '列の高さが足りなくても縮ませない')
})

test('横バー: スクロールバーは動かしている間だけ出し、止まれば消す', async () => {
  const t = load()
  const strip = t.css.split('\n').find(rule => rule.startsWith('.ub-strip{'))
  assert.match(strip, /scrollbar-color:transparent transparent/, '止まっているときは透明')
  assert.match(t.css, /\.ub-strip\.is-scrolling\{scrollbar-color:rgba/, '動かしている間だけ色を付ける')
  assert.match(t.css, /@media \(hover:hover\) and \(pointer:fine\)\{\.ub-strip:hover\{scrollbar-color:rgba/, 'マウスではホバー中も(タッチではタップ後に残さない)')
  assert.match(t.css, /\.ub-strip::-webkit-scrollbar-thumb\{background:transparent/)
  const listeners = {}
  const classes = new Set()
  const node = {
    scrollWidth: 800, clientWidth: 300, scrollLeft: 0,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: type => { delete listeners[type] },
  }
  const dispose = t.bindScroller(node)
  listeners.scroll()
  assert.ok(classes.has('is-scrolling'), 'スクロール中は表示')
  await new Promise(resolve => setTimeout(resolve, 760))
  assert.ok(!classes.has('is-scrolling'), '止まれば消える')
  assert.equal(typeof listeners.wheel, 'function', '縦ホイールを横に変える')
  dispose()
  assert.deepEqual(Object.keys(listeners), [])
  assert.equal(t.bindScroller(null), undefined)
})

test('横バー: 表示中も右端のアイコンで折りたためる', () => {
  const open = load(); open.store.cfg = cfgOf({ strip: true }); open.store.data = stripData()
  const nodes = render(open.QuotaStrip())
  const wrap = nodes.find(n => hasClass(n, 'ub-strip-wrap'))
  assert.ok(wrap && !hasClass(wrap, 'collapsed'))
  const toggle = wrap.children.at(-1)
  assert.ok(hasClass(toggle, 'ub-strip-toggle'), 'アイコンは右端(最後の子)')
  assert.equal(toggle.props['aria-expanded'], true)
  assert.equal(toggle.props['aria-label'], '使用量バー', 'a fixed name distinct from the sidebar and corner buttons; aria-expanded carries the state')
  assert.equal(toggle.props.title, '使用量バーの表示を切り替え')
  assert.ok(nodes.some(n => hasClass(n, 'ub-strip-item')))

  const closed = load({ stripCollapsed: '1' }); closed.store.cfg = cfgOf({ strip: true }); closed.store.data = stripData()
  const shut = render(closed.QuotaStrip())
  assert.ok(hasClass(shut.find(n => hasClass(n, 'ub-strip-wrap')), 'collapsed'))
  assert.equal(shut.filter(n => hasClass(n, 'ub-strip-item')).length, 0, '折りたたむと項目を隠す')
  const reopen = shut.find(n => hasClass(n, 'ub-strip-toggle'))
  assert.equal(reopen.props['aria-expanded'], false)
  assert.equal(reopen.props.title, '使用量バーの表示を切り替え')
  // Pressing it saves the new state for the next time (and for the other strips).
  storageWrites.length = 0
  reopen.props.onClick()
  assert.deepEqual(storageWrites, [['dsh-usage-bars.strip-collapsed', '0']])
  storageWrites.length = 0
  toggle.props.onClick()
  assert.deepEqual(storageWrites, [['dsh-usage-bars.strip-collapsed', '1']])
  assert.match(closed.css, /\.ub-strip-wrap\.collapsed\{justify-content:flex-end\}/, '畳んでもアイコンは右端')
})

test('横バー: 設定でオンに戻すと、畳んだ記憶を消して開いた状態で出す(保存できたときだけ)', async () => {
  const t = load({ stripCollapsed: '1', tab: 'notify' })
  t.store.cfg = cfgOf({ strip: false }); t.store.data = { sources: [] }
  let saveOk = true
  t.store.bind({ getConfig: async () => ({ ok: true, value: cfgOf() }), getUsage: async () => ({ ok: true, value: { sources: [] } }), updateConfig: async () => (saveOk ? { ok: true, value: cfgOf({ strip: true }) } : { ok: false, error: { message: 'no' } }) })
  t.store.cfg = cfgOf({ strip: false })
  const switchFor = () => render(t.UsageSettings()).find(n => n.props?.role === 'switch' && n.props['aria-label'] === '入力欄の上に横バーを表示')
  storageWrites.length = 0
  const sw = switchFor()
  assert.ok(sw, 'the strip switch on the notify tab')
  {
    saveOk = false
    sw.props.onClick(); await new Promise(r => setTimeout(r, 0))
    assert.deepEqual(storageWrites, [], 'a failed save leaves the remembered state alone')
    saveOk = true
    sw.props.onClick(); await new Promise(r => setTimeout(r, 0))
    assert.deepEqual(storageWrites, [['dsh-usage-bars.strip-collapsed', null]], 'switched back on: open again')
  }
  // A failed save of any switch leaves no unhandled rejection (the reason goes to the settings message).
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  saveOk = false
  for (const sw of render(t.UsageSettings()).filter(n => n.props?.role === 'switch')) sw.props.onClick()
  await new Promise(r => setTimeout(r, 20))
  process.off('unhandledRejection', onUnhandled)
  assert.deepEqual(unhandled, [])
  saveOk = true
  // Collapsed again by the reader while the save runs: the save does not reopen it.
  t.store.cfg = cfgOf({ strip: false })
  let release
  t.store.bind({ getConfig: async () => ({ ok: true, value: cfgOf() }), getUsage: async () => ({ ok: true, value: { sources: [] } }), updateConfig: () => new Promise(r => { release = () => r({ ok: true, value: cfgOf({ strip: true }) }) }) })
  t.store.cfg = cfgOf({ strip: false })
  stripState = null
  t.store.data = stripData()
  switchFor().props.onClick()
  t.store.cfg = cfgOf({ strip: true }) // a refresh during the save already shows the strip
  render(t.QuotaStrip()).find(n => hasClass(n, 'ub-strip-toggle')).props.onClick() // collapsed during the save
  storageWrites.length = 0
  release(); await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(storageWrites, [], 'kept collapsed')
  // Opened and collapsed again during a save (back to the same value): still the reader's choice.
  t.store.bind({ getConfig: async () => ({ ok: true, value: cfgOf() }), getUsage: async () => ({ ok: true, value: { sources: [] } }), updateConfig: () => new Promise(r => { release = () => r({ ok: true, value: cfgOf({ strip: true }) }) }) })
  t.store.cfg = cfgOf({ strip: false }); t.store.data = stripData()
  stripState = '1'
  switchFor().props.onClick()
  t.store.cfg = cfgOf({ strip: true })
  const strip = render(t.QuotaStrip()).find(n => hasClass(n, 'ub-strip-toggle'))
  strip.props.onClick() // open
  strip.props.onClick() // collapse again
  storageWrites.length = 0
  release(); await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(storageWrites, [], 'the save does not reopen it')
  t.store.bind({ getConfig: async () => ({ ok: true, value: cfgOf() }), getUsage: async () => ({ ok: true, value: { sources: [] } }), updateConfig: async () => ({ ok: true, value: cfgOf({ strip: true }) }) })
  t.store.cfg = cfgOf({ strip: true })
  // Switching it off leaves the remembered state alone.
  t.store.cfg = cfgOf({ strip: true })
  storageWrites.length = 0
  switchFor().props.onClick(); await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(storageWrites, [])
})

test('横バー: 開閉を保存できない環境では、このページの中の値で揃える(後から出た横バーも)', () => {
  let loaded
  const window = { __ModuleLoader__: { load: m => { loaded = m } }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }
  const localStorage = { getItem: () => '0', setItem() { throw new Error('QuotaExceededError') }, removeItem() { throw new Error('QuotaExceededError') } }
  new Function('window', 'document', 'localStorage', 'setInterval', 'clearInterval', 'CustomEvent', source)(window, { getElementById: () => true }, localStorage, () => 0, () => {}, function CustomEvent() {})
  const react = { ...fakeReact, useState: initial => { const value = typeof initial === 'function' ? initial() : initial; return [value, () => {}] } }
  const t = loaded.factory(name => name === 'react' ? react : { Tooltip }).__test
  t.store.cfg = cfgOf({ strip: true }); t.store.data = stripData()
  const toggle = render(t.QuotaStrip()).find(n => hasClass(n, 'ub-strip-toggle'))
  toggle.props.onClick() // collapse; the write fails
  const later = render(t.QuotaStrip()).find(n => hasClass(n, 'ub-strip-wrap'))
  assert.ok(hasClass(later, 'collapsed'), 'a strip drawn afterwards is collapsed too, though storage still says "0"')
})
