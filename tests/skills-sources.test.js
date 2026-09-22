const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createSkillsManager}=require('../src/skills/manager');
const {createRepositoryFixture}=require('../scripts/fixtures/skills-repository');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-sources-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const repo=createRepositoryFixture();const options={root:path.join(root,'store'),home:path.join(root,'codex'),userHome:path.join(root,'user'),fetcher:repo.fetcher};return {options,repo,manager:createSkillsManager(options)};}
test('custom sources persist names and case-sensitive refs, edit in place, reject duplicates and protect built-ins',async t=>{
  const {manager,options,repo}=await fixture(t);let state=await manager.list();assert.equal(state.sources.length,3);
  state=await manager.saveSource({name:'科研',repo:'https://github.com/Sample/Skills.git',ref:'topic/research',revision:state.revision});const source=state.sources.at(-1);
  assert.equal(source.repo,'sample/skills');assert.equal(source.ref,'topic/research');assert.equal(source.custom,true);assert.equal(repo.requests.length,0,'saving sources does not require network');
  assert.deepEqual((await createSkillsManager(options).list()).sources.at(-1),source);
  await assert.rejects(manager.saveSource({name:'重复',repo:'SAMPLE/SKILLS',ref:source.ref,revision:state.revision}),/已在/);
  await assert.rejects(manager.saveSource({name:'内置',repo:'OPENAI/skills',ref:'HEAD',revision:state.revision}),/已在/);
  await assert.rejects(manager.saveSource({name:'过期',repo:'other/repo',revision:0}),/已变化/);
  await assert.rejects(manager.saveSource({id:'builtin:openai/skills',name:'覆盖',repo:'other/repo',revision:state.revision}),/不能修改/);
  await assert.rejects(manager.removeSource({id:'builtin:openai/skills',revision:state.revision}),/不能移除/);
  state=await manager.saveSource({id:source.id,name:'日常',repo:'sample/skills',ref:'v2',revision:state.revision});assert.equal(state.sources.at(-1).id,source.id);assert.equal(state.sources.at(-1).ref,'v2');
  for(const input of [{name:'',repo:'sample/skills'},{name:'Bad',repo:'https://evil.invalid/repo'},{name:'Bad',repo:'sample/skills',ref:'main?token=private'}])await assert.rejects(manager.saveSource({...input,revision:state.revision}));
});
test('older libraries gain custom sources without resetting groups; removing a source preserves installed skills and memberships',async t=>{
  const {options,manager}=await fixture(t);let state=await manager.list();
  state=await manager.saveGroup({id:'daily',name:'旧版日常分组',skillIds:[],revision:state.revision});
  const file=path.join(options.root,'library.json'),old=JSON.parse(await fs.readFile(file,'utf8'));delete old.customSources;await fs.writeFile(file,JSON.stringify(old));
  const migrated=createSkillsManager(options);state=await migrated.saveSource({name:'我的技能',repo:'sample/skills',revision:state.revision});assert.equal(state.groups.find(g=>g.id==='daily').name,'旧版日常分组');
  const source=state.sources.at(-1),cat=await migrated.catalog(source),preview=await migrated.preview({...source,id:cat.items[0].id});
  state=await migrated.install({token:preview.token,groupIds:['daily'],revision:state.revision});const installed=state.items[0];
  state=await migrated.removeSource({id:source.id,revision:state.revision});assert.equal(state.sources.length,3);assert.equal(state.items.length,1);assert.equal(state.items[0].id,installed.id);assert.deepEqual(state.groups.find(g=>g.id==='daily').skillIds,[installed.id]);assert.match(await fs.readFile(installed.file,'utf8'),/daily-notes/);
});
