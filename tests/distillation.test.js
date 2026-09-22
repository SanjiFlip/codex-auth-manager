const {test}=require('node:test'),assert=require('node:assert/strict');
const {splitMaterials,validateFacts,renderSynthesis,distill,extractionSchema}=require('../src/knowledge/distillation');
const {createWorkbench}=require('../src/knowledge/workbench');
const model=require('../scripts/fixtures/distillation-model');

test('chunking preserves every selected character, order and source ID across sessions',()=>{
  const materials=Array.from({length:12},(_,i)=>({messages:[{index:i,role:'user',text:String(i).repeat(9000)}]}));
  const chunks=splitMaterials(materials),rows=chunks.flat();assert.ok(chunks.length>1);
  assert.equal(rows.length,12);assert.deepEqual(rows.map(r=>r.text),materials.map(m=>m.messages[0].text));
  assert.deepEqual(rows.map(r=>r.source),materials.map((m,i)=>`${i+1}:${m.messages[0].index+1}`));
  for(const chunk of chunks)assert.ok(JSON.stringify(chunk).length<=24000);
  assert.ok(splitMaterials([{messages:Array.from({length:13},(_,index)=>({index,text:'x'.repeat(20000)}))}]).length>10);
  assert.equal(splitMaterials([{messages:[{index:0,text:'\n'.repeat(16000)}]}]).flat().map(r=>r.text).join(''),'\n'.repeat(16000));
});
test('evidence validation rejects malformed JSON, invented quotes and cross-batch citations',()=>{
  const chunk=[{source:'1:4',role:'user',text:'The user explicitly requested a small UI.'}];
  const fact={text:'Small UI requested',category:'preference',evidence:[{source:'1:4',quote:'small UI'}]};
  const parse=f=>validateFacts(JSON.stringify({facts:[f]}),chunk,0);
  assert.equal(parse(fact)[0].id,'B1F1');
  assert.throws(()=>validateFacts('not json',chunk,0),/结构化/);
  assert.throws(()=>parse({...fact,evidence:[{source:'2:4',quote:'small UI'}]}),/不一致/);
  assert.throws(()=>parse({...fact,evidence:[{source:'1:4',quote:'large UI'}]}),/不一致/);
  assert.throws(()=>parse({...fact,evidence:[]}),/证据/);
  assert.throws(()=>validateFacts(JSON.stringify({facts:[fact]}),[{...chunk[0],role:'assistant'}],0),/用户原文/);
});
test('consolidation renders citations from verified evidence and rejects unknown IDs',()=>{
  const facts=[{id:'B1F1',text:'Small UI requested',category:'uncertain',evidence:[{source:'1:4',quote:'small UI'}]}];
  const section={heading:'Design',text:'Check the UI choice.',factIds:['B1F1']};
  const render=s=>renderSynthesis(JSON.stringify({sections:[s]}),facts);
  assert.match(render(section),/来源：\[1:4\]/);assert.match(render(section),/待核实/);
  assert.throws(()=>render({...section,factIds:['B2F1']}),/不存在/);
  assert.throws(()=>render({...section,text:'Fabricated [2:8]'}),/未经校验/);
});
test('multi-batch distillation validates before synthesis and stops immediately on cancellation',async()=>{
  const chunks=splitMaterials([{messages:Array.from({length:5},(_,index)=>({index,text:'a'.repeat(15000)}))}]);
  const progress=[],signal=new AbortController().signal;let calls=0;
  const body=await distill({chunks,brief:'test',modelSelection:{model:'fixture',reasoningEffort:'high'},signal,progress:s=>progress.push(s),execute:async req=>{calls++;assert.equal(req.model,'fixture');return model(req)}});
  assert.equal(calls,chunks.length+1);assert.equal(progress.at(-1).stage,'synthesizing');assert.match(body,/证据与审阅/);
  const controller=new AbortController();calls=0;
  await assert.rejects(distill({chunks,brief:'test',modelSelection:{},signal:controller.signal,progress:()=>{},execute:async req=>{calls++;controller.abort();return model(req)}}),/暂停/);assert.equal(calls,1);
  calls=0;await assert.rejects(distill({chunks,brief:'test',modelSelection:{},signal,progress:()=>{},execute:async()=>{calls++;return '{}'}}),/格式/);assert.equal(calls,1);
});
test('project-size preview makes no model calls; stale or invalid output never saves a draft',async()=>{
  let calls=0,saved=0,changed=false;
  const items=Array.from({length:12},(_,i)=>({id:'s'+i,sessionId:'session'+i,title:'Session '+i}));
  const wb=createWorkbench({library:{list:async()=>({items}),transcript:async()=>({messages:[{index:0,role:'user',text:'Selected project content',fingerprint:changed?'new':'f'}]})},store:{save:async()=>{saved++;return {id:'draft'}}},withAccount:fn=>fn(),resolveModel:async()=>({model:'fixture'}),execute:async req=>{calls++;assert.deepEqual(req.outputSchema,extractionSchema);return 'invalid'}});
  const req={kind:'task',title:'Project',project:'',instructions:'',selection:items.map(s=>({id:s.id,messages:[0],fingerprints:{0:'f'}}))};
  assert.equal((await wb.preview(req)).batches,1);assert.equal((await wb.preview(req)).calls,2);assert.equal(calls,0);
  const wait=async()=>{while(wb.busy())await new Promise(r=>setTimeout(r,5))};
  wb.start(req);await wait();assert.equal(wb.state().phase,'failed');assert.equal(saved,0);assert.equal(calls,1);
  changed=true;wb.resume();await wait();assert.equal(wb.state().phase,'failed');assert.equal(saved,0);assert.equal(calls,1);
  await assert.rejects(wb.preview({...req,selection:[req.selection[0],req.selection[0]]}));
});
