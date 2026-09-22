const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {readModelCatalog,resolveModelSelection}=require('../src/knowledge/models');
const {executeDistillation}=require('../src/knowledge/cli');
const {createWorkbench}=require('../src/knowledge/workbench');
const models=[
  {slug:'deep',display_name:'Deep',priority:1,visibility:'list',default_reasoning_level:'high',supported_reasoning_levels:[{effort:'high'},{effort:'xhigh'},{effort:'ultra'}],base_instructions:'DO NOT EXPOSE'},
  {slug:'fast',display_name:'Fast',priority:0,visibility:'list',default_reasoning_level:'low',supported_reasoning_levels:[{effort:'low'},{effort:'medium'}]},
  {slug:'internal',visibility:'hide'},
  {slug:'plain',visibility:'list',supported_reasoning_levels:[]},
];
async function fixture(t){const home=await fs.mkdtemp(path.join(os.tmpdir(),'cam-models-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.writeFile(path.join(home,'models_cache.json'),JSON.stringify({identity:'PRIVATE',fetched_at:'2026-09-21T00:00:00Z',models}));return home;}
test('local picker filters hidden models, reads configured defaults and returns only picker metadata',async t=>{
  const home=await fixture(t);await fs.writeFile(path.join(home,'config.toml'),'model = "deep"\nmodel_reasoning_effort = "ultra"\nsecret = "PRIVATE"\n');
  const result=await readModelCatalog(home);assert.deepEqual(result.models.map(m=>m.id),['fast','deep','plain']);
  assert.equal(result.defaultModel,'deep');assert.equal(result.defaultReasoningEffort,'ultra');assert.equal(result.source,'local-cache');assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!JSON.stringify(result).includes('DO NOT EXPOSE'));
  assert.deepEqual(await resolveModelSelection(home,{}),{model:'deep',reasoningEffort:'ultra'});
  assert.deepEqual(await resolveModelSelection(home,{model:'fast'}),{model:'fast',reasoningEffort:'low'});
  assert.deepEqual(await resolveModelSelection(home,{model:'plain'}),{model:'plain',reasoningEffort:''});
  await assert.rejects(resolveModelSelection(home,{model:'fast',reasoningEffort:'ultra'}),/不支持/);
  await assert.rejects(resolveModelSelection(home,{model:'internal',reasoningEffort:'high'}),/不在本地/);
  await assert.rejects(resolveModelSelection(home,{model:'deep',reasoningEffort:'high"\nweb_search="live'}),/格式/);
});
test('local picker reports missing/corrupt cache without fabricating choices and rereads replaced cache',async t=>{
  const home=await fixture(t);await fs.writeFile(path.join(home,'config.toml'),'invalid = [');assert.ok((await readModelCatalog(home)).warning);
  await fs.writeFile(path.join(home,'models_cache.json'),JSON.stringify({models:[models[1]]}));await assert.rejects(resolveModelSelection(home,{model:'deep',reasoningEffort:'high'}),/不在本地/);
  await fs.writeFile(path.join(home,'models_cache.json'),'bad');await assert.rejects(readModelCatalog(home),/无法读取/);
  await fs.rm(path.join(home,'models_cache.json'));await assert.rejects(readModelCatalog(home),/尚无本地/);
});
test('workbench validates model and effort inside the account lock before executing',async t=>{
  const home=await fixture(t);let locked=false,calls=0;
  const wb=createWorkbench({library:{list:async()=>({items:[{id:'s',title:'fixture'}]}),transcript:async()=>({messages:[{index:0,text:'fixture',fingerprint:'f'}]})},store:{save:async()=>({id:'draft'})},withAccount:async fn=>{locked=true;try{return await fn()}finally{locked=false}},resolveModel:async req=>{assert.ok(locked);return resolveModelSelection(home,req)},execute:async req=>{calls++;assert.equal(req.model,'deep');assert.equal(req.reasoningEffort,'ultra');return require('../scripts/fixtures/distillation-model')(req)}});
  const request={kind:'task',title:'test',project:'',instructions:'',model:'deep',reasoningEffort:'ultra',selection:[{id:'s',messages:[0],fingerprints:{0:'f'}}]};
  const wait=async()=>{while(wb.busy())await new Promise(r=>setTimeout(r,5));};
  wb.start(request);await wait();assert.equal(wb.state().phase,'completed');assert.equal(calls,2);
  wb.start({...request,model:'fast'});await wait();assert.equal(wb.state().phase,'failed');assert.equal(calls,2);
});
test('CLI rejects malformed reasoning before starting any child process',async()=>{
  let resolved=false;
  await assert.rejects(executeDistillation({home:'fixture',prompt:'fixture',reasoningEffort:'high"',resolve:async()=>{resolved=true}}),/格式/);
  assert.equal(resolved,false);
});
