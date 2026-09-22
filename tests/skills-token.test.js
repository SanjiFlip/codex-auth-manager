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
test('invalid token gives an actionable error',async t=>{
  const root=await temporary(t),secret=crypto.randomBytes(24).toString('hex');let calls=0;
  const market=createMarketplace({root,getToken:async()=>secret,fetcher:async()=>{calls++;return new Response('{}',{status:401})}});
  await assert.rejects(market.catalog({repo:'sample/skills'}),error=>error.message.includes('Token 无效')&&!error.message.includes(secret));assert.equal(calls,1);
});

test('nested private skills browse and install through authenticated blobs without persistent catalog or cross-token access',async t=>{
  const root=await temporary(t),fixture=createRepositoryFixture(),secret=crypto.randomBytes(24).toString('hex');let token=secret;
  const requests=[];
  const fetcher=async(url,options)=>{
    requests.push(url);assert.equal(options.headers.Authorization,'Bearer '+secret);
    assert.ok(url.startsWith('https://api.github.com/'),'private reads must stay on API');
    if(url==='https://api.github.com/repos/sample/private')return new Response('{"private":true}');
    if(url.includes('/git/blobs/')){const sha=url.split('/').at(-1),text=Object.values(fixture.files).find(text=>crypto.createHash('sha1').update(Buffer.from(`blob ${Buffer.byteLength(text)}\0`)).update(text).digest('hex')===sha);return new Response(JSON.stringify({encoding:'base64',content:Buffer.from(text).toString('base64')}));}
    return fixture.fetcher(url);
  };
  const market=createMarketplace({root,fetcher,getToken:async()=>token});
  const cat=await market.catalog({repo:'sample/private'});assert.equal(cat.items.length,2);assert.equal(cat.private,true);
  const p=await market.preview({repo:'sample/private',id:cat.items[0].id});
  assert.match(p.body,/daily-notes/);await market.install(p.token,path.join(root,'bank'));
  assert.ok(!(await fs.readdir(root)).some(name=>name.startsWith('catalog-')));
  const again=await market.preview({repo:'sample/private',id:cat.items[1].id});token=null;
  await assert.rejects(market.install(again.token,path.join(root,'bank')),/Token.*变化/);
  await assert.rejects(market.catalog({repo:'sample/private'}));
});

test('revoked private access never returns cached metadata or falls back to public hosts',async t=>{
  const root=await temporary(t),fixture=createRepositoryFixture();let revoked=false;
  const market=createMarketplace({root,getToken:async()=>'synthetic',fetcher:async url=>{
    assert.ok(url.startsWith('https://api.github.com/'));
    if(revoked)return new Response('{}',{status:403});
    if(url==='https://api.github.com/repos/sample/private')return new Response('{"private":true}');return fixture.fetcher(url);
  }});
  await market.catalog({repo:'sample/private'});revoked=true;
  await assert.rejects(market.catalog({repo:'sample/private',force:true}),/403/);
});
