const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createTokenStore}=require('../src/skills/token-store');
const {createMarketplace}=require('../src/skills/github');
const {createRepositoryFixture}=require('../scripts/fixtures/skills-repository');
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-token-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('token stays encrypted at rest, survives recreation, can be replaced/removed and fails closed',async t=>{
  const root=await temporary(t),secret=crypto.randomBytes(24).toString('hex'),key=crypto.randomBytes(32);
  const encrypt=text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]).toString('base64')};
  const decrypt=text=>{const b=Buffer.from(text,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString()};
  const store=createTokenStore({root,encrypt,decrypt});assert.equal((await store.status()).configured,false);
  assert.deepEqual(await store.save(secret),{configured:true});assert.ok(!(await fs.readFile(path.join(root,'github-token.enc'),'utf8')).includes(secret));
  assert.equal(await createTokenStore({root,encrypt,decrypt}).read(),secret);
  await assert.rejects(store.save('bad\nvalue'),/有效/);assert.equal(await store.read(),secret);
  await assert.rejects(createTokenStore({root}).save(secret),/系统加密/);assert.equal(await store.read(),secret);
  await store.save(secret+'a');assert.equal(await store.read(),secret+'a');
  await fs.writeFile(path.join(root,'github-token.enc'),'corrupt');await assert.rejects(store.read(),/无法解密/);
  assert.deepEqual(await store.remove(),{configured:false});assert.equal(await store.read(),null);
});
test('authenticated API refresh bypasses anonymous cooldown; token never reaches raw downloads or disk cache',async t=>{
  const root=await temporary(t),fixture=createRepositoryFixture(),secret=crypto.randomBytes(24).toString('hex');let token=null;const requests=[];
  await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'api-cooldown.json'),JSON.stringify({until:Date.now()+600000}));
  const fetcher=async(url,options)=>{requests.push({url,options});if(url==='https://api.github.com/repos/sample/skills')return new Response('{"private":false}');return fixture.fetcher(url)};
  const market=createMarketplace({root,fetcher,getToken:async()=>token});token=secret;
  const catalog=await market.catalog({repo:'sample/skills',force:true});assert.equal(catalog.transport,'api');
  const preview=await market.preview({repo:'sample/skills',id:catalog.items[0].id});await market.install(preview.token,path.join(root,'bank'));
  assert.ok(requests.some(r=>r.url.startsWith('https://raw.')));
  for(const r of requests){assert.equal(r.options.redirect,'error');assert.equal(r.options.headers.Authorization,r.url.startsWith('https://api.github.com/')?'Bearer '+secret:undefined);}
  for(const name of await fs.readdir(root))if(name.endsWith('.json'))assert.ok(!(await fs.readFile(path.join(root,name),'utf8')).includes(secret));
  token=null;const stale=await market.catalog({repo:'sample/skills',force:true});assert.equal(stale.stale,true);assert.match(stale.warning,/限流/);
});
test('invalid token gives an actionable error, and authenticated private repositories are rejected',async t=>{
  const root=await temporary(t),secret=crypto.randomBytes(24).toString('hex');let calls=0;
  const market=createMarketplace({root,getToken:async()=>secret,fetcher:async()=>{calls++;return new Response('{}',{status:401})}});
  await assert.rejects(market.catalog({repo:'sample/skills'}),error=>error.message.includes('Token 无效')&&!error.message.includes(secret));assert.equal(calls,1);
  const privateMarket=createMarketplace({root,getToken:async()=>secret,fetcher:async()=>new Response('{"private":true}')});
  await assert.rejects(privateMarket.catalog({repo:'sample/private'}),/仅支持公开/);
});
