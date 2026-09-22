const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createMarketplace}=require('../src/skills/github');
const {createRepositoryFixture}=require('../scripts/fixtures/skills-repository');
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-large-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('large nested catalogs return all skills and scientific repository alias avoids old redirect',async t=>{
  const root=await temp(t),fixture=createRepositoryFixture();
  fixture.setExtra(Array.from({length:700},(_,i)=>({path:`skills/category/skill-${i}/SKILL.md`,mode:'100644',type:'blob',size:100,sha:'b'.repeat(40)})));
  const market=createMarketplace({root,fetcher:async url=>{assert.ok(!url.includes('/claude-scientific-skills/'),'renamed repository should use canonical URL');return fixture.fetcher(url)}});
  const cat=await market.catalog({repo:'K-Dense-AI/claude-scientific-skills'});assert.equal(cat.items.length,702);assert.equal(cat.total,702);assert.equal(cat.limited,false);
});
test('scientific catalog under API rate limit reads Git trees instead of downloading the whole archive',async t=>{
  const root=await temp(t),fixture=createRepositoryFixture();let trees=0;
  const market=createMarketplace({root,fetcher:async url=>{assert.ok(url.startsWith('https://api.github.com/'),'must not download large archive');return new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0'}})},readGitTree:async options=>{
    trees++;assert.equal(options.repo,'K-Dense-AI/scientific-agent-skills');const response=await fixture.fetcher('/git/trees/fixture');return {commit:fixture.commit,files:(await response.json()).tree};
  }});
  const cat=await market.catalog({repo:'K-Dense-AI/claude-scientific-skills'});assert.equal(cat.items.length,2);assert.equal(cat.transport,'git');assert.equal(trees,1);
});
test('truncated recursive directory walks subtrees and preserves complete nested paths',async t=>{
  const root=await temp(t),fixture=createRepositoryFixture(),calls=[];
  const market=createMarketplace({root,fetcher:async url=>{
    calls.push(url);if(url.includes('/commits/'))return fixture.fetcher(url);
    if(url.endsWith(fixture.commit+'?recursive=1'))return new Response('{"truncated":true,"tree":[]}');
    if(url.endsWith('/'+fixture.commit))return new Response(JSON.stringify({tree:[{path:'nested',type:'tree',sha:'b'.repeat(40)}]}));
    if(url.endsWith('b'.repeat(40)+'?recursive=1'))return fixture.fetcher('/git/trees/fixture');
    throw Error('Unexpected request');
  }});
  const cat=await market.catalog({repo:'sample/many'});assert.equal(cat.items.length,2);assert.equal(cat.items[0].folder,'nested/skills/daily-notes');assert.equal(calls.length,4);
});
test('Git fallback is hidden, isolated from credentials, metadata-only and cleans its temporary directory',async()=>{
  const {gitTree}=require('../src/skills/git-tree'),calls=[];let temporary;
  const result=await gitTree({repo:'sample/public',ref:'HEAD',execute:async(command,args,options)=>{
    calls.push(args);temporary=options.cwd;assert.equal(command,'git');assert.equal(options.windowsHide,true);assert.equal(options.shell,false);assert.equal(options.env.GIT_TERMINAL_PROMPT,'0');assert.equal(options.env.GIT_CONFIG_NOSYSTEM,'1');assert.ok(args.includes('credential.helper='));
    if(args.includes('rev-parse'))return {stdout:'a'.repeat(40)+'\n'};
    if(args.includes('ls-tree'))return {stdout:'100644 blob '+'b'.repeat(40)+'\tskills/test/SKILL.md\0'};
    return {stdout:''};
  }});
  assert.equal(result.files[0].path,'skills/test/SKILL.md');assert.ok(calls.some(args=>args.includes('--filter=blob:none')));assert.ok(!calls.some(args=>args.includes('checkout')));await assert.rejects(fs.stat(temporary),{code:'ENOENT'});
});
test('oversize custom public archive switches to metadata-only fallback before consuming its body',async t=>{
  const root=await temp(t),fixture=createRepositoryFixture();let cancelled=false;
  const packet=text=>(Buffer.byteLength(text)+4).toString(16).padStart(4,'0')+text;
  const market=createMarketplace({root,fetcher:async url=>{
    if(url.startsWith('https://api.'))return new Response('{}',{status:429});
    if(url.includes('/info/refs'))return new Response(packet(fixture.commit+' HEAD\n')+'0000');
    return {ok:true,headers:new Headers({'content-length':String(100*1024*1024)}),body:{cancel:async()=>{cancelled=true}}};
  },readGitTree:async()=>({commit:fixture.commit,files:(await (await fixture.fetcher('/git/trees/fixture')).json()).tree})});
  const cat=await market.catalog({repo:'sample/large'});assert.equal(cat.transport,'git');assert.equal(cat.items.length,2);assert.equal(cancelled,true);
});
