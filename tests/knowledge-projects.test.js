const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {writeKnowledgeIndex}=require('../scripts/fixtures/knowledge-index');
const {createSessionLibrary}=require('../src/knowledge/sessions');
const {activeSessions,normalized}=require('../src/knowledge/projects');
async function fixture(t){const home=await fs.mkdtemp(path.join(os.tmpdir(),'cam-project-scope-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'sessions'));return home;}
function edit(home,sql){const db=new DatabaseSync(path.join(home,'state_5.sqlite'));try{db.exec(sql)}finally{db.close()}}
test('only enabled-project nonarchived Codex threads are eligible; renderer receives project names',async t=>{
  const home=await fixture(t),file=path.join(home,'sessions','active.jsonl');
  await fs.writeFile(file,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'allowed'}]}}));
  writeKnowledgeIndex(home,[{id:'active',file,title:'当前任务'},{id:'archived',file,archived:true},{id:'agent',file,source:'{"subagent":{}}'},{id:'foreign',file,source:'chatgpt'},{id:'removed-project',file,projectId:'removed'},{id:'unassigned-outside',file,projectId:null,cwd:'/sample/unlisted'}],{name:'真正的项目名称'});
  const scope=await activeSessions(home);assert.deepEqual(scope.items.map(x=>x.sessionId),['active']);
  const lib=createSessionLibrary(home),list=await lib.list();assert.equal(list.items[0].project,'真正的项目名称');assert.equal(list.items[0].title,'当前任务');assert.ok(!JSON.stringify(list).includes('/sample/project'));assert.ok(!JSON.stringify(list).includes(home));
  const id=list.items[0].id;assert.equal((await lib.transcript(id)).messages[0].text,'allowed');
  edit(home,"UPDATE threads SET archived=1 WHERE id='active'");await assert.rejects(lib.transcript(id),{code:'SESSION_UNAVAILABLE'});assert.equal((await lib.list()).items.length,0);
  edit(home,"UPDATE threads SET archived=0 WHERE id='active'; UPDATE projects SET metadata='{\"enabled\":false}'");await assert.rejects(lib.transcript(id),{code:'SESSION_UNAVAILABLE'});assert.equal((await activeSessions(home)).items.length,0);
});
test('older project settings retain display names and exclude disabled or archived projects',async t=>{
  const home=await fixture(t);writeKnowledgeIndex(home,[{id:'active',file:path.join(home,'sessions','a.jsonl'),projectId:null}]);
  edit(home,'DROP TABLE projects; DROP TABLE project_roots');
  await fs.writeFile(path.join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{p:{name:'我的项目',rootPaths:['/sample/project']},off:{name:'关闭项目',rootPaths:['/sample/other'],enabled:false}}}));
  assert.equal((await activeSessions(home)).items[0].project,'我的项目');
  await fs.writeFile(path.join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{p:{name:'我的项目',rootPaths:['/sample/project'],archived:true}}}));assert.equal((await activeSessions(home)).items.length,0);
});
test('missing archive index fails closed; path comparison handles Windows and UNC roots',async t=>{
  const home=await fixture(t);await assert.rejects(activeSessions(home),/未找到 Codex 项目索引/);
  assert.equal(normalized('C:\\Work\\Project\\..\\Other'),'c:/work/other');
  assert.equal(normalized('\\\\?\\C:\\Work\\Project'),'c:/work/project');
  assert.equal(normalized('\\\\?\\UNC\\server\\share\\project'),normalized('\\\\server\\share\\project'));
  assert.notEqual(normalized('/work/Project'),normalized('/work/project'));
});

test('Windows extended rollout paths do not misclassify active chats as archived', {skip:process.platform!=='win32'}, async t=>{
  const home=await fixture(t),file=path.join(home,'sessions','extended.jsonl');
  await fs.writeFile(file,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'active fixture'}]}}));
  writeKnowledgeIndex(home,[{id:'extended',file:path.toNamespacedPath(file)}]);
  const lib=createSessionLibrary(home),list=await lib.list();assert.equal(list.items.length,1);
  assert.equal((await lib.transcript(list.items[0].id)).messages[0].text,'active fixture');
});
