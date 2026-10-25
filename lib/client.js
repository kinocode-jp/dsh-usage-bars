// ブラウザ側: サイドバー下部に使用量バーのカードを出す。クリックで1行に畳める。
window.__ModuleLoader__.load({
  id: '@kinocode/dsh-usage-bars',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { createElement: el, useState, useEffect, useCallback } = React
    const useRef = React.useRef || (() => ({ current: null }))
    const COLLAPSE_KEY = 'dsh-usage-bars.collapsed'
    // DSH 標準のツールチップ(ホバー/フォーカス/タップ)。取得できない環境では title 属性で代用する。
    let primitives = null
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') } catch { primitives = null }

    const css = [
      '.ub-card{--ub-surface:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#fbfbf8) 86%, #e9e4d8 14%);--ub-panel:var(--dsw-alias-bg-layer-1,#fffefb);--ub-text:var(--dsw-alias-label-primary,inherit);--ub-muted:var(--dsw-alias-label-secondary,rgba(127,127,127,.65));--ub-border:var(--dsw-alias-border-l1,rgba(127,127,127,.16));--ub-border-strong:var(--dsw-alias-border-l2,rgba(127,127,127,.22));--ub-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));--ub-track:rgba(127,127,127,.18);display:flex;flex-direction:column;gap:0;flex:1 0 100%;min-width:0;width:100%;box-sizing:border-box;padding:10px 12px 8px;border:1px solid var(--ub-border-strong);border-radius:12px;background:var(--ub-surface);color:var(--ub-text);box-shadow:0 2px 8px rgba(30,30,30,.05),0 1px 2px rgba(30,30,30,.04);font-size:11px;line-height:1.35}',
      '.ub-theme-light{--ub-surface:#f6f6f3;--ub-panel:#fff;--ub-text:#1f2328;--ub-muted:#6b7280;--ub-border:rgba(31,35,40,.12);--ub-border-strong:rgba(31,35,40,.2);--ub-hover:rgba(31,35,40,.05);--ub-track:rgba(31,35,40,.12)}',
      '.ub-theme-dark{--ub-surface:#1b1d21;--ub-panel:#25282d;--ub-text:#f2f3f5;--ub-muted:#a8adb5;--ub-border:rgba(255,255,255,.14);--ub-border-strong:rgba(255,255,255,.22);--ub-hover:rgba(255,255,255,.08);--ub-track:rgba(255,255,255,.16)}',
      '.ub-theme-warm{--ub-surface:#f6efe4;--ub-panel:#fffaf2;--ub-text:#3b332a;--ub-muted:#7b6d5c;--ub-border:rgba(90,70,45,.16);--ub-border-strong:rgba(90,70,45,.26);--ub-hover:rgba(90,70,45,.07);--ub-track:rgba(90,70,45,.14)}',
      '.ub-body{display:flex;flex-direction:column;gap:0;max-height:280px;overflow-y:auto;overscroll-behavior:contain;padding:2px 4px 0 0;scrollbar-width:thin}',
      '.ub-body::-webkit-scrollbar{width:6px}',
      '.ub-body::-webkit-scrollbar-thumb{background:rgba(127,127,127,.28);border-radius:999px}',
      '[class*="footerActions"]:has(.ub-card){flex-wrap:wrap;row-gap:6px}',
      '.ub-src-head{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;padding:5px 4px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;text-align:left;transition:background .15s ease}',
      '.ub-src-head:hover{background:var(--ub-hover)}',
      '.ub-src-head .ub-pct{opacity:.8}',
      '.ub-caret{width:14px;height:14px;flex:none;opacity:.55;display:inline-flex;align-items:center;justify-content:center}',
      '.ub-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--ub-muted);box-shadow:0 0 0 2px rgba(127,127,127,.08)}',
      '.ub-dot.warn{background:var(--dsw-alias-state-warn-primary,#d29922)}',
      '.ub-dot.over{background:var(--dsw-alias-state-error-primary,#f85149)}',
      '.ub-head{display:flex;align-items:center;gap:6px;width:100%;padding:0 0 8px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:600;letter-spacing:.02em;cursor:pointer;text-align:left}',
      '.ub-head .ub-caret{opacity:.55}',
      '.ub-card{transition:opacity .15s ease}',
      '.ub-card.collapsed{opacity:.62}',
      '.ub-card.collapsed:hover,.ub-card.collapsed:focus-within{opacity:1}',
      '.ub-card.collapsed .ub-head{padding-bottom:0}',
      '.ub-head>span:not(.ub-sum){flex:none;white-space:nowrap}',
      '.ub-sum{margin-left:auto;min-width:0;display:inline-flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:2px 8px;padding:2px 8px;border-radius:10px;background:var(--ub-hover);font-weight:400;font-size:10px;font-variant-numeric:tabular-nums}',
      '.ub-sum-item{display:inline-flex;align-items:center;gap:3px;cursor:default;border-radius:4px}',
      '.ub-sum-item.warn{color:var(--dsw-alias-state-warn-primary,#d29922)}.ub-sum-item.over{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.ub-icon{flex:none;display:inline-block;vertical-align:middle}',
      '.ub-label{display:flex;align-items:center;gap:4px;min-width:0}',
      '.ub-label-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ub-pace-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;color:var(--dsw-alias-state-warn-primary,#d29922);cursor:help}',
      '.ub-pace-mark:hover,.ub-pace-mark:focus-visible{background:var(--ub-hover);outline:none}',
      '.ub-tip{display:flex;flex-direction:column;gap:3px;min-width:140px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
      '.ub-tip-title{display:flex;align-items:center;gap:6px;font-weight:600}',
      '.ub-tip-title .ub-plan{font-weight:400;opacity:.7}',
      '.ub-tip-row{display:flex;gap:10px;justify-content:space-between}',
      '.ub-tip-row .ub-tip-pct{font-weight:600}',
      '.ub-tip-sub{opacity:.75;font-size:11px}',
      '.ub-tip-pace{color:var(--dsw-alias-state-warn-label,#d29922);font-size:11px}',
      '.ub-tip-err{color:var(--dsw-alias-state-error-primary,#f85149);font-size:11px}',
      '.ub-src{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:6px 2px 8px;border:0;border-top:1px solid var(--ub-border);border-radius:0;background:transparent}',
      '.ub-src:first-child{border-top:0}',
      '.ub-name{display:flex;gap:6px;font-weight:600;min-width:0;flex:1 1 auto;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.ub-plan{font-weight:400;opacity:.55}',
      '.ub-row{display:grid;grid-template-columns:minmax(48px,64px) 1fr 38px;align-items:center;gap:8px;padding:1px 4px 1px 22px}',
      '.ub-row span:first-child{opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ub-track{height:7px;border-radius:999px;background:var(--ub-track);box-shadow:inset 0 0 0 1px rgba(127,127,127,.08);overflow:hidden}',
      '.ub-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#3fb950);transition:width .2s ease}',
      '.ub-fill.warn{background:var(--dsw-alias-state-warn-primary,#d29922)}',
      '.ub-fill.over{background:var(--dsw-alias-state-error-primary,#f85149)}',
      '.ub-pct{text-align:right;font-variant-numeric:tabular-nums}',
      '.ub-reset{grid-column:2/4;opacity:.5;font-size:10px;margin-top:-2px}',
      '.ub-err{padding:0 4px 0 22px;opacity:.65;font-size:10px}',
      '.ub-card.compact .ub-body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:start;padding-right:2px}',
      '.ub-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:start;box-sizing:border-box}',
      '.ub-col{display:flex;flex-direction:column;gap:8px;min-width:0;box-sizing:border-box}',
      '.ub-card.compact .ub-src{display:flex;width:100%;min-width:0;margin:0;padding:6px 7px 7px;gap:2px;border:1px solid var(--ub-border);border-radius:8px;background:var(--ub-panel)}',
      '.ub-card.compact .ub-src:first-child{border-top:1px solid var(--ub-border)}',
      
      '.ub-card.compact .ub-src-head{padding:0 0 4px;border-bottom:1px solid var(--ub-border);border-radius:0;font-size:10px}',
      '.ub-card.compact .ub-src-head:hover{background:transparent;opacity:.9}',
      '.ub-card.compact .ub-plan{display:none}',
      '.ub-card.compact .ub-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"label pct" "track track";gap:2px 6px;padding:3px 0 0}',
      '.ub-card.compact .ub-row>span:first-child{grid-area:label;font-size:10px}',
      '.ub-card.compact .ub-row>.ub-track{grid-area:track;height:5px}',
      '.ub-card.compact .ub-row>.ub-pct{grid-area:pct;font-size:10px}',
      '.ub-card.compact .ub-reset{grid-column:1/-1;margin-top:0;font-size:9px}',
      '.ub-card.compact .ub-err{padding:2px 0 0;font-size:9px}',
      '.ub-simple{display:flex;gap:6px;align-items:center;padding:3px 4px}',
      '.ub-simple .ub-pct{margin-left:auto;width:auto}',
      '.ub-rail{display:flex;flex-direction:column;align-items:center;gap:4px}',
      '.ub-rail-bar{width:6px;height:36px;border-radius:3px;background:rgba(127,127,127,.22);display:flex;align-items:flex-end;overflow:hidden}',
      '.ub-rail-bar>div{width:100%;background:var(--dsw-alias-state-success-primary,#3fb950)}',
      '.ub-rail-bar>div.warn{background:var(--dsw-alias-state-warn-primary,#d29922)}.ub-rail-bar>div.over{background:var(--dsw-alias-state-error-primary,#f85149)}',
      // 入力欄の上の横バー。新規セッション(中央寄せ)の列では高さが詰められるため、flex:none で縮ませない。
      '.ub-strip-wrap{display:flex;flex:none;align-items:center;gap:6px;box-sizing:border-box;width:min(calc(100% - 32px),var(--dsh-chat-content-width,920px));min-width:0;margin:0 auto;font-size:11px}',
      '.ub-strip-wrap.collapsed{justify-content:flex-end}',
      '.ub-strip{display:flex;flex:1 1 auto;flex-wrap:nowrap;gap:4px 14px;align-items:center;box-sizing:border-box;min-width:0;padding:2px 0 4px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:thin;scrollbar-color:transparent transparent}',
      // スクロールバーは動かしている間だけ出し、止まれば消す(.is-scrolling は scroll イベントで付け外し)。
      '.ub-strip::-webkit-scrollbar{height:5px}',
      '.ub-strip::-webkit-scrollbar-thumb{background:transparent;border-radius:999px}',
      // マウスではホバー中も出す(右に続きがあることがわかるように)。タッチ端末はタップで :hover が残るので対象外。
      '.ub-strip.is-scrolling{scrollbar-color:rgba(127,127,127,.4) transparent}.ub-strip.is-scrolling::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4)}',
      '@media (hover:hover) and (pointer:fine){.ub-strip:hover{scrollbar-color:rgba(127,127,127,.4) transparent}.ub-strip:hover::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4)}}',
      '.ub-strip-toggle{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;padding:0;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.75;cursor:pointer;touch-action:manipulation}',
      // タッチ端末ではタップ後に :hover が残るので、ホバーの見た目はマウスのある端末だけ。
      '.ub-strip-toggle:focus-visible{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}',
      '@media (hover:hover) and (pointer:fine){.ub-strip-toggle:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}}',
      '.ub-strip-toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4c8df6));outline-offset:-2px}',
      '.ub-strip-item{display:flex;flex:none;align-items:center;gap:5px;white-space:nowrap}',
      '.ub-strip-name{display:inline-flex;align-items:center;gap:4px;border-radius:4px;cursor:default}',
      '.ub-strip-meter{display:inline-flex;align-items:center;gap:5px;cursor:default;font-variant-numeric:tabular-nums}',
      '.ub-strip-pct.warn{color:var(--dsw-alias-state-warn-primary,#d29922)}.ub-strip-pct.over{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.ub-strip-name:focus-visible,.ub-strip-meter:focus-visible,.ub-chip:focus-visible,.ub-sum-item:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4c8df6));outline-offset:1px}',
      '.ub-chips{display:flex;order:1000;flex:0 0 40px;align-items:center;justify-content:flex-end;gap:4px;min-width:40px;width:40px;max-width:100%;margin-left:auto;box-sizing:border-box}',
      '.ub-chips.expanded{flex:0 1 auto;min-width:84px;width:max-content}',
      '[data-composer-dock]:has(.ub-chips){min-width:0;width:100%;max-width:var(--dsh-composer-card-max-width,100%);box-sizing:border-box}',
      '@media(max-width:600px){[data-composer-dock]:has(.ub-chips){column-gap:6px!important}[data-composer-dock]:has(.ub-chips.expanded) [data-composer-stat] button>span{display:none!important}[data-composer-dock]:has(.ub-chips.expanded) [data-composer-stat]{flex:0 0 40px!important}}',
      '.ub-chips-scroll{flex:0 1 auto;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:thin;scrollbar-color:transparent transparent}',
      '.ub-chips-scroll::-webkit-scrollbar{height:3px}.ub-chips-scroll::-webkit-scrollbar-thumb{background:transparent;border-radius:999px}',
      '.ub-chips-scroll.is-scrolling{scrollbar-color:rgba(127,127,127,.4) transparent}.ub-chips-scroll.is-scrolling::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4)}',
      '@media (hover:hover) and (pointer:fine){.ub-chips-scroll:hover{scrollbar-color:rgba(127,127,127,.4) transparent}.ub-chips-scroll:hover::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4)}}',
      '.ub-chips-row{display:flex;align-items:center;flex-wrap:nowrap;gap:4px;width:max-content;min-width:100%;justify-content:flex-end;box-sizing:border-box}',
      '.ub-chips-toggle{display:inline-flex;flex:none;align-items:center;justify-content:center;width:40px;min-width:40px;height:40px;min-height:40px;padding:10px;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;touch-action:manipulation}',
      '@media (hover:hover) and (pointer:fine){.ub-chips-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}}',
      // キーボードで横スクロール欄に来たときも、続きがあることがわかるようにスクロールバーを出す。
      '.ub-chips-scroll:focus-visible{scrollbar-color:rgba(127,127,127,.4) transparent}.ub-chips-scroll:focus-visible::-webkit-scrollbar-thumb{background:rgba(127,127,127,.4)}',
      '.ub-chips-toggle:focus-visible,.ub-chips-scroll:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4c8df6));outline-offset:-2px}',
      '.ub-chip{display:inline-flex;flex:none;align-items:center;gap:4px;padding:1px 6px;border-radius:999px;border:1px solid rgba(127,127,127,.3);font-size:11px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums;cursor:default}',
      '.ub-chip-value.warn{color:var(--dsw-alias-state-warn-primary,#d29922)}.ub-chip-value.over{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.ub-chip.warn{color:var(--dsw-alias-state-warn-primary,#d29922)}.ub-chip.over{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.ub-spark{display:block}',
      // Settings sizing follows DSH's General section: 14px/22px body and titles, 12px/18px
      // helper text, 16px row inset, 0.5px separators, 36px/12px-radius controls and
      // 28px/8px-radius compact buttons.
      '.ub-set{display:flex;flex-direction:column;gap:24px;max-width:800px;font-size:14px;line-height:22px}',
      '.ub-tabs{display:flex;gap:8px;padding:0;border:0;background:none;overflow-x:auto;scrollbar-width:thin}',
      '.ub-tab{box-sizing:border-box;flex:none;height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;white-space:nowrap}',
      '.ub-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
      '.ub-tab.active{background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-primary,inherit);font-weight:500}',
      '.ub-panel{display:flex;flex-direction:column;gap:24px}',
      '.ub-panel>div{padding:0;border:0;background:none}',
      '.ub-svc-list{gap:12px}.ub-svc-list h3{padding:0}',
      '.ub-set h3{margin:0;padding:0 0 8px;border-bottom:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary,inherit)}',
      '.ub-tablewrap{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}',
      '.ub-set table{width:100%;min-width:100%;border-collapse:collapse}',
      '@media(max-width:600px){.ub-set table{min-width:520px}}',
      '.ub-set td{padding:12px 8px;font-size:14px;line-height:22px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));vertical-align:middle}',
      '.ub-set input[type=text],.ub-set input[type=password]{box-sizing:border-box;height:32px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;line-height:22px}',
      '.ub-set input[type=text],.ub-set input[type=password]{width:100%}',
      '.ub-set input[type=number],.ub-set select{box-sizing:border-box;height:36px;border:0;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:14px;line-height:22px}'+
      '.ub-set input[type=number]{width:88px;padding:0 12px}',
      '.ub-set select{flex:0 0 auto;min-width:120px;max-width:55%;padding:0 14px;cursor:pointer}',
      '.ub-set .ub-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:12px;line-height:18px;font-weight:400;cursor:pointer;white-space:nowrap}'+
      '.ub-set .ub-btn-lg{height:36px;padding:0 14px;border-radius:var(--dsw-radius-md,12px);font-size:14px;line-height:22px}',
      '.ub-set .ub-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,#eef0f1)}',
      '.ub-set .ub-btn:disabled{cursor:not-allowed;opacity:.4}',
      '.ub-tab:focus-visible,.ub-set .ub-btn:focus-visible,.ub-set input:focus-visible,.ub-set select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4c8df6));outline-offset:2px}',
      '.ub-set label{display:flex;align-items:center;gap:8px;font-size:14px}',
      '.ub-field{display:flex;justify-content:space-between;align-items:center;gap:24px;min-height:36px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));font-size:14px;line-height:22px}',
      '.ub-field:last-child{border-bottom:none}',
      '.ub-field>span:first-child{color:var(--dsw-alias-label-primary,inherit)}',
      '.ub-field>*:last-child{flex:0 0 auto}',
      '.ub-srow{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14))}',
      '.ub-srow:last-child{border-bottom:none}',
      '.ub-srow-text{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.ub-srow-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit)}',
      '.ub-srow-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.ub-list{display:flex;flex-direction:column}',
      '.ub-service{gap:12px}',
      '.ub-srow-ctl{display:flex;align-items:center;gap:4px;flex:0 0 auto}',
      '.ub-btn-icon{width:28px;padding:0}',
      '.ub-keys{display:flex;flex-direction:column;gap:10px;margin-top:10px;min-width:0}',
      '.ub-key{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.ub-key-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.ub-key-name{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}',
      '.ub-key-state{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,inherit)}',
      '.ub-key-row{display:flex;align-items:center;gap:8px;min-width:0}',
      '.ub-key-row input{flex:1 1 auto;width:auto;min-width:0}',
      '.ub-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;margin-top:1px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3,rgba(127,127,127,.3));cursor:pointer}',
      '.ub-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary,#4c8df6))}',
      '.ub-switch:disabled{cursor:default;opacity:.5}',
      '.ub-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4c8df6));outline-offset:2px}',
      '.ub-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform 120ms ease}',
      '.ub-switch[aria-checked="true"] .ub-switch-thumb{transform:translateX(16px)}',
      '.ub-set .ub-err{padding:0;font-size:12px;line-height:18px;opacity:1;color:var(--dsw-alias-label-secondary,inherit)}',
      '.ub-st-ok{color:var(--dsw-alias-state-success-primary,#3fb950)}.ub-st-error{color:var(--dsw-alias-state-error-primary,#f85149)}.ub-st-off{opacity:.55}',
    ].join('\n')
    if (!document.getElementById('ub-style')) { const s = document.createElement('style'); s.id = 'ub-style'; s.textContent = css; document.head.appendChild(s) }

    function resetText(iso) {
      const t = Date.parse(iso); if (!Number.isFinite(t)) return ''
      const m = Math.round((t - Date.now()) / 60000); if (m <= 0) return 'まもなくリセット'
      return 'リセットまで ' + (m >= 1440 ? Math.floor(m / 1440) + '日' + Math.floor((m % 1440) / 60) + '時間' : m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : m + '分')
    }


    const DEFAULT_CFG = { enabled: {}, order: [], collapsedDefault: false, showReset: true, showText: true, showPlan: true, warnAt: 70, overAt: 90, refreshSeconds: 60,
      style: 'standard', theme: 'auto', strip: false, chips: false, notify: false, pace: true, history: true }
    const levelOf = (p, cfg) => (p >= cfg.overAt ? ' over' : p >= cfg.warnAt ? ' warn' : '')
    // DSH の認証済み接続からホストサービスを呼ぶ。独自ポート・接続トークンは不要。
    const objectSchema = { parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid usage-bars object')
      return value
    } }
    const daysSchema = { parse(value) {
      if (value === undefined) return value
      if (!Number.isInteger(value) || value < 1 || value > 30) throw new Error('Invalid history days')
      return value
    } }
    const clearSchema = { parse(value) { if (value !== true) throw new Error('Invalid clear result'); return value } }
    const providerSchema = { parse(value) { if (typeof value !== 'string' || !value || value.length > 128) throw new Error('Invalid provider'); return value } }
    const kindSchema = { parse(value) { if (value !== 'subscription' && value !== 'api') throw new Error('Invalid route kind'); return value } }
    const enabledSchema = { parse(value) { if (typeof value !== 'boolean') throw new Error('Invalid enabled'); return value } }
    const codec = (name, schema) => ({ mode: 'strict', typeSymbol: '@kinocode/dsh-usage-bars#' + name, schema, create: () => schema })
    const CONTRIBUTION = { package: '@kinocode/dsh-usage-bars', face: 'host', descriptors: [...[
      ['getConfig', 'Config'], ['updateConfig', 'Config', 'patch', 'Patch', objectSchema],
      ['getUsage', 'Usage'], ['getHistory', 'History', 'days', 'Days', daysSchema], ['clearHistory', 'Cleared'],
    ].map(([method, result, parameter, type, schema]) => ({
      id: '@kinocode/dsh-usage-bars#usageBars/' + method,
      service: 'usageBars', namespace: 'usageBars', method, invocation: { kind: 'direct' },
      parameters: parameter ? [{ name: parameter, wire: parameter, source: 'json', ...(parameter === 'days' ? { acceptsUndefined: true } : {}), codec: codec(type, schema) }] : [],
      result: codec(result, result === 'Cleared' ? clearSchema : objectSchema),
    })), {
      id: '@kinocode/dsh-usage-bars#usageBars/setRoute', service: 'usageBars', namespace: 'usageBars', method: 'setRoute', invocation: { kind: 'direct' },
      parameters: [
        { name: 'provider', wire: 'provider', source: 'json', codec: codec('Provider', providerSchema) },
        { name: 'kind', wire: 'kind', source: 'json', codec: codec('RouteKind', kindSchema) },
        { name: 'enabled', wire: 'enabled', source: 'json', codec: codec('Enabled', enabledSchema) },
      ],
      result: codec('Config', objectSchema),
    }] }
    let remoteService = null
    const call = async (method, ...args) => {
      if (typeof remoteService?.[method] !== 'function') throw new Error('DSHの使用量サービスに接続できません')
      const result = await remoteService[method](...args)
      if (!result || result.ok !== true) throw new Error(result?.error?.message || '使用量の取得に失敗しました')
      return result.value
    }
    const loadConfig = () => call('getConfig')
    const saveConfig = async patch => {
      const epoch = store.epoch, mutation = ++store.mutation
      store.revision++
      store.saving++
      try {
        const cfg = await call('updateConfig', patch)
        if (epoch === store.epoch && mutation === store.mutation) store.setConfig(cfg)
        return cfg
      } finally {
        if (epoch === store.epoch) {
          store.saving--
          // A read begun during a write cannot establish the final configuration.
          store.revision++
          if (!store.saving) store.schedule(true)
        }
      }
    }

    // ── 共有ストア: 設定と使用量を1か所でポーリングし、全コンポーネントに配る ──
    const WINDOW_MS = label => (/5\s*時間|5h/i.test(label) ? 5 * 3600e3 : /週|week|7d/i.test(label) ? 7 * 86400e3 : /月|month/i.test(label) ? 30 * 86400e3 : /日|day/i.test(label) ? 86400e3 : 0)
    function paceOf(bar, cfg) {
      if (!cfg.pace || !bar.resetsAt) return null
      const win = WINDOW_MS(bar.label), reset = Date.parse(bar.resetsAt)
      if (!win || !Number.isFinite(reset)) return null
      const left = reset - Date.now(), elapsed = win - left
      if (left <= 0 || elapsed < win * 0.05 || bar.usedPercent < 5) return null
      const rate = bar.usedPercent / elapsed // %/ms
      const exhaustAt = Date.now() + (100 - bar.usedPercent) / rate
      return exhaustAt < reset - 60000 ? { exhaustAt, minutes: Math.round((exhaustAt - Date.now()) / 60000) } : null
    }
    const store = {
      cfg: null, data: null, subs: new Set(), timer: null, last: {}, error: '', revision: 0, epoch: 0, mutation: 0, saving: 0, pending: null, pendingRevision: -1,
      emit() { this.subs.forEach(f => f()) },
      setConfig(c) { this.revision++; this.cfg = c; this.schedule(true); this.emit() },
      failed(e) {
        this.error = e.message
        this.emit()
      },
      bind(service) {
        this.revision++; this.epoch++; this.saving = 0; this.pending = null; remoteService = service
        this.cfg = null; this.data = null; this.last = {}; this.error = ''
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        if (service) this.schedule()
        this.emit()
      },
      refresh() {
        if (!remoteService || this.saving) return Promise.resolve()
        if (this.pending && this.pendingRevision === this.revision) return this.pending
        const revision = this.revision
        const current = () => revision === this.revision
        const pending = Promise.resolve().then(async () => {
          if (!current()) return
          try {
            // Every ordinary refresh observes other tabs and model-route changes.
            const cfg = await loadConfig()
            if (!current()) return
            this.cfg = cfg; this.armTimer(); this.emit()
            const data = await call('getUsage')
            if (!current()) return
            this.data = data; this.error = ''; this.notify(); this.emit()
          } catch (e) { if (current()) this.failed(e) }
        }).finally(() => {
          // A previous connection must not clear a replacement request's lock.
          if (this.pending === pending) this.pending = null
        })
        this.pendingRevision = revision
        this.pending = pending
        return pending
      },
      armTimer() {
        const seconds = Math.max(15, (this.cfg || DEFAULT_CFG).refreshSeconds)
        if (!this.subs.size || (this.timer && this.timerSeconds === seconds)) return
        if (this.timer) clearInterval(this.timer)
        this.timerSeconds = seconds
        this.timer = setInterval(() => this.refresh(), seconds * 1000)
      },
      schedule(force) {
        if (force && this.timer) { clearInterval(this.timer); this.timer = null }
        if (this.timer || !this.subs.size) return
        this.refresh()
        this.armTimer()
      },
      subscribe(f) { this.subs.add(f); this.schedule(); return () => { this.subs.delete(f); if (!this.subs.size && this.timer) { clearInterval(this.timer); this.timer = null } } },
      notify() {
        const cfg = { ...DEFAULT_CFG, ...(this.cfg || {}) }
        const canNotify = cfg.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted'
        for (const s of this.data?.sources || []) {
          if (s.status !== 'ok' || s.stale || cfg.enabled[s.id] === false) continue
          for (const b of s.bars || []) {
            if (!Number.isFinite(b.usedPercent)) continue
            const key = s.id + '|' + b.label
            const prev = this.last[key]
            const snapshot = { used: b.usedPercent, reset: Date.parse(b.resetsAt), warn: cfg.warnAt, over: cfg.overAt }
            this.last[key] = snapshot
            if (!canNotify || !prev || prev.warn !== cfg.warnAt || prev.over !== cfg.overAt) continue
            const reset = Number.isFinite(prev.reset) && Number.isFinite(snapshot.reset) && snapshot.reset > prev.reset && snapshot.used < prev.used
            const lv = snapshot.used >= cfg.overAt ? 2 : snapshot.used >= cfg.warnAt ? 1 : 0
            const old = prev.used >= cfg.overAt ? 2 : prev.used >= cfg.warnAt ? 1 : 0
            try {
              if (reset) new Notification(s.label + ' ' + b.label + ' がリセットされました', { tag: key })
              else if (lv > old) new Notification(s.label + ' ' + b.label + ': ' + Math.round(b.usedPercent) + '% 使用', { body: lv === 2 ? '上限に近づいています' : '使用率がしきい値を超えました', tag: key })
            } catch { /* OS側で通知が使えない場合でも描画は続ける */ }
          }
        }
      },
    }
    function useStore() {
      const [, force] = useState(0)
      useEffect(() => store.subscribe(() => force(n => n + 1)), [])
      return { cfg: { ...DEFAULT_CFG, ...(store.cfg || {}) }, ready: !!store.cfg, data: store.data }
    }
    function orderSources(list, cfg) {
      const idx = id => { const i = (cfg.order || []).indexOf(id); return i < 0 ? 999 : i }
      return list.filter(s => cfg.enabled[s.id] !== false).sort((a, b) => idx(a.id) - idx(b.id))
    }
    const visible = (data, cfg) => (data ? orderSources(data.sources.filter(s => s && s.status !== 'off'), cfg) : [])
    const maxPct = (s, cfg) => { const bars = barsOf(s, cfg); return bars.length ? Math.max(...bars.map(b => b.usedPercent)) : null }

    const normalizeModel = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    const modelRegistered = (label, registered) => {
      if (!Array.isArray(registered) || !registered.length) return true
      const target = normalizeModel(label)
      if (!target) return true
      return registered.some(name => {
        const item = normalizeModel(name)
        return item ? target.includes(item) || item.includes(target) : false
      })
    }

    // ── ツールチップ(DSH 標準の Tooltip。ホバー/フォーカス/タップ) ──
    // label はツールチップに出す内容、text は代用(title 属性)に使う文字列。
    function Tip({ label, text, tap, children }) {
      const Tooltip = primitives?.Tooltip
      if (!Tooltip) return React.cloneElement ? React.cloneElement(children, { title: text }) : children
      return el(Tooltip, { label, side: 'top', delayMs: 120, focusDelayMs: 0, gap: 6, portal: true, openOnClick: !!tap, maxWidth: 320 }, children)
    }
    const paceText = pace => 'このペースだと約' + (pace.minutes >= 60 ? Math.floor(pace.minutes / 60) + '時間' + (pace.minutes % 60) + '分' : pace.minutes + '分') + '後に枠が尽きます'

    // ── プロバイダのアイコン(16x16、currentColor。主要なものは専用、他は頭文字) ──
    const ICONS = {
      // 放射状のスパーク
      claude: { color: '#d97757', draw: () => el('path', { d: 'M8 1.6v12.8M1.6 8h12.8M3.5 3.5l9 9M12.5 3.5l-9 9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }) },
      // ターミナルのプロンプト
      codex: { draw: () => [el('rect', { key: 'r', x: 1.5, y: 2.5, width: 13, height: 11, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }), el('path', { key: 'p', d: 'M5 6.2l2.4 1.8L5 9.8M8.8 10h2.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })] },
      // 4点星
      gemini: { color: '#4c8df6', draw: () => el('path', { d: 'M8 1.2c.5 3.7 3.1 6.3 6.8 6.8-3.7.5-6.3 3.1-6.8 6.8-.5-3.7-3.1-6.3-6.8-6.8C4.9 7.5 7.5 4.9 8 1.2z', fill: 'currentColor' }) },
      // 上向きの山形
      antigravity: { color: '#7c6cf0', draw: () => el('path', { d: 'M8 2.2l5.8 11.3h-3.4L8 8.7l-2.4 4.8H2.2z', fill: 'currentColor' }) },
      // クジラ
      deepseek: { color: '#4d6bfe', draw: () => [el('path', { key: 'w', d: 'M1.6 9.4C1.6 6.7 3.8 4.8 6.9 4.8c1.7 0 2.9.5 3.8 1.3.9-.4 1.9-.3 2.6.3-.4.4-.9.6-1.5.6.1 1.3-.3 2.5-1.3 3.4-.9.9-2.1 1.4-3.8 1.4H5.3c-.7.9-1.7 1.3-3 1.3.5-.6.6-1.2.5-1.8-.8-.6-1.2-1.3-1.2-2.1z', fill: 'currentColor' }), el('circle', { key: 'e', cx: 5.6, cy: 8.2, r: .8, fill: 'var(--ub-surface,#fff)' })] },
    }
    // 専用アイコンが無いプロバイダは、頭文字(英数字)を丸で囲む。
    const monogram = label => (String(label || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?').toUpperCase()
    function ProviderIcon({ s, size = 14 }) {
      const icon = ICONS[s.id]
      return el('svg', { className: 'ub-icon', width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: icon?.color ? { color: icon.color } : undefined },
        icon ? icon.draw()
          : [el('circle', { key: 'c', cx: 8, cy: 8, r: 6.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
             el('text', { key: 't', x: 8, y: 10.6, textAnchor: 'middle', fontSize: monogram(s.label).length > 1 ? 6.4 : 8, fontWeight: 600, fill: 'currentColor', fontFamily: 'inherit' }, monogram(s.label))])
    }
    function WarnIcon() {
      return el('svg', { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        el('path', { d: 'M8 1.8l6.6 11.6H1.4z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        el('path', { d: 'M8 6.4v3.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        el('circle', { cx: 8, cy: 11.4, r: .9, fill: 'currentColor' }))
    }
    // 表示対象のバー(モデル別の枠は、登録済みのモデルだけ)。
    const barsOf = (s, cfg) => (s.bars || []).filter(b => !s.modelBars || modelRegistered(b.label, cfg.registeredModels))
    // ペース警告: モデル名の横に ⚠。ホバー・フォーカス・タップで文言をツールチップに出す。
    function PaceMark({ pace }) {
      const text = paceText(pace)
      return el(Tip, { label: text, text, tap: true },
        el('span', { className: 'ub-pace-mark', tabIndex: 0, role: 'img', 'aria-label': text, 'data-pace': pace.minutes }, el(WarnIcon)))
    }
    // 折りたたみ時のツールチップ: 名前・プラン・各枠の使用率とリセット・ペース警告・エラー。
    function SourceDetail({ s, cfg }) {
      const bars = barsOf(s, cfg)
      return el('div', { className: 'ub-tip' },
        el('div', { className: 'ub-tip-title' }, el(ProviderIcon, { s, size: 14 }), el('span', null, s.label),
          cfg.showPlan && s.plan ? el('span', { className: 'ub-plan' }, s.plan) : null, s.stale ? el('span', { className: 'ub-plan' }, '(前回値)') : null),
        ...bars.map((b, i) => {
          const pace = paceOf(b, cfg)
          return el('div', { key: i, style: { display: 'contents' } },
            el('div', { className: 'ub-tip-row' }, el('span', null, b.label), el('span', { className: 'ub-tip-pct' }, Math.round(b.usedPercent) + '%')),
            cfg.showReset && b.resetsAt ? el('div', { className: 'ub-tip-sub' }, resetText(b.resetsAt)) : null,
            pace ? el('div', { className: 'ub-tip-pace' }, '\u26a0 ' + paceText(pace)) : null)
        }),
        cfg.showText && s.text ? el('div', { className: 'ub-tip-sub' }, s.text) : null,
        s.status !== 'ok' ? el('div', { className: 'ub-tip-err' }, s.error || '取得できません') : null)
    }
    // 文字列版(title 属性の代用)
    function sourceDetailText(s, cfg) {
      const lines = [s.label + (cfg.showPlan && s.plan ? ' · ' + s.plan : '') + (s.stale ? ' (前回値)' : '')]
      for (const b of barsOf(s, cfg)) {
        const pace = paceOf(b, cfg)
        lines.push(b.label + ' ' + Math.round(b.usedPercent) + '%' + (cfg.showReset && b.resetsAt ? ' / ' + resetText(b.resetsAt) : '') + (pace ? ' / \u26a0 ' + paceText(pace) : ''))
      }
      if (s.status !== 'ok') lines.push(s.error || '取得できません')
      return lines.join('\n')
    }
    // 折りたたみ時の1項目: アイコン + 使用率。ホバー/フォーカスで詳細。
    function SummaryItem({ s, cfg }) {
      const p = maxPct(s, cfg)
      if (p === null) return null
      const text = sourceDetailText(s, cfg)
      return el(Tip, { label: el(SourceDetail, { s, cfg }), text },
        el('span', { className: 'ub-sum-item' + levelOf(p, cfg), tabIndex: 0, 'aria-label': text.replace(/\n/g, ', ') },
          el(ProviderIcon, { s, size: 14 }), Math.round(p) + '%'))
    }

    function Caret({ open }) {
      return el('svg', { className: 'ub-caret', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        el('path', {
          d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function Source({ s, cfg, open, onToggle }) {
      const bars = barsOf(s, cfg)
      if (s.modelBars && !bars.length) return null
      const p = bars.length ? Math.max(...bars.map(b => b.usedPercent)) : null
      const header = el('button', { type: 'button', className: 'ub-src-head', onClick: onToggle, 'aria-expanded': !!open },
        el(Caret, { open }),
        el('span', { className: 'ub-dot' + (p === null ? '' : levelOf(p, cfg)) }),
        el('span', { className: 'ub-name' }, s.label, cfg.showPlan && s.plan ? el('span', { className: 'ub-plan' }, s.plan) : null, s.stale ? el('span', { className: 'ub-plan' }, '(前回値)') : null),
        p === null ? null : el('span', { className: 'ub-pct', style: { marginLeft: 'auto' } }, Math.round(p) + '%'))
      if (!open) return el('div', { className: 'ub-src' }, header)
      if (cfg.style === 'simple') {
        return el('div', { className: 'ub-src' }, header,
          !bars.length && s.text ? el('div', { className: 'ub-err' }, s.text) : null,
          s.status !== 'ok' ? el('div', { className: 'ub-err' }, s.error || '取得できません') : null)
      }
      const rows = bars.map((b, i) => {
        const pace = paceOf(b, cfg)
        return el('div', { key: i, style: { display: 'contents' } },
          el('div', { className: 'ub-row' },
            el('span', { className: 'ub-label' }, el('span', { className: 'ub-label-text', title: b.label }, b.label), pace ? el(PaceMark, { pace }) : null),
            el('div', { className: 'ub-track' }, el('div', { className: 'ub-fill' + levelOf(b.usedPercent, cfg), style: { width: b.usedPercent + '%' } })),
            el('span', { className: 'ub-pct' }, Math.round(b.usedPercent) + '%'),
            cfg.showReset && b.resetsAt ? el('span', { className: 'ub-reset' }, resetText(b.resetsAt)) : null,
            null))
      })
      return el('div', { className: 'ub-src' }, header,
        cfg.showText && s.text ? el('div', null, s.text) : null,
        ...rows,
        s.status !== 'ok' ? el('div', { className: 'ub-err' }, s.error || '取得できません') : null)
    }

    // サイドバー(広い): 標準 / 2列(compact) / 簡易(simple)。狭い(rail)時は縦バー。
    function UsageCard(props) {
      const { cfg, ready, data } = useStore()
      const [collapsed, setCollapsed] = useState(null)
      const [openMap, setOpenMap] = useState({})
      const shown = visible(data, cfg).filter(s => !s.modelBars || barsOf(s, cfg).length)
      if (!ready || !data || !shown.length) return null
      if (props && props.wide === false) {
        return el('div', { className: 'ub-rail', title: shown.map(s => s.label + ' ' + (maxPct(s, cfg) === null ? '' : Math.round(maxPct(s, cfg)) + '%')).join('\n') },
          shown.filter(s => maxPct(s, cfg) !== null).map(s => el('div', { key: s.id, className: 'ub-rail-bar', title: s.label + ' ' + Math.round(maxPct(s, cfg)) + '%' },
            el('div', { className: levelOf(maxPct(s, cfg), cfg).trim(), style: { height: maxPct(s, cfg) + '%' } }))))
      }
      const isCollapsed = collapsed === null ? (() => { try { const v = localStorage.getItem(COLLAPSE_KEY); return v === null ? cfg.collapsedDefault : v === '1' } catch { return cfg.collapsedDefault } })() : collapsed
      const toggle = () => { const next = !isCollapsed; setCollapsed(next); try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch {} }
      const summaryItems = shown.filter(s => maxPct(s, cfg) !== null)
      const renderSource = s => el(Source, {
        key: s.id, s, cfg,
        open: openMap[s.id] !== false,
        onToggle: () => setOpenMap(map => ({ ...map, [s.id]: !(map[s.id] !== false) })),
      })
      const compact = cfg.style === 'compact'
      const body = (() => {
        if (compact) {
          // 左右を独立した列にして、片方の高さがもう片方を引きずらないようにする。
          const columns = [[], []]
          const heights = [0, 0]
          for (const s of shown) {
            const target = heights[0] <= heights[1] ? 0 : 1
            columns[target].push(s)
            heights[target] += 1 + (s.bars?.length || 1) + (s.bars?.length ? 1 : 0)
          }
          return el('div', { className: 'ub-body ub-cols' },
            el('div', { className: 'ub-col' }, columns[0].map(renderSource)),
            el('div', { className: 'ub-col' }, columns[1].map(renderSource)))
        }
        return el('div', { className: 'ub-body' }, shown.map(renderSource))
      })()
      return el('div', { className: 'ub-card' + (compact ? ' compact' : '') + (isCollapsed ? ' collapsed' : '') + ' ub-theme-' + (cfg.theme || 'auto') },
        el('button', { type: 'button', className: 'ub-head', onClick: toggle, 'aria-expanded': !isCollapsed },
          el(Caret, { open: !isCollapsed }), el('span', null, '使用量'), isCollapsed ? el('span', { className: 'ub-sum' }, summaryItems.map(s => el(SummaryItem, { key: s.id, s, cfg }))) : null),
        isCollapsed ? null : body)
    }

    // 入力欄の上の横バー: アイコン + 枠名 + 使用率(プログレスバーは出さない)。⚠ はモデル名の横。詳細はツールチップ。
    // 長くて収まらないときは折り返さず、横スクロールにする。右端のアイコンで折りたためる。
    function StripItem({ s, b, cfg }) {
      const pace = paceOf(b, cfg)
      const one = { ...s, bars: [b], modelBars: false } // この枠だけの詳細
      const text = sourceDetailText(one, cfg)
      const aria = text.replace(/\n/g, ', ')
      const detail = el(SourceDetail, { s: one, cfg })
      return el('div', { className: 'ub-strip-item' },
        el(Tip, { label: detail, text, tap: true }, el('span', { className: 'ub-strip-name', tabIndex: 0, 'aria-label': aria }, el(ProviderIcon, { s, size: 13 }), el('span', null, b.label))),
        pace ? el(PaceMark, { pace }) : null,
        el(Tip, { label: detail, text, tap: true }, el('span', { className: 'ub-strip-meter ub-strip-pct' + levelOf(b.usedPercent, cfg), tabIndex: 0, 'aria-label': aria },
          Math.round(b.usedPercent) + '%')))
    }
    // 縦のホイールを横スクロールに変える(マウスのホイールでも横にスクロールできるように)。
    // 端まで来たら変換しない: ページ本来の縦スクロールを妨げない。
    function wheelToScroll(event, node) {
      if (!node || node.scrollWidth <= node.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return false
      const atStart = node.scrollLeft <= 0, atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1
      if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return false
      node.scrollLeft += event.deltaY
      event.preventDefault()
      return true
    }
    // 横スクロール領域の共通処理: 動かしている間だけ .is-scrolling を付け(止まって 700ms で外す)、
    // 縦ホイールを横スクロールに変える。passive: false で登録する(React の onWheel は preventDefault できない)。
    function bindScroller(node) {
      if (!node || typeof node.addEventListener !== 'function') return undefined
      let timer = null
      const onScroll = () => {
        node.classList.add('is-scrolling')
        clearTimeout(timer)
        timer = setTimeout(() => { node.classList.remove('is-scrolling'); timer = null }, 700)
      }
      const onWheel = event => wheelToScroll(event, node)
      node.addEventListener('scroll', onScroll, { passive: true })
      node.addEventListener('wheel', onWheel, { passive: false })
      return () => {
        clearTimeout(timer)
        node.classList.remove('is-scrolling')
        node.removeEventListener('scroll', onScroll)
        node.removeEventListener('wheel', onWheel)
      }
    }
    function BarsIcon({ size = 16 } = {}) {
      return el('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': 'true' },
        el('path', { d: 'M3 15V10M8 15V5M13 15V8M18 15V3', strokeLinecap: 'round' }))
    }
    const STRIP_COLLAPSE_KEY = 'dsh-usage-bars.strip-collapsed'
    const STRIP_DOCK_ORDER = -1000
    // localStorage が使えない(読めない、または書き込みに失敗した)環境では、このページの中だけの値で揃える
    // (後から出た横バーも同じ状態にする)。
    let stripCollapsedMemory = false
    let stripStorageBroken = false
    const readStripCollapsed = () => {
      if (stripStorageBroken) return stripCollapsedMemory
      try { return localStorage.getItem(STRIP_COLLAPSE_KEY) === '1' } catch { return stripCollapsedMemory }
    }
    // 開閉は画面に出ているすべての横バー(分割表示・別タブ)で揃える。同じタブは独自のイベント、別タブは storage イベント。
    const STRIP_EVENT = 'dsh-usage-bars:strip-collapsed'
    // 開閉を書いた回数。保存中に利用者が開閉したかを、値ではなく回数で見分ける。
    let stripWrites = 0
    const writeStripCollapsed = value => {
      stripWrites++
      stripCollapsedMemory = !!value
      try { if (value === null) localStorage.removeItem(STRIP_COLLAPSE_KEY); else localStorage.setItem(STRIP_COLLAPSE_KEY, value ? '1' : '0'); stripStorageBroken = false } catch { stripStorageBroken = true /* 保存できなくても、このタブの中では揃える */ }
      try { window.dispatchEvent(new CustomEvent(STRIP_EVENT, { detail: !!value })) } catch { /* イベントを出せない環境 */ }
    }
    function QuotaStrip() {
      const { cfg, ready, data } = useStore()
      const ref = useRef(null)
      const [collapsed, setCollapsed] = useState(readStripCollapsed)
      const items = ready && cfg.strip ? visible(data, cfg).flatMap(s => barsOf(s, cfg).slice(0, 2).map(b => ({ s, b }))) : []
      const active = items.length > 0 && !collapsed
      useEffect(() => (active ? bindScroller(ref.current) : undefined), [active])
      useEffect(() => {
        if (typeof window?.addEventListener !== 'function') return undefined
        const onLocal = event => setCollapsed(!!event.detail)
        const onStorage = event => {
          // localStorage の参照そのものが例外になる環境(保存を禁止したブラウザなど)もある。
          let local = null
          try { local = localStorage } catch { return }
          if (event.storageArea && event.storageArea !== local) return
          if (event.key !== STRIP_COLLAPSE_KEY && event.key !== null) return
          stripWrites++ // another tab's change counts as an operation, too
          // 別のタブが書けたのなら保存は使えている: このページの中だけの値より、保存先を読み直す。
          try { stripCollapsedMemory = localStorage.getItem(STRIP_COLLAPSE_KEY) === '1'; stripStorageBroken = false } catch { /* 読めないときはこのページの中の値のまま */ }
          setCollapsed(readStripCollapsed())
        }
        window.addEventListener(STRIP_EVENT, onLocal)
        window.addEventListener('storage', onStorage)
        // 最初の描画からここまでの間に変わった分を取りこぼさない。
        setCollapsed(readStripCollapsed())
        return () => { window.removeEventListener(STRIP_EVENT, onLocal); window.removeEventListener('storage', onStorage) }
      }, [])
      if (!items.length) return null
      const toggle = () => { const next = !collapsed; setCollapsed(next); writeStripCollapsed(next) }
      // 名前と説明は固定(サイドバー・コーナーのアイコンと区別できる名前)。開いているかは aria-expanded だけで伝える。
      return el('div', { className: 'ub-strip-wrap' + (collapsed ? ' collapsed' : '') },
        collapsed ? null : el('div', { className: 'ub-strip', ref }, items.map(({ s, b }, i) => el(StripItem, { key: i, s, b, cfg }))),
        el('button', { type: 'button', className: 'ub-strip-toggle', 'aria-label': '使用量バー', title: '使用量バーの表示を切り替え', 'aria-expanded': !collapsed, onClick: toggle }, el(BarsIcon)))
    }

    // 入力欄のドック: 初期状態は1アイコン。サイドバーとは独立して開閉する。
    function CornerChips() {
      const { cfg, ready, data } = useStore()
      const [expanded, setExpanded] = useState(false)
      const ref = useRef(null)
      const shown = ready && cfg.chips ? visible(data, cfg).filter(s => barsOf(s, cfg).length) : []
      const active = expanded && shown.length > 0
      // Hooks は設定・データの有無に関係なく同じ順序で呼ぶ。
      useEffect(() => (active ? bindScroller(ref.current) : undefined), [active])
      if (!shown.length) return null
      return el('div', { className: 'ub-chips' + (expanded ? ' expanded' : ''), onKeyDown: e => {
        if (e.key === 'Escape' && expanded) { setExpanded(false); e.currentTarget.querySelector('.ub-chips-toggle')?.focus() }
      } },
        expanded ? el('div', { className: 'ub-chips-scroll', ref, tabIndex: 0, role: 'region', 'aria-label': 'プロバイダの使用量（横スクロール）' },
          el('div', { className: 'ub-chips-row' }, shown.map(s => {
            const text = sourceDetailText(s, cfg)
            const values = barsOf(s, cfg).flatMap((b, i) => [
              i ? el('span', { key: 'sep-' + i, 'aria-hidden': 'true' }, '|') : null,
              el('span', { key: 'value-' + i, className: 'ub-chip-value' + levelOf(b.usedPercent, cfg) }, Math.round(b.usedPercent)),
            ])
            return el(Tip, { key: s.id, label: el(SourceDetail, { s, cfg }), text, tap: true },
              el('span', { className: 'ub-chip', tabIndex: 0, 'aria-label': text.replace(/\n/g, ', ') }, el(ProviderIcon, { s, size: 13 }), ...values))
          }))) : null,
        el('button', { type: 'button', className: 'ub-chips-toggle', 'aria-label': '使用量の一覧', title: '使用量の一覧の表示を切り替え', 'aria-expanded': expanded, onClick: () => setExpanded(value => !value) },
          el(BarsIcon, { size: 18 })))
    }

    // ── 設定画面 ──
    // General-section boolean row: title on the left, the standard 36x20 switch on the right.
    function Check({ label, description, checked, onChange }) {
      return el('div', { className: 'ub-srow' },
        el('div', { className: 'ub-srow-text' },
          el('span', { className: 'ub-srow-title' }, label),
          description ? el('span', { className: 'ub-srow-desc' }, description) : null),
        el('button', {
          type: 'button', role: 'switch', className: 'ub-switch', 'aria-checked': String(!!checked), 'aria-label': label,
          // 保存の失敗は設定画面のメッセージ(.ub-msg)に出る。onChange が何を返しても、ここで例外にしない。
          onClick: () => { try { Promise.resolve(onChange(!checked)).catch(() => {}) } catch { /* 同期の例外も外へ出さない */ } },
        }, el('span', { className: 'ub-switch-thumb' })))
    }
    // General-section row with a trailing control: title and optional 12px/18px description left.
    function Field({ label, description, control }) {
      return el('div', { className: 'ub-field' },
        el('div', { className: 'ub-srow-text' },
          el('span', { className: 'ub-srow-title' }, label),
          description ? el('span', { className: 'ub-srow-desc' }, description) : null),
        control)
    }
    const EMPTY_USAGE = { sources: [] }

    // Usage services live in the "使用量バー" settings section (its first tab), apart from DSH's
    // Models page, which keeps only model registration. Each row shows the service state, its
    // display switch and order, plus the credentials that only quota fetching needs.
    function UsageServices() {
      const { cfg: cfgLive, ready, data: liveData } = useStore()
      const cfg0 = ready ? cfgLive : null
      const data = liveData || EMPTY_USAGE
      const [drafts, setDrafts] = useState({})
      const [msg, setMsg] = useState('')
      const [saving, setSaving] = useState(false)
      const [showAll, setShowAll] = useState(false)
      const patch = useCallback(p => {
        setSaving(true)
        // 失敗は画面のメッセージに出し、呼び出し側へは成否(true/false)だけを返す(未処理の rejection にしない)。
        return saveConfig(p).then(() => { setMsg('保存しました'); return true }, e => { setMsg(e?.message || '保存に失敗しました'); return false }).finally(() => setSaving(false))
      }, [])
      if (!cfg0) return el('div', { className: 'ub-set', role: 'status' }, store.error || '使用量の設定を読み込んでいます…', el('button', { type: 'button', className: 'ub-btn ub-btn-lg', onClick: () => store.refresh() }, '再読み込み'))
      const cfg = { ...DEFAULT_CFG, ...cfg0 }
      const ids = [...cfg.sourceIds].sort((a, b) => { const f = id => { const i = (cfg.order || []).indexOf(id); return i < 0 ? 999 + cfg.sourceIds.indexOf(id) : i }; return f(a) - f(b) })
      const statusOf = id => data.sources.find(s => s.id === id)
      const saveKey = name => {
        const removing = !drafts[name] && cfg.keysSet[name]
        if (removing && typeof confirm === 'function' && !confirm(name + ' を削除します。他のプラグインも同じキーを使っている場合、それらも使えなくなります。')) return
        patch({ keys: { [name]: drafts[name] || '' } }).then(ok => { if (ok) setDrafts(d => ({ ...d, [name]: '' })) })
      }
      const move = (id, dir) => { const next = ids.slice(); const i = next.indexOf(id); const j = i + dir; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; patch({ order: next }) }
      // Credentials the Models settings already own: dsh-model-routes route keys plus the DSH
      // provider keys (the bundled DeepSeek provider). Those are edited in "Models" only, so this
      // list shows their state and never a second input for the same credential.
      const CORE_MODEL_KEYS = ['DEEPSEEK_API_KEY']
      const modelKeyNames = new Set([...CORE_MODEL_KEYS, ...Object.values(cfg.routeKeyNames || {}).flat()])
      // Remaining credentials are reached only by usage fetching; name them in Japanese and keep
      // the environment name in the tooltip.
      const keyLabel = n => /COOKIE/i.test(n) ? 'Cookie' : /TOKEN/i.test(n) ? 'トークン' : /KEY|SECRET/i.test(n) ? 'APIキー' : '認証情報'
      const keyState = n => {
        const source = cfg.keysSource?.[n]
        const external = !!source && source !== 'file'
        return { external, stored: !!cfg.keysSet[n], text: external ? '環境変数から読み込み' : cfg.keysSet[n] ? '設定済み' : '未設定' }
      }
      const keyRow = n => {
        const state = keyState(n)
        if (modelKeyNames.has(n)) {
          return el('div', { key: n, className: 'ub-key' },
            el('div', { className: 'ub-key-head' },
              el('span', { className: 'ub-key-name', title: n }, keyLabel(n)),
              el('span', { className: 'ub-key-state' }, state.text)))
        }
        const typed = !!drafts[n]
        return el('div', { key: n, className: 'ub-key' },
          el('div', { className: 'ub-key-head' },
            el('span', { className: 'ub-key-name', title: n }, keyLabel(n)),
            el('span', { className: 'ub-key-state' }, state.text)),
          el('div', { className: 'ub-key-row' },
            el('input', {
              type: 'password',
              'aria-label': keyLabel(n) + (state.stored ? '(変更する場合のみ入力)' : 'を入力'),
              placeholder: state.stored ? '変更する場合のみ入力' : 'ここに入力',
              value: drafts[n] || '',
              onChange: e => setDrafts({ ...drafts, [n]: e.target.value }),
            }),
            el('button', {
              type: 'button',
              className: 'ub-btn',
              disabled: saving || !(typed || state.stored) || (!typed && state.external),
              onClick: () => saveKey(n),
            }, typed ? '保存' : (state.external ? '環境変数' : state.stored ? '削除' : '保存'))))
      }
      const serviceRow = id => {
        const st = statusOf(id)
        const names = cfg.keyNames[id] || []
        const route = cfg.routes?.[cfg.sourceProvider?.[id]]?.[cfg.sourceRoute?.[id]]
        const routeOff = st?.status === 'off' && /モデル登録側で無効/.test(st.error || '')
        const on = cfg.enabled[id] !== false
        // 'ok' は取得に成功している状態。「取得中」と書くと処理中に見えるため使わない。
        const status = !on ? '使用量を表示しない' : st ? (st.status === 'ok' ? '取得できています' : st.status === 'off' ? (routeOff ? 'モデル側で無効' : '未設定') : 'エラー') : '確認中'
        const meta = [route ? (route.enabled ? 'モデル登録あり（' + route.modelCount + '件）' : 'モデル側で無効') : null, status].filter(Boolean).join(' ・ ')
        const title = st ? st.label : cfg.sourceLabels?.[id] || id
        return el('div', { key: id, className: 'ub-srow ub-service' },
          el('div', { className: 'ub-srow-text' },
            el('span', { className: 'ub-srow-title' }, title),
            el('span', { className: 'ub-srow-desc ' + (!on ? 'ub-st-off' : st ? 'ub-st-' + st.status : '') }, meta),
            st && st.error && on ? el('span', { className: 'ub-err' }, st.error) : null,
            names.length && on ? el('div', { className: 'ub-keys' }, names.map(keyRow)) : null),
          el('div', { className: 'ub-srow-ctl' },
            el('button', {
              type: 'button', role: 'switch', className: 'ub-switch',
              'aria-checked': String(on), 'aria-label': title + ' の使用量を取得',
              onClick: () => patch({ enabled: { [id]: !on } }),
            }, el('span', { className: 'ub-switch-thumb' })),
            el('button', { type: 'button', className: 'ub-btn ub-btn-icon', 'aria-label': title + ' を上へ', onClick: () => move(id, -1) }, '\u2191'),
            el('button', { type: 'button', className: 'ub-btn ub-btn-icon', 'aria-label': title + ' を下へ', onClick: () => move(id, 1) }, '\u2193')))
      }
      // The list follows DSH's Models page: registered services are listed automatically; the rest
      // appear only when they are switched on or already have a credential.
      const CORE_MODEL_SOURCES = new Set(['deepseek'])
      const registeredOf = id => {
        if (CORE_MODEL_SOURCES.has(id)) return true
        const providerId = cfg.sourceProvider?.[id]
        const record = providerId ? cfg.routes?.[providerId] : null
        if (!record) return false
        const kind = cfg.sourceRoute?.[id]
        return !!(kind ? record[kind] : record.api || record.subscription)
      }
      const configured = id => (cfg.keyNames[id] || []).some(n => cfg.keysSet[n])
      const shownIds = ids.filter(id => showAll || registeredOf(id) || cfg.enabled[id] !== false || configured(id))
      return el('div', { className: 'ub-set ub-svc-list' },
        el('h3', null, 'サービス'),
        el('div', { className: 'ub-srow-desc' }, 'サイドバーに使用量を出すサービスと並び順を選びます。スイッチは使用量の取得と表示だけを切り替え、モデルの登録は変えません（モデルは DSH 設定の「モデル」で登録します）。'),
        el('div', { className: 'ub-list' }, shownIds.map(serviceRow)),
        el(Check, { label: 'モデル未登録のサービスも表示', checked: showAll, onChange: setShowAll }),
        el('div', { className: 'ub-srow-desc', style: { paddingTop: 8 } }, 'キーはDSHの資格情報に保存します。Cookie 系は、ブラウザの Cookie ヘッダをそのまま貼ってください。'),
        msg ? el('div', { className: 'ub-msg' }, msg) : null)
    }

    function UsageSettings() {
      const { cfg: cfgLive, ready, data: liveData } = useStore()
      const cfg0 = ready ? cfgLive : null
      const data = liveData || EMPTY_USAGE
      const [hist, setHist] = useState({})
      const [days, setDays] = useState(7)
      const [msg, setMsg] = useState('')
      const [saving, setSaving] = useState(false)
      const [tab, setTab] = useState('services')
      useEffect(() => { let active = true; if (ready) call('getHistory', days).then(h => { if (active) setHist(h) }).catch(() => {}); return () => { active = false } }, [days, liveData, ready])
      const patch = useCallback(p => {
        setSaving(true)
        // 失敗は画面のメッセージに出し、呼び出し側へは成否(true/false)だけを返す(未処理の rejection にしない)。
        return saveConfig(p).then(() => { setMsg('保存しました'); return true }, e => { setMsg(e?.message || '保存に失敗しました'); return false }).finally(() => setSaving(false))
      }, [])
      if (!cfg0) return el('div', { className: 'ub-set', role: 'status' }, store.error || 'DSHから使用量の設定を読み込んでいます…', el('button', { type: 'button', className: 'ub-btn ub-btn-lg', onClick: () => store.refresh() }, '再読み込み'))
      const cfg = { ...DEFAULT_CFG, ...cfg0 }
      const statusOf = id => data.sources.find(s => s.id === id)
      const tabs = [['services', 'サービス'], ['display', '表示'], ['notify', '通知'], ['history', '履歴']]
      const panels = {
        services: [el(UsageServices, { key: 'services' })],
        display: [
          el('div', null, el('h3', null, '表示'),
            el(Check, { label: '起動時に畳んだ状態で表示', checked: cfg.collapsedDefault, onChange: v => patch({ collapsedDefault: v }) }),
            el(Check, { label: 'リセットまでの時間を表示', checked: cfg.showReset, onChange: v => patch({ showReset: v }) }),
            el(Check, { label: '残高などの文字情報を表示', checked: cfg.showText, onChange: v => patch({ showText: v }) }),
            el(Check, { label: 'プラン名を表示', checked: cfg.showPlan, onChange: v => patch({ showPlan: v }) }),
            el(Check, { label: 'ペース警告', description: 'このペースだと枠が尽きる時刻を表示します。', checked: cfg.pace, onChange: v => patch({ pace: v }) }),
            el(Field, { label: 'サイドバーの表示形式', description: 'サイドバーのカードの詰め方を選びます。', control: el('select', { value: cfg.style, onChange: e => patch({ style: e.target.value }) },
              el('option', { value: 'standard' }, '標準'), el('option', { value: 'compact' }, '2列カード'), el('option', { value: 'simple' }, '簡易(最大値のみ)')) }),
            el(Field, { label: 'サイドバーの配色', description: '空のときはDSHのテーマに合わせます。', control: el('select', { value: cfg.theme, onChange: e => patch({ theme: e.target.value }) },
              el('option', { value: 'auto' }, 'DSHに合わせる'), el('option', { value: 'light' }, 'ライト'), el('option', { value: 'dark' }, 'ダーク'), el('option', { value: 'warm' }, 'ウォーム')) })),
          el('div', null, el('h3', null, '色と更新'),
            el(Field, { label: '黄色にする使用率', description: 'この割合を超えると注意の色にします。', control: el('input', { type: 'number', min: 1, max: 100, defaultValue: cfg.warnAt, onBlur: e => patch({ warnAt: e.target.value }) }) }),
            el(Field, { label: '赤にする使用率', description: 'この割合を超えると超過の色にします。', control: el('input', { type: 'number', min: 1, max: 100, defaultValue: cfg.overAt, onBlur: e => patch({ overAt: e.target.value }) }) }),
            el(Field, { label: '更新間隔(秒)', description: '使用量を取得し直す間隔です。', control: el('input', { type: 'number', min: 15, max: 3600, defaultValue: cfg.refreshSeconds, onBlur: e => patch({ refreshSeconds: e.target.value }) }) })),
        ],
        notify: [
          el('div', null, el('h3', null, '追加の表示場所・通知'),
            // オンに戻したときは、前に畳んだままの状態(アイコンだけ)で出さない(保存できたときだけ)。
            el(Check, { label: '入力欄の上に横バーを表示', checked: cfg.strip, onChange: v => {
              // 保存できたときだけ、保存中に開閉されていなければ開き直す(保存中の開閉は残す)。
              const writesBefore = stripWrites
              return patch({ strip: v }).then(ok => { if (ok && v && stripWrites === writesBefore) writeStripCollapsed(null) })
            } }),
            el(Check, { label: '入力欄に使用量アイコンを表示（タップで展開）', checked: cfg.chips, onChange: v => patch({ chips: v }) }),
            el(Check, { label: 'しきい値超過とリセットをデスクトップ通知', checked: cfg.notify, onChange: v => (v && typeof Notification !== 'undefined' && Notification.permission === 'default' ? Promise.resolve(Notification.requestPermission()).then(() => patch({ notify: true })) : patch({ notify: v })) }),
            cfg.notify && typeof Notification !== 'undefined' && Notification.permission === 'denied' ? el('div', { className: 'ub-err' }, 'ブラウザで通知が拒否されています。サイトの設定から許可してください。') : null),
        ],
        history: [
          el('div', null, el('h3', null, '使用率の履歴'),
            el(Check, { label: '履歴を記録する(5分間隔、30日まで)', checked: cfg.history, onChange: v => patch({ history: v }) }),
            el(Field, { label: '期間', control: el('select', { value: days, onChange: e => setDays(Number(e.target.value)) }, [1, 3, 7, 14, 30].map(d => el('option', { key: d, value: d }, d + '日'))) }),
            Object.keys(hist).length === 0 ? el('div', { className: 'ub-err' }, 'まだ記録がありません') : el('div', { className: 'ub-tablewrap' }, el('table', null, el('tbody', null, Object.entries(hist).filter(([, v]) => v.length > 1).map(([key, v]) => {
              const [sid, label] = key.split('|'); const src = statusOf(sid)
              const t0 = v[0][0], t1 = v[v.length - 1][0] || t0 + 1, w = 160, h = 28
              const pts = v.map(p => ((p[0] - t0) / Math.max(1, t1 - t0) * w).toFixed(1) + ',' + (h - p[1] / 100 * h).toFixed(1)).join(' ')
              return el('tr', { key }, el('td', null, (src ? src.label : sid) + ' ' + label), el('td', null, el('svg', { className: 'ub-spark', width: w, height: h, viewBox: '0 0 ' + w + ' ' + h }, el('polyline', { points: pts, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))),
                el('td', null, '最大 ' + Math.round(Math.max(...v.map(p => p[1]))) + '% / 現在 ' + Math.round(v[v.length - 1][1]) + '%'))
            })))),
            el('div', { style: { paddingTop: 12 } }, el('button', { type: 'button', className: 'ub-btn ub-btn-lg', onClick: () => call('clearHistory').then(() => setHist({})).catch(() => setMsg('履歴を消去できませんでした')) }, '履歴を消去'))),
        ],
      }
      return el('div', { className: 'ub-set' },
        el('div', { className: 'ub-tabs' }, tabs.map(([id, label]) => el('button', {
          key: id, type: 'button', className: 'ub-tab' + (tab === id ? ' active' : ''), onClick: () => setTab(id),
        }, label))),
        el('div', { className: 'ub-panel' }, (panels[tab] || panels.display).filter(Boolean)),
        msg ? el('div', { className: 'ub-msg' }, msg) : null)
    }

    const inject = ['remote', 'slots']
    async function apply(ctx) {
      const remote = ctx.remote || ctx.get?.('remote')
      if (typeof remote?.$mount !== 'function') return
      const unmount = await remote.$mount(CONTRIBUTION)
      const service = ctx.get?.('remote.usageBars')
      if (!service) { unmount(); throw new Error('DSHのusageBars RPCが見つかりません') }
      store.bind(service)
      ctx.effect(() => () => { store.bind(null); unmount() }, 'usage-bars: internal RPC')
      // 旧版が保存した接続トークンは不要。
      try { localStorage.removeItem('dsh-usage-bars.connection-token') } catch {}
      const slots = ctx.slots || ctx.get?.('slots')
      if (!slots) return
      const reg = (target, fn) => {
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => slots.inject(target, fn), 'usage-bars: ' + target)
        } else {
          slots.inject(target, fn)
        }
      }
      reg('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'usage-bars', order: -10, inject: () => ({}) }, UsageCard))
      // The usage strip leads the dock above the composer: before todo (0), goal (10), queue (20) and any plugin row.
      reg('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'usage-bars-strip', order: STRIP_DOCK_ORDER, inject: () => ({}) }, QuotaStrip))
      reg('conversation.composer.dock', () => slots.register({ name: 'conversation.composer.dock', id: 'usage-bars-chips', order: 10, inject: () => ({}) }, CornerChips))
      reg('settings.section', () => slots.register({ name: 'settings.section', id: 'usage-bars', order: 32, label: '使用量バー', inject: () => ({}) }, UsageSettings))
    }
    exports.apply = apply
    exports.__test = { store, UsageCard, QuotaStrip, StripItem, wheelToScroll, bindScroller, CornerChips, UsageSettings, UsageServices, call, saveConfig, CONTRIBUTION, Source, SummaryItem, SourceDetail, PaceMark, ProviderIcon, ICONS, Tip, paceOf, paceText, sourceDetailText, css }
    exports.inject = inject
    return module.exports
  },
})
