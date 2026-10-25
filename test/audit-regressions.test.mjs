// Offline lifecycle/race regressions for UB-1 through UB-5.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createUsageService } from '../lib/index.js'
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const value = (id, usedPercent=25) => ({ id, label:id, status:'ok', bars:[{label:'Budget', usedPercent}] })
const ok = value => ({ok:true,value})
const cfg = extra => ({enabled:{}, order:[], registeredModels:['Gemini Pro'], refreshSeconds:60, ...extra})
function client() {
  let module
  const React = {createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),useState:x=>[typeof x==='function'?x():x,()=>{}],useEffect(){},useCallback:x=>x,useRef:()=>({current:null})}
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'), {window:{__ModuleLoader__:{load:d=>{module=d.factory(n=>n==='react'?React:{})}}},document:{getElementById:()=>true},localStorage:{getItem:()=>null},setInterval:()=>1,clearInterval(){}})
  return module.__test
}
function text(node) {
  if(node==null||typeof node==='boolean')return ''
  if(Array.isArray(node))return node.map(text).join(' ')
  if(typeof node!=='object')return String(node)
  if(typeof node.type==='function')return text(node.type({...node.props,children:node.children}))
  return text(node.children)
}
function temp(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ub-regression-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return path.join(dir,'config.json') }

test('UB-1: disposed writer and queued saves cannot overwrite replacement settings', async t=>{
  const configPath=temp(t), gate=deferred(), started=deferred(); let writes=0
  const old=createUsageService({sources:{},configPath,credentials:{set:async()=>{writes++;started.resolve();await gate.promise}}})
  const first=old.updateConfig({keys:{DEEPSEEK_API_KEY:'synthetic'}})
  const firstRejected=assert.rejects(first,/disposed/)
  await started.promise
  const queued=old.updateConfig({keys:{DEEPSEEK_API_KEY:'queued'},showText:false})
  const queuedRejected=assert.rejects(queued,/disposed/)
  old.dispose()
  const next=createUsageService({sources:{},configPath});t.after(()=>next.dispose())
  await next.updateConfig({showPlan:false});gate.resolve()
  await Promise.all([firstRejected,queuedRejected])
  assert.equal(writes,1)
  const saved=JSON.parse(fs.readFileSync(configPath,'utf8'));assert.equal(saved.showPlan,false);assert.equal(saved.showText,true)
})

test('UB-1: migration stops after teardown without removing replacement keys',async t=>{
  const configPath=temp(t), gate=deferred(), started=deferred();let sets=0
  fs.writeFileSync(configPath,JSON.stringify({keys:{DEEPSEEK_API_KEY:'legacy'},showPlan:true}))
  const service=createUsageService({sources:{},configPath,credentials:{describe:async()=>{started.resolve();await gate.promise;return {}},set:async()=>{sets++}}})
  const pending=service.getConfig();const rejected=assert.rejects(pending,/disposed/)
  await started.promise;service.dispose()
  fs.writeFileSync(configPath,JSON.stringify({keys:{DEEPSEEK_API_KEY:'replacement'},showPlan:false}))
  gate.resolve();await rejected
  assert.equal(sets,0);assert.equal(JSON.parse(fs.readFileSync(configPath,'utf8')).keys.DEEPSEEK_API_KEY,'replacement')
})

test('UB-1: failed save does not poison the save queue',async()=>{
  let fail=true
  const service=createUsageService({sources:{},credentials:{set:async()=>{if(fail)throw Error('fixture failure')}}})
  await assert.rejects(service.updateConfig({keys:{DEEPSEEK_API_KEY:'fake'}}),/fixture failure/)
  fail=false;assert.equal((await service.updateConfig({showPlan:false})).showPlan,false);service.dispose()
})

for (const external of [false,true]) test('UB-5: '+(external?'external':'local')+' route OFF suppresses in-flight usage and history',async()=>{
  let enabled=true;const gate=deferred(), started=deferred()
  const service=createUsageService({sources:{commandcode:async()=>{started.resolve();await gate.promise;return value('commandcode',99)}},modelRoutes:{snapshot:()=>({routes:{commandcode:{api:{enabled}}}}),setRouteEnabled:async(_p,_k,v)=>{enabled=v}}})
  const pending=service.getUsage();await started.promise
  if(external)enabled=false;else await service.setRoute('commandcode','api',false)
  gate.resolve();assert.equal((await pending).sources[0].status,'off');assert.deepEqual(service.getHistory(),{})
  assert.equal((await service.getUsage()).sources[0].status,'off');service.dispose()
})

