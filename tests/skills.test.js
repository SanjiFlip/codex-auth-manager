const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),TOML=require('@iarna/toml');
const {metadata,safeRelative,inventory}=require('../src/skills/files');
const {createMarketplace,repository}=require('../src/skills/github');
const {createSkillsManager}=require('../src/skills/manager');
const {patchEntries,enabledFor,readConfig}=require('../src/skills/config');
const {createRepositoryFixture}=require('../scripts/fixtures/skills-repository');
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cam-skills-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return dir;}
test('skill metadata supports real YAML and rejects aliases, unsafe install paths and malformed sources',()=>{
  assert.equal(metadata('---\nname: test\ndescription: >-\n  multiline\n  description\n---\nbody').description,'multiline description');
  assert.throws(()=>metadata('no header'));assert.throws(()=>metadata('---\nname: &a test\ndescription: *a\n---\n'));
  for(const value of ['../auth.json','a/../b','C:/file','/etc/passwd','a\\b','NUL.txt','foo:bar','a/CON','a./file'])assert.throws(()=>safeRelative(value));
  assert.equal(repository('https://github.com/example/skills.git'),'example/skills');assert.throws(()=>repository('https://evil.invalid/skills'));
});
test('GitHub catalog caches and shows offline state; verified installation preserves package files and license',async t=>{
  const root=await temp(t),fixture=createRepositoryFixture(),market=createMarketplace({root:path.join(root,'cache'),fetcher:fixture.fetcher});
  const catalog=await market.catalog({repo:'sample/skills'});assert.equal(catalog.items.length,2);assert.ok(!catalog.files);assert.equal(fixture.requests.length,2);
  await market.catalog({repo:'sample/skills'});assert.equal(fixture.requests.length,2);
  const preview=await market.preview({repo:'sample/skills',id:catalog.items[0].id});assert.match(preview.license,/MIT/);assert.equal(preview.fileCount,2);
  const installed=await market.install(preview.token,path.join(root,'bank'));assert.equal(metadata(await fs.readFile(path.join(installed.folder,'SKILL.md'),'utf8')).name,'daily-notes');assert.equal(await fs.readFile(path.join(installed.folder,'references/example.md'),'utf8'),'Synthetic skill reference.');assert.match(await fs.readFile(path.join(installed.folder,'.cam-repository-license.txt'),'utf8'),/MIT/);
  const again=await market.preview({repo:'sample/skills',id:catalog.items[0].id});await assert.rejects(market.install(again.token,path.join(root,'bank')),/已存在/);
  fixture.setFailure(true);const offline=await market.catalog({repo:'sample/skills',force:true});assert.equal(offline.stale,true);assert.equal(offline.items.length,2);
});
test('installation rejects symlinks and changed blobs without leaving partial skills',async t=>{
  const root=await temp(t),fixture=createRepositoryFixture(),market=createMarketplace({root,fetcher:fixture.fetcher});
  let cat=await market.catalog({repo:'sample/skills'});let p=await market.preview({repo:'sample/skills',id:cat.items[0].id});fixture.setCorrupt(true);const bank=path.join(root,'bank');await assert.rejects(market.install(p.token,bank),/不一致/);assert.deepEqual(await fs.readdir(bank),[]);
  fixture.setCorrupt(false);fixture.setExtra([{path:'skills/daily-notes/escape',type:'blob',mode:'120000',size:5,sha:'b'.repeat(40)}]);cat=await market.catalog({repo:'sample/skills',force:true});await assert.rejects(market.preview({repo:'sample/skills',id:cat.items[0].id}),/符号链接/);
});
test('inventory deduplicates existing hub junctions and leaves system skills alone',async t=>{
  const root=await temp(t),bank=path.join(root,'bank'),consumer=path.join(root,'skills');await fs.mkdir(path.join(bank,'sample'),{recursive:true});await fs.mkdir(consumer);
  await fs.writeFile(path.join(bank,'sample','SKILL.md'),'---\nname: sample\ndescription: test\n---\n');await fs.mkdir(path.join(consumer,'.system'));await fs.writeFile(path.join(consumer,'.system','SKILL.md'),'---\nname: system\ndescription: protected\n---\n');
  await fs.symlink(path.join(bank,'sample'),path.join(consumer,'sample'),process.platform==='win32'?'junction':'dir');const scan=await inventory([bank,consumer]);assert.equal(scan.items.length,1);assert.equal(scan.items[0].aliases.length,2);
  assert.equal(await enabledFor(scan.items[0],[{name:'sample',enabled:false},{path:scan.items[0].file,enabled:true}]),true);
  const patched=await patchEntries([{path:path.join(consumer,'sample','SKILL.md'),enabled:false},{name:'other',enabled:false}],[{path:scan.items[0].file,enabled:true}]);assert.equal(patched.length,2);assert.equal(patched[0].name,'other');
});
test('groups install disabled, switch union, preserve unrelated skills, detect stale edits and survive reload',async t=>{
  const root=await temp(t),home=path.join(root,'codex'),userHome=path.join(root,'user'),bank=path.join(userHome,'.skillshub');await fs.mkdir(home,{recursive:true});await fs.writeFile(path.join(home,'config.toml'),'model = "keep-me"\n');
  const fixture=createRepositoryFixture(),writes=[];const writer=async(h,changes)=>{writes.push(changes);const config=await readConfig(h);config.skills={config:await patchEntries(config.skills?.config||[],changes)};await fs.writeFile(path.join(h,'config.toml'),TOML.stringify(config));};
  const options={root:path.join(root,'store'),home,userHome,bank,fetcher:fixture.fetcher,writeConfig:writer};const manager=createSkillsManager(options);let state=await manager.list();
  const cat=await manager.catalog({repo:'sample/skills'});
  for(const [index,g] of ['daily','research'].entries()){const p=await manager.preview({repo:'sample/skills',id:cat.items[index].id});state=await manager.install({token:p.token,groupIds:[g],revision:state.revision});}
  assert.ok(state.items.every(i=>!i.enabled&&!i.linked));assert.equal(writes.length,0,'install alone must not enable skills');
  let plan=await manager.plan({groupIds:['daily'],revision:state.revision});assert.equal(plan.enable.length,1);state=await manager.apply({token:plan.token});assert.equal(state.items.filter(i=>i.enabled).length,1);
  plan=await manager.plan({groupIds:['research'],revision:state.revision});assert.equal(plan.disable.length,1);assert.equal(plan.enable.length,1);state=await manager.apply({token:plan.token});assert.ok(state.items.find(i=>i.name==='research-review').enabled);assert.ok(!state.items.find(i=>i.name==='daily-notes').enabled);
  assert.equal((await readConfig(home)).model,'keep-me');assert.equal((await createSkillsManager(options).list()).activeGroupIds[0],'research');
  await assert.rejects(manager.saveGroup({name:'stale',skillIds:[],revision:0}),/已变化/);await assert.rejects(manager.removeGroup({id:'research',revision:state.revision}),/先切换/);
  plan=await manager.plan({groupIds:['daily','research'],revision:state.revision});state=await manager.apply({token:plan.token});assert.equal(state.items.filter(i=>i.enabled).length,2);
  const failing=createSkillsManager({...options,writeConfig:async()=>{throw Error('version conflict')}});plan=await failing.plan({groupIds:[],revision:state.revision});await assert.rejects(failing.apply({token:plan.token}),/version conflict/);assert.deepEqual((await failing.list()).activeGroupIds,['daily','research']);
});
