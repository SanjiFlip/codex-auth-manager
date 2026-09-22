const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),TOML=require('@iarna/toml');
const {createSkillMatcher,enabledFor}=require('../src/skills/config');
const {createSkillsManager}=require('../src/skills/manager');

test('a scan resolves each distinct path rule once and preserves ordered overrides',async()=>{
  const original=fs.realpath;let reads=0;
  fs.realpath=async value=>{reads++;return value;};
  try{
    const rules=Array.from({length:100},(_,i)=>({path:path.resolve('synthetic','skill-'+i,'SKILL.md'),enabled:i%2===0}));
    const matcher=await createSkillMatcher(rules);
    for(let i=0;i<100;i++)assert.equal(matcher({name:'skill-'+i,file:rules[i].path}),i%2===0);
    assert.equal(reads,100,'100 skills and 100 rules should resolve 100 paths, not 10,000');
    reads=0;const item={name:'skill-0',file:rules[0].path};
    const ordered=await createSkillMatcher([{name:item.name,enabled:false},{path:item.file,enabled:true},{path:item.file,enabled:false}]);
    assert.equal(ordered(item),false);assert.equal(reads,1,'duplicate selectors share one resolution');
    assert.equal(await enabledFor(item,[{path:item.file,enabled:false},{name:item.name,enabled:true}]),true,'existing enabledFor API retains last matching rule behavior');
  }finally{fs.realpath=original;}
});

test('missing selectors and platform case handling retain enabledFor semantics',async()=>{
  const file=path.join(os.tmpdir(),'cam-nonexistent-skill-'+process.pid,'SKILL.md'),item={name:'missing',file};
  const match=await createSkillMatcher([{path:file,enabled:false}]);assert.equal(match(item),false);
  const upper=await createSkillMatcher([{path:file.toUpperCase(),enabled:false}]);assert.equal(upper(item),process.platform!=='win32');
  assert.equal((await createSkillMatcher([{path:42,enabled:false}]))(item),true);
});

test('manager refresh resolves a retargeted selector again instead of retaining a stale path',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-skills-rules-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const home=path.join(root,'codex'),skills=path.join(home,'skills'),selector=path.join(root,'selector');
  for(const name of ['one','two']){await fs.mkdir(path.join(skills,name),{recursive:true});await fs.writeFile(path.join(skills,name,'SKILL.md'),`---\nname: ${name}\ndescription: synthetic fixture\n---\n`);}
  const linkType=process.platform==='win32'?'junction':'dir';await fs.symlink(path.join(skills,'one'),selector,linkType);
  await fs.writeFile(path.join(home,'config.toml'),TOML.stringify({skills:{config:[{path:path.join(selector,'SKILL.md'),enabled:false}]}}));
  const manager=createSkillsManager({root:path.join(root,'store'),home,userHome:path.join(root,'user')});
  let state=await manager.list();assert.equal(state.items.find(i=>i.name==='one').enabled,false);assert.equal(state.items.find(i=>i.name==='two').enabled,true);
  await fs.unlink(selector);await fs.symlink(path.join(skills,'two'),selector,linkType);
  state=await manager.list();assert.equal(state.items.find(i=>i.name==='one').enabled,true);assert.equal(state.items.find(i=>i.name==='two').enabled,false);
});
