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
async function fixture(t, extra={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-login-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const child=new EventEmitter();child.pid=98765;child.stdout=new PassThrough();child.stderr=new PassThrough();
  let options,saves=0;const states=[];
  const login=createLogin({root,resolve:async()=>({command:'fake-codex',args:[]}),spawnProcess:(cmd,args,opts)=>{options=opts;return child},stopProcess:async()=>child.emit('close',1),save:async()=>{saves++},report:s=>states.push(s),...extra});
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

test('opens the complete official URL once across split and repeated CLI output',async t=>{
  const opened=[];const f=await fixture(t,{openBrowser:async url=>opened.push(url)});
  t.after(()=>f.login.cancel());await f.login.start('test');await until(()=>f.options);
  f.child.stderr.write('Open https://auth.openai.com/oauth/authorize?state=');
  await new Promise(r=>setTimeout(r,10));assert.equal(opened.length,0);
  f.child.stderr.write('synthetic&client_id=test\n');
  await until(()=>opened.length===1);
  f.child.stderr.write('Open https://auth.openai.com/oauth/authorize?state=synthetic&client_id=test\n');
  await new Promise(r=>setTimeout(r,10));assert.deepEqual(opened,['https://auth.openai.com/oauth/authorize?state=synthetic&client_id=test']);
});

test('browser failure preserves login URL for explicit retry and never publishes raw errors',async t=>{
  let calls=0;const f=await fixture(t,{openBrowser:async()=>{if(++calls===1)throw Error('private system data')}});
  t.after(()=>f.login.cancel());await f.login.start('test');await until(()=>f.options);
  f.child.stdout.write('https://auth.openai.com/oauth/authorize?state=test\n');
  await until(()=>f.login.state().browserError);
  assert.equal(f.login.state().phase,'waiting');assert.ok(f.login.state().url);
  assert.ok(!JSON.stringify(f.states).includes('private system data'));
  await f.login.open();assert.equal(calls,2);assert.equal(f.login.state().browserError,null);
  await f.login.cancel();await assert.rejects(f.login.open(),/登录链接/);
});

test('reserved OAuth callback port falls back to device login and exposes its one-time code',async t=>{
  const attempts=[],opened=[];
  const f=await fixture(t,{spawnProcess:(cmd,args,options)=>{
    const child=new EventEmitter();child.pid=98765;child.stdout=new PassThrough();child.stderr=new PassThrough();
    attempts.push({args,options,child});return child;
  },stopProcess:async child=>child.emit('close',1),openBrowser:async url=>opened.push(url)});
  t.after(()=>f.login.cancel());await f.login.start('device test');await until(()=>attempts.length===1);
  attempts[0].child.stderr.write('Error logging in: socket permission denied (os error 10013)\n');attempts[0].child.emit('close',1);
  await until(()=>attempts.length===2);
  assert.ok(attempts[1].args.includes('--device-auth'));
  assert.equal(attempts[0].options.env.CODEX_HOME,attempts[1].options.env.CODEX_HOME);
  attempts[1].child.stdout.write('https://auth.openai.com/codex/device\n\u001b[94mABCD-12345\u001b[0m\n');
  await until(()=>f.login.state().deviceCode==='ABCD-12345');
  assert.deepEqual(opened,['https://auth.openai.com/codex/device']);
  assert.equal(f.login.state().method,'device');
  await f.login.cancel();assert.equal(f.saves,0);
});
