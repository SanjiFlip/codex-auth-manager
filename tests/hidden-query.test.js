const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {queryOfficialAccount}=require('../src/official-account');
test('a broken app-server input pipe rejects without an unhandled stream error',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){done(Error('synthetic broken pipe'));setImmediate(()=>child.emit('close',1));}});
  await assert.rejects(queryOfficialAccount('synthetic-home',{resolve:async()=>({command:'fixture',args:[]}),spawnProcess:()=>child}),/通信|退出/);
});
test('an input pipe failure still cleans up the native app-server process',async()=>{
  const child=new EventEmitter();child.pid=12345;child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){done(Error('synthetic broken pipe'));}});
  let stopped=false;
  await assert.rejects(queryOfficialAccount('synthetic-home',{resolve:async()=>({command:'fixture',args:[]}),spawnProcess:()=>child,stop:async c=>{assert.equal(c,child);stopped=true;child.emit('close',1)}}),/通信|退出/);
  assert.equal(stopped,true);
});
test('quota query directly spawns a hidden native process with piped stdio and no login request',async()=>{
  const methods=[];let options,command,args;
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,done){const m=JSON.parse(chunk);methods.push(m.method);if(m.id!==undefined){const result=m.method==='account/read'?{account:{type:'chatgpt',planType:'pro'}}:m.method==='account/rateLimits/read'?{rateLimits:{primary:{usedPercent:25,windowDurationMins:10080}}}:{};queueMicrotask(()=>{child.stdout.write(JSON.stringify({id:m.id,result})+'\n');if(m.method==='account/rateLimits/read')setImmediate(()=>child.emit('close',0))})}done()}});
  const result=await queryOfficialAccount('synthetic-home',{resolve:async()=>({command:'native-codex.exe',args:[]}),spawnProcess:(c,a,o)=>{command=c;args=a;options=o;return child}});
  assert.equal(command,'native-codex.exe');assert.equal(args[0],'app-server');assert.equal(options.windowsHide,true);assert.equal(options.shell,false);
  assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.ok(!methods.some(m=>m.includes('login')));assert.equal(result.quota.weekly.usedPercent,25);
});
