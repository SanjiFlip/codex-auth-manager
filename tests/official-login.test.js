const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {createLogin,loginUrl}=require('../src/official-login');
test('only expected official OAuth URL is surfaced',()=>{
  assert.equal(loginUrl('https://evil.example/oauth/authorize'),null);
  assert.equal(loginUrl('https://auth.openai.com.evil.example/oauth/authorize'),null);
  assert.equal(loginUrl('https://auth.openai.com/other'),null);
  assert.equal(loginUrl('Open https://auth.openai.com/oauth/authorize?state=example'),'https://auth.openai.com/oauth/authorize?state=example');
});
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-login-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const child=new EventEmitter();child.pid=98765;child.stdout=new PassThrough();child.stderr=new PassThrough();
  let options,saves=0;const states=[];
  const login=createLogin({root,resolve:async()=>({command:'fake-codex',args:[]}),spawnProcess:(cmd,args,opts)=>{options=opts;return child},stopProcess:async()=>child.emit('close',1),save:async()=>{saves++},report:s=>states.push(s)});
  return {root,child,login,states,get options(){return options},get saves(){return saves}};
}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}throw Error('timed out')}
test('successful isolated login saves once and cleans temporary credentials',async t=>{
  const f=await fixture(t);await f.login.start('test');await until(()=>f.options);
  assert.ok(f.options.env.CODEX_HOME.startsWith(f.root));assert.notEqual(f.options.env.CODEX_HOME,process.env.CODEX_HOME);
  await fs.writeFile(path.join(f.options.env.CODEX_HOME,'auth.json'),'fake-credentials');
  f.child.emit('close',0);await until(()=>!f.login.busy());
  assert.equal(f.saves,1);assert.equal(f.login.state().phase,'complete');assert.deepEqual(await fs.readdir(f.root),[]);
});
test('cancelled login never commits even if auth file was written',async t=>{
  const f=await fixture(t);await f.login.start('test');await until(()=>f.options);
  await fs.writeFile(path.join(f.options.env.CODEX_HOME,'auth.json'),'fake-credentials');
  await f.login.cancel();assert.equal(f.saves,0);assert.equal(f.login.state().phase,'cancelled');assert.deepEqual(await fs.readdir(f.root),[]);
});
test('parallel login rejected and arbitrary CLI error output is not surfaced',async t=>{
  const f=await fixture(t);await f.login.start('test');await until(()=>f.options);
  await assert.rejects(f.login.start('second'),/已有登录/);
  f.child.stderr.write('secret-token-for-test');f.child.emit('close',1);await until(()=>!f.login.busy());
  assert.equal(f.saves,0);assert.ok(!JSON.stringify(f.states).includes('secret-token-for-test'));
});
