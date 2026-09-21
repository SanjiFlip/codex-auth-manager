const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createKnowledgeStore,markdown}=require('../src/knowledge/store');
const {createSessionLibrary}=require('../src/knowledge/sessions');
const {createWorkbench}=require('../src/knowledge/workbench');
const {executeDistillation}=require('../src/knowledge/cli');
const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cam-knowledge-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const base={kind:'task',title:'Test',body:'Known result',project:'fixture'};
const codec={encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()};
test('knowledge CRUD survives reload, rejects stale edits and preserves corrupt storage',async t=>{
 const root=await temp(t),store=createKnowledgeStore({root,...codec});
 const [a,b]=await Promise.all([store.save(base),store.save({...base,title:'Other'})]);assert.equal((await store.list()).length,2);
 assert.equal((await createKnowledgeStore({root,...codec}).list()).length,2);
 const saved=await store.save({...a,body:'Revised'});await assert.rejects(store.save(a),/其他窗口/);
 assert.match(markdown({...saved,kind:'skill'}),/^---\nname:/);await store.remove(b.id,b.revision);assert.equal((await store.list()).length,1);
 await fs.writeFile(path.join(root,'knowledge.enc'),'corrupt');await assert.rejects(store.save(base),/无法解密/);assert.equal(await fs.readFile(path.join(root,'knowledge.enc'),'utf8'),'corrupt');
});
test('session selection excludes tool/system text and duplicate event transcripts',async t=>{
 const home=await temp(t);await fs.mkdir(path.join(home,'sessions'));
 const rows=[{type:'session_meta',payload:{id:'fixture',cwd:'/sample/project'}},{type:'response_item',payload:{type:'message',role:'system',content:[{type:'input_text',text:'SECRET-SYSTEM'}]}},{type:'response_item',payload:{type:'function_call_output',output:'SECRET-TOOL'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Selected message'}]}},{type:'event_msg',payload:{type:'user_message',message:'Selected message'}}];
 await fs.writeFile(path.join(home,'sessions','fixture.jsonl'),rows.map(JSON.stringify).join('\n'));
 require('../scripts/fixtures/knowledge-index').writeKnowledgeIndex(home,[{id:'fixture',file:path.join(home,'sessions','fixture.jsonl')}]);
 const lib=createSessionLibrary(home),list=await lib.list();assert.equal(list.items.length,1);const result=await lib.transcript(list.items[0].id);assert.equal(result.messages.length,1);assert.equal(result.messages[0].text,'Selected message');assert.equal(result.messages[0].fingerprint.length,64);await assert.rejects(lib.transcript('../auth.json'),{code:'SESSION_UNAVAILABLE'});
});
test('workbench sends only selected messages, redacts secrets and persists a draft with provenance',async()=>{
 let prompt,entry;const message={index:3,role:'user',text:'Preference with sk-abcdefghijklmnopqrstuvw',fingerprint:'chosen'};
 const library={list:async()=>({items:[{id:'ref',title:'Project',sessionId:'session'}]}),transcript:async()=>({messages:[{index:0,text:'UNSELECTED'},message]})};
 const store={save:async x=>{entry=x;return {...x,id:'draft'}}};
 const wb=createWorkbench({library,store,resolveModel:async()=>({model:'test-model',reasoningEffort:'high'}),withAccount:fn=>fn(),execute:async x=>{prompt=x.prompt;assert.equal(x.model,'test-model');assert.equal(x.reasoningEffort,'high');return '整理结果'}});
 const request={...base,instructions:'',selection:[{id:'ref',messages:[3],fingerprints:{3:'chosen'}}]};
 wb.start(request);assert.throws(()=>wb.start(request),/正在运行/);while(wb.busy())await new Promise(r=>setTimeout(r,5));assert.equal(wb.state().phase,'completed');assert.ok(!prompt.includes('UNSELECTED'));assert.ok(!prompt.includes('sk-abcdefghijklmnopqrstuvw'));assert.equal(entry.status,'draft');assert.deepEqual(entry.sources[0].messages,[3]);
 entry=null;wb.start({...request,selection:[{id:'ref',messages:[3],fingerprints:{3:'changed'}}]});while(wb.busy())await new Promise(r=>setTimeout(r,5));assert.equal(wb.state().phase,'failed');assert.equal(entry,null);
});
function fixture(onSpawn){return (command,args,options)=>{const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.pid=123;c.exitCode=null;c.signalCode=null;queueMicrotask(()=>onSpawn(c,args,options));return c;};}
test('CLI uses hidden native process, sends material over stdin and collects UTF-8 result',async()=>{
 let received='',cwd;
 const output=await executeDistillation({home:'test-home',prompt:'PRIVATE-INPUT',model:'test-model',reasoningEffort:'xhigh',resolve:async()=>({command:'fixture',args:[]}),spawnProcess:fixture((c,args,options)=>{
  cwd=options.cwd;assert.equal(args[args.indexOf('--model')+1],'test-model');assert.ok(args.includes('model_reasoning_effort="xhigh"'));assert.equal(options.windowsHide,true);assert.equal(options.shell,false);assert.equal(options.env.CODEX_HOME,'test-home');assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ephemeral'));assert.ok(args.includes('features.shell_tool=false'));assert.ok(!args.includes('PRIVATE-INPUT'));c.stdin.on('data',x=>received+=x);
  const out=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'中文草稿'}})+'\n'+JSON.stringify({type:'turn.completed'})+'\n');for(const byte of out)c.stdout.write(Buffer.from([byte]));c.exitCode=0;c.emit('close',0);
 }),stop:async()=>{}});
 assert.equal(output,'中文草稿');assert.equal(received,'PRIVATE-INPUT');await assert.rejects(fs.stat(cwd));
});
test('CLI cancellation stops only owned child and does not return partial output',async()=>{
 const controller=new AbortController();let stopped=0;
 await assert.rejects(executeDistillation({home:'test-home',prompt:'text',signal:controller.signal,resolve:async()=>({command:'fixture',args:[]}),spawnProcess:fixture(c=>{c.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'partial'}})+'\n');controller.abort()}),stop:async c=>{stopped++;c.signalCode='SIGKILL';c.emit('close',null)}}),/取消/);assert.equal(stopped,1);
});
test('CLI nonzero exit and tool events fail without exposing raw errors or persisting partial output',async()=>{
 for(const tool of [false,true])await assert.rejects(executeDistillation({home:'test-home',prompt:'text',resolve:async()=>({command:'fixture',args:[]}),spawnProcess:fixture(c=>{c.stderr.write('SECRET-RAW-ERROR');if(tool)c.stdout.write(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'private'}})+'\n');else {c.exitCode=1;c.emit('close',1)}}),stop:async c=>{c.signalCode='SIGKILL';c.emit('close',null)}}),e=>!e.message.includes('SECRET')&&(tool?/非文本/.test(e.message):/完整结果/.test(e.message)));
});
test('CLI timeout is bounded even when a failed process never emits close',async()=>{
 let stopped=0;
 await assert.rejects(executeDistillation({home:'test-home',prompt:'text',timeoutMs:10,resolve:async()=>({command:'fixture',args:[]}),spawnProcess:fixture(()=>{}),stop:async c=>{stopped++;c.signalCode='SIGKILL';}}),/超时/);assert.equal(stopped,1);
});
