const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createSessionLibrary}=require('../src/knowledge/sessions');
const {writeKnowledgeIndex}=require('../scripts/fixtures/knowledge-index');
const {DatabaseSync}=require('node:sqlite');
async function fixture(t){const home=await fs.mkdtemp(path.join(os.tmpdir(),'cam-session-discovery-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'sessions'));return home;}
const message=text=>JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}})+'\n';
test('large local chat is listed without opening it in Codex, with bounded recent-body access',async t=>{
  const home=await fixture(t),file=path.join(home,'sessions','large.jsonl');await fs.writeFile(file,message('old message'));await fs.truncate(file,34*1024*1024);await fs.appendFile(file,'\n'+message('recent complete message'));
  writeKnowledgeIndex(home,[{id:'large',file}]);const library=createSessionLibrary(home),list=await library.list();assert.equal(list.items.length,1,'large chats must not disappear from the list');
  const result=await library.transcript(list.items[0].id);assert.equal(result.messages.at(-1).text,'recent complete message');assert.equal(result.windowed,true);assert.ok(result.readBytes<=8*1024*1024);
});
test('stale rollout path resolves by active thread ID without resuming the desktop conversation',async t=>{
  const home=await fixture(t),id='11111111-2222-3333-4444-555555555555',file=path.join(home,'sessions','rollout-2026-09-22-'+id+'.jsonl');await fs.writeFile(file,message('local content'));
  writeKnowledgeIndex(home,[{id,file:path.join(home,'old-location','missing.jsonl')}]);const library=createSessionLibrary(home),list=await library.list();assert.equal(list.items.length,1);assert.equal((await library.transcript(list.items[0].id)).messages[0].text,'local content');
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('UPDATE threads SET archived=1');db.close();await assert.rejects(library.transcript(list.items[0].id),{code:'SESSION_UNAVAILABLE'});
});
test('missing body remains visible and becomes readable after appearing, without an app restart',async t=>{
  const home=await fixture(t),file=path.join(home,'sessions','pending.jsonl');writeKnowledgeIndex(home,[{id:'pending',file}]);const library=createSessionLibrary(home),list=await library.list();assert.equal(list.items.length,1);assert.equal(list.items[0].readStatus,'not-local');await assert.rejects(library.transcript(list.items[0].id),{code:'SESSION_NOT_LOCAL'});
  await fs.writeFile(file,message('now present'));assert.equal((await library.transcript(list.items[0].id)).messages[0].text,'now present');
});
test('list includes more than 300 eligible chats and uses indexed conversation activity time',async t=>{
  const home=await fixture(t),rows=[];for(let i=0;i<305;i++){const file=path.join(home,'sessions','chat-'+i+'.jsonl');await fs.writeFile(file,message('fixture'));await fs.utimes(file,new Date('2020-01-01'),new Date('2020-01-01'));rows.push({id:'s'+i,file,updatedAt:Date.now()});}
  writeKnowledgeIndex(home,rows);const list=await createSessionLibrary(home).list();assert.equal(list.items.length,305);assert.equal(list.limited,false);assert.ok(list.items.every(i=>Date.parse(i.updatedAt)>Date.now()-86400000));
});
