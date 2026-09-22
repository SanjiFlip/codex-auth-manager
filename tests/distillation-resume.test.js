const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {splitMaterials,distill,estimatePlan}=require('../src/knowledge/distillation');
const {createWorkbench}=require('../src/knowledge/workbench');
const {createJobStore}=require('../src/knowledge/jobs');
const {createKnowledgeStore,markdown}=require('../src/knowledge/store');
const respond=require('../scripts/fixtures/distillation-model');
const codec={encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()};
const wait=async wb=>{while(wb.busy())await new Promise(r=>setTimeout(r,2))};
async function fixture(t,count=5){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-resume-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let changed=false,archived=false;const items=[{id:'s',sessionId:'session',title:'Fixture'}];
  const messages=Array.from({length:count},(_,index)=>({index,role:'user',text:`LOCAL-${index}-`+'x'.repeat(16000),fingerprint:'f'+index}));
  const library={list:async()=>({items:archived?[]:items}),transcript:async()=>({messages:messages.map(m=>changed?{...m,fingerprint:'changed'}:m)})};
  const request={kind:'task',title:'Resume test',project:'',instructions:'',model:'fixture',reasoningEffort:'high',selection:[{id:'s',messages:messages.map(m=>m.index),fingerprints:Object.fromEntries(messages.map(m=>[m.index,m.fingerprint]))}]};
  const jobs=()=>createJobStore({root:path.join(root,'jobs'),...codec}),store=createKnowledgeStore({root:path.join(root,'knowledge'),...codec});
  return {root,request,jobs,store,change:()=>{changed=true},archive:()=>{archived=true},make:(execute,overrides={})=>createWorkbench({library,store,jobs:jobs(),execute,withAccount:fn=>fn(),resolveModel:async()=>({model:'fixture',reasoningEffort:'high'}),...overrides})};
}
test('million-character project uses bounded multilevel consolidation and retains all extracted evidence',async()=>{
  const chunks=splitMaterials([{messages:Array.from({length:65},(_,index)=>({index,role:'user',text:'a'.repeat(16000)}))}]);
  const progress=[];let evidence,calls=0;
  const body=await distill({chunks,brief:'large project',signal:new AbortController().signal,modelSelection:{model:'fixture'},progress:p=>progress.push(p),onEvidence:f=>{evidence=f},execute:async req=>{
    calls++;assert.ok(req.prompt.length<30000,'each request context is bounded');
    if(req.outputSchema.properties.facts){const row=JSON.parse(req.prompt.split('\n').at(-1))[0];return JSON.stringify({facts:Array.from({length:12},()=>({text:'known '.repeat(99),category:'uncertain',evidence:[{source:row.source,quote:row.text.slice(0,100)}]}))});}
    return respond(req);
  }});
  assert.equal(evidence.length,65*12);assert.ok(JSON.stringify(evidence).length>100000);assert.ok(body.length<80000);assert.ok(progress.some(p=>p.stage==='merging'&&p.level>=2));assert.ok(calls<=estimatePlan(chunks.length).calls);assert.match(body,/780 条/);
});
test('fresh process resumes after failure without repeating committed calls and exports full evidence',async t=>{
  const f=await fixture(t,18);let attempts=0;const requests=[];
  const execute=async req=>{attempts++;requests.push(req.prompt);if(attempts===3)throw Error('synthetic disconnect');return respond(req)};
  const first=f.make(execute);assert.ok((await first.preview(f.request)).chars>240000);first.start(f.request);await wait(first);assert.equal(first.state().phase,'failed');assert.equal(first.state().completed,2);
  assert.ok(!(await fs.readFile(path.join(f.root,'jobs','current.enc'),'utf8')).includes('Resume test'));
  const restarted=f.make(execute);await restarted.ready();assert.equal(restarted.state().phase,'paused');assert.equal(restarted.state().completed,2);restarted.resume();await wait(restarted);assert.equal(restarted.state().phase,'completed');
  assert.equal(requests.filter(p=>p===requests[0]).length,1);assert.equal(requests.filter(p=>p===requests[1]).length,1);assert.equal(requests.filter(p=>p===requests[2]).length,2);
  const list=await f.store.list();assert.equal(list.length,1);assert.equal(list[0].evidenceCount,18);assert.equal(list[0].evidence,undefined);const item=await f.store.get(list[0].id);assert.match(markdown(item),/完整证据档案/);assert.equal(new Set(item.evidenceLinks.flatMap(s=>s.factIds)).size,18);assert.match(markdown(item),/章节与证据关联/);assert.match(markdown(item),/B18F1/);assert.equal(await f.jobs().load(),null);
});
test('pause persists completed work and resume validates changed or archived material before any call',async t=>{
  for(const mutation of ['change','archive']){
    const f=await fixture(t);let calls=0;
    const first=f.make(async req=>{calls++;if(calls===2)await new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(Error('paused')),{once:true}));return respond(req)});
    first.start(f.request);while(calls<2)await new Promise(r=>setTimeout(r,2));await first.cancel();assert.equal(first.state().phase,'paused');assert.equal(first.state().completed,1);
    f[mutation]();const next=f.make(async()=>{throw Error('must not call model')});await next.ready();next.resume();await wait(next);assert.equal(next.state().phase,'failed');assert.equal(next.state().resumable,true);assert.match(next.state().message,/变化|归档/);await next.discard();assert.equal(await f.jobs().load(),null);
  }
});
test('crash after draft commit recovers idempotently without another model call',async t=>{
  const f=await fixture(t,1);let calls=0;
  const first=f.make(async req=>{calls++;return respond(req)},{store:{...f.store,save:async(...args)=>{await f.store.save(...args);throw Error('crash after commit')}}});
  first.start(f.request);await wait(first);assert.equal(first.state().phase,'failed');assert.equal((await f.store.list()).length,1);
  const next=f.make(async()=>{throw Error('must not call model')});await next.ready();next.resume();await wait(next);assert.equal(next.state().phase,'completed');assert.equal(calls,2);assert.equal((await f.store.list()).length,1);assert.equal(await f.jobs().load(),null);
});
test('bad consolidation leaves extraction checkpoints reusable and rejects missing evidence associations',async t=>{
  const f=await fixture(t,14);let calls=0;
  const first=f.make(async req=>{calls++;if(!req.outputSchema.properties.facts){const nodes=JSON.parse(req.prompt.split('\n').at(-1));return JSON.stringify({sections:[{heading:'Dropped input',text:'Incomplete',factIds:[nodes[0].id]}]});}return respond(req)});
  first.start(f.request);await wait(first);assert.equal(first.state().phase,'failed');assert.match(first.state().message,/遗漏/);assert.equal(first.state().completed,14);assert.equal((await f.store.list()).length,0);
  let extraction=0;const next=f.make(async req=>{if(req.outputSchema.properties.facts)extraction++;return respond(req)});await next.ready();next.resume();await wait(next);assert.equal(next.state().phase,'completed');assert.equal(extraction,0);
});
test('corrupted checkpoint fails closed and preserves the file',async t=>{
  const f=await fixture(t,2);let calls=0;const wb=f.make(async req=>{if(++calls===2)throw Error('stop');return respond(req)});wb.start(f.request);await wait(wb);
  const job=await f.jobs().load(),file=path.join(f.root,'jobs',job.id,'extract-0.enc');await fs.writeFile(file,'corrupt');const next=f.make(async()=>{throw Error('unexpected model call')});await next.ready();next.resume();await wait(next);assert.equal(next.state().phase,'failed');assert.match(next.state().message,/损坏/);assert.equal(await fs.readFile(file,'utf8'),'corrupt');
});