for (const observation of ['getUsage','getConfig']) test('UB-5: externally observed OFF/ON invalidates old in-flight result via '+observation,async()=>{
  let enabled=true,calls=0;const gate=deferred(),started=deferred()
  const service=createUsageService({sources:{commandcode:async()=>{if(++calls===1){started.resolve();await gate.promise;return value('commandcode',99)}return value('commandcode',12)}},modelRoutes:{snapshot:()=>({routes:{commandcode:{api:{enabled}}}})}})
  const old=service.getUsage();await started.promise
  enabled=false;const observed=await service[observation]()
  if(observation==='getUsage')assert.equal(observed.sources[0].status,'off')
  else assert.equal(observed.routes.commandcode.api.enabled,false)
  enabled=true;gate.resolve()
  assert.equal((await old).sources[0].bars[0].usedPercent,12)
  assert.equal((await service.getUsage()).sources[0].bars[0].usedPercent,12)
  assert.equal(calls,2);assert.deepEqual(service.getHistory()['commandcode|Budget'].map(p=>p[1]),[12]);service.dispose()
})

test('UB-5: OFF/ON generation rejects old data; failed route mutation remains retryable',async()=>{
  let enabled=true,calls=0,fail=false;const gate=deferred(),started=deferred()
  const service=createUsageService({sources:{commandcode:async()=>{if(++calls===1){started.resolve();await gate.promise;return value('commandcode',99)}return value('commandcode',12)}},modelRoutes:{snapshot:()=>({routes:{commandcode:{api:{enabled}}}}),setRouteEnabled:async(_p,_k,v)=>{if(fail)throw Error('route failure');enabled=v}}})
  const old=service.getUsage();await started.promise
  await service.setRoute('commandcode','api',false);await service.setRoute('commandcode','api',true)
  const fresh=await service.getUsage();gate.resolve();assert.equal((await old).sources[0].bars[0].usedPercent,12)
  assert.equal(fresh.sources[0].bars[0].usedPercent,12);assert.deepEqual(service.getHistory()['commandcode|Budget'].map(p=>p[1]),[12])
  fail=true;await assert.rejects(service.setRoute('commandcode','api',false),/route failure/)
  assert.equal((await service.getUsage()).sources[0].status,'ok');service.dispose()
})

test('UB-2: late saves cannot resurrect disconnected or replacement stores',async()=>{
  for(const rebind of [false,true]) {
    const {store,saveConfig}=client(),gate=deferred()
    store.bind({updateConfig:()=>gate.promise});store.cfg=cfg()
    const pending=saveConfig({showPlan:false});store.bind(null)
    if(rebind){store.bind({getConfig:async()=>ok(cfg({showPlan:true})),getUsage:async()=>ok({sources:[]})});await store.refresh()}
    gate.resolve(ok(cfg({showPlan:false})));await pending
    assert.equal(store.cfg?.showPlan,rebind?true:undefined);store.bind(null)
  }
})

test('UB-2/3: save beats older poll, out-of-order saves and failures recover on next refresh',async()=>{
  const {store,saveConfig}=client(),poll=deferred(),one=deferred(),two=deferred();let reads=0,saves=0
  store.bind({getConfig:()=>++reads===1?poll.promise:Promise.resolve(ok(cfg({showPlan:false}))),getUsage:async()=>ok({sources:[]}),updateConfig:()=>++saves===1?one.promise:saves===2?two.promise:Promise.reject(Error('save failure'))})
  const old=store.refresh();await Promise.resolve()
  const first=saveConfig({showPlan:true}),second=saveConfig({showPlan:false})
  two.resolve(ok(cfg({showPlan:false})));await second
  one.resolve(ok(cfg({showPlan:true})));await first
  poll.resolve(ok(cfg({showPlan:true})));await old
  assert.equal(store.cfg.showPlan,false)
  const failure=saveConfig({showPlan:true});await assert.rejects(failure,/save failure/)
  await store.refresh();assert.equal(store.cfg.showPlan,false);assert.equal(store.saving,0)
  store.bind(null)
})

