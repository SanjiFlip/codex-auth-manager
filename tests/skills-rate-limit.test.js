const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createMarketplace}=require('../src/skills/github');
const {createRepositoryFixture}=require('../scripts/fixtures/skills-repository');
async function archive(){return fs.readFile(path.join(__dirname,'../scripts/fixtures/skills-repository.zip'));}
const packet=text=>(Buffer.byteLength(text)+4).toString(16).padStart(4,'0')+text;
test('rate-limited first load uses public Git archive, coalesces callers, persists cooldown and installs pinned content',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-rate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const fixture=createRepositoryFixture(),zip=await archive(fixture.files,fixture.commit);let api=0,archives=0;
  const fetcher=async url=>{if(url.startsWith('https://api.github.com/')){api++;return new Response('{"message":"API rate limit exceeded"}',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.floor(Date.now()/1000)+600)}})}if(url.includes('/info/refs'))return new Response(packet(fixture.commit+' HEAD\0symref=HEAD:refs/heads/main\n')+'0000');if(url.startsWith('https://codeload.github.com/')){archives++;return new Response(zip)}return fixture.fetcher(url)};
  const market=createMarketplace({root,fetcher});const catalogs=await Promise.all(Array.from({length:4},()=>market.catalog({repo:'sample/skills'})));
  assert.equal(catalogs[0].items.length,2);assert.equal(catalogs[0].transport,'archive');assert.equal(catalogs[0].commit,fixture.commit);assert.equal(api,1);assert.equal(archives,1);
  const preview=await market.preview({repo:'sample/skills',id:catalogs[0].items[0].id});const installed=await market.install(preview.token,path.join(root,'bank'));assert.match(await fs.readFile(path.join(installed.folder,'SKILL.md'),'utf8'),/daily-notes/);
  const restarted=createMarketplace({root,fetcher});await restarted.catalog({repo:'sample/skills',force:true});assert.equal(api,1,'restart and force refresh respect rate cooldown');
});
test('cached catalog remains usable when both API and archive hosts fail',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-rate-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const fixture=createRepositoryFixture(),market=createMarketplace({root,fetcher:fixture.fetcher});await market.catalog({repo:'sample/skills'});fixture.setFailure(true);const cat=await market.catalog({repo:'sample/skills',force:true});assert.equal(cat.stale,true);assert.equal(cat.items.length,2);
});

test('archive fallback resolves annotated tags and rejects a different commit snapshot',async()=>{
  const {resolveRef,zipTree}=require('../src/skills/archive'),commit='a'.repeat(40),peeled='b'.repeat(40);
  assert.equal(resolveRef(Buffer.from(packet(commit+' refs/tags/v1\n')+packet(peeled+' refs/tags/v1^{}\n')+'0000'),'v1'),peeled);
  assert.throws(()=>resolveRef(Buffer.from('zzzz'),'HEAD'),/无效/);
  await assert.rejects(zipTree(await archive(),peeled),/不一致/);
});