test('UB-3: ordinary refresh reloads external settings/models, coalesces and recovers failure without loops',async()=>{
  const {store}=client();let host=cfg(),reads=0,fail=false
  store.bind({getConfig:async()=>{reads++;if(fail)throw Error('offline');return ok(host)},getUsage:async()=>ok({sources:[]})})
  const a=store.refresh();assert.equal(store.refresh(),a);await a
  host=cfg({enabled:{fake:false},registeredModels:['Different Model']});await store.refresh()
  assert.equal(store.cfg.enabled.fake,false);assert.equal(store.cfg.registeredModels[0],'Different Model')
  fail=true;await store.refresh();assert.equal(store.error,'offline');assert.equal(reads,3)
  await Promise.resolve();assert.equal(reads,3,'no immediate failure retry loop')
  fail=false;await store.refresh();assert.equal(store.error,'');assert.equal(reads,4);store.bind(null)
})

test('UB-2/3: replacement refresh does not wait for old connection or lose its pending lock',async()=>{
  const {store}=client(),oldGate=deferred(),newGate=deferred();let calls=0
  store.bind({getConfig:()=>oldGate.promise});const old=store.refresh();await Promise.resolve()
  store.bind({getConfig:()=>{calls++;return newGate.promise},getUsage:async()=>ok({sources:[]})});const next=store.refresh();await Promise.resolve()
  oldGate.resolve(ok(cfg({showPlan:false})));await old
  assert.equal(store.refresh(),next);assert.equal(calls,1)
  newGate.resolve(ok(cfg({showPlan:true})));await next;assert.equal(store.cfg.showPlan,true);store.bind(null)
})

test('UB-2: rejected old mutation cannot disturb replacement polling or its error',async()=>{
  const {store,saveConfig}=client(),gate=deferred()
  store.bind({updateConfig:()=>gate.promise})
  const old=saveConfig({showPlan:false}),rejected=assert.rejects(old,/old failure/)
  store.bind({getConfig:async()=>ok(cfg({showPlan:true})),getUsage:async()=>ok({sources:[]})})
  await store.refresh();const revision=store.revision
  gate.reject(Error('old failure'));await rejected
  assert.equal(store.revision,revision);assert.equal(store.saving,0);assert.equal(store.error,'');assert.equal(store.cfg.showPlan,true)
  store.bind(null)
})

test('UB-3: subscribed save triggers one follow-up snapshot, not recursive polling',async()=>{
  const {store,saveConfig}=client();let reads=0,host=cfg({showPlan:true})
  store.bind({getConfig:async()=>{reads++;return ok(host)},getUsage:async()=>ok({sources:[]}),updateConfig:async patch=>{host={...host,...patch};return ok(host)}})
  const off=store.subscribe(()=>{});await store.refresh()
  await saveConfig({showPlan:false});await store.refresh();await Promise.resolve()
  assert.equal(reads,2);assert.equal(store.cfg.showPlan,false)
  off();store.bind(null)
})

test('UB-4: detail, summary, rail and strip use only registered model bars before truncating',()=>{
  const t=client();t.store.cfg=cfg({strip:true});const s={id:'antigravity',label:'Antigravity',status:'ok',modelBars:true,bars:[{label:'Other A',usedPercent:99},{label:'Other B',usedPercent:90},{label:'Gemini Pro',usedPercent:10}]};t.store.data={sources:[s]}
  for(const node of [t.Source({s,cfg:t.store.cfg,open:true}),t.SummaryItem({s,cfg:t.store.cfg}),t.QuotaStrip(),t.UsageCard({wide:false}).props.title]){
    const rendered=text(node);assert.doesNotMatch(rendered,/99%|90%|Other A|Other B/);assert.match(rendered,/10%/)
  }
  const hidden={...s,bars:s.bars.slice(0,2)};assert.equal(t.SummaryItem({s:hidden,cfg:t.store.cfg}),null)
})
