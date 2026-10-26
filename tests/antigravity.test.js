const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {createAntigravity}=require('../src/antigravity');
function fixture(){let child,input='',file;return {spawnProcess(target,args,options){file=target;assert.deepEqual(args,[]);assert.equal(options.windowsHide,true);child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.stdin.on('data',c=>input+=c);return child},progress(value){child.stdout.write(JSON.stringify(value)+'\n')},finish(value){child.stdout.write(JSON.stringify(value)+'\n');child.emit('close',0)},get input(){return JSON.parse(input)},get file(){return file}}}
test('unsupported platforms do not launch native credentials component',async()=>{const execute=createAntigravity({platform:'darwin',spawnProcess(){throw Error('must not launch')}});assert.equal((await execute({action:'state'})).supported,false)});
test('bridge serializes input as data and blocks concurrent operations',async()=>{const f=fixture(),execute=createAntigravity({platform:'win32',spawnProcess:f.spawnProcess});const pending=execute({action:'rename',id:'test',name:'中文 $()`"',unexpected:'discard'});assert.equal(f.input.name,'中文 $()`"');assert.equal(f.input.unexpected,undefined);assert.match(f.file,/AntigravityBridge\.exe$/);await assert.rejects(execute({action:'state'}),/正在执行/);f.finish({ok:true,data:{accounts:[]}});assert.deepEqual(await pending,{accounts:[]});const next=execute({action:'state'});f.finish({ok:false,error:'请退出应用'});await assert.rejects(next,/请退出应用/)});
test('bridge rejects unknown actions and unsafe parameter types before spawning',async()=>{const execute=createAntigravity({platform:'win32',spawnProcess(){throw Error('must not launch')}});await assert.rejects(execute({action:'shell'}),/无效/);await assert.rejects(execute({action:'save',name:{}}),/无效/)});

test('bridge streams switch progress and forwards only explicit force confirmation',async()=>{
  const f=fixture(),events=[],execute=createAntigravity({platform:'win32',spawnProcess:f.spawnProcess,report:event=>events.push(event)});
  const pending=execute({action:'switch',id:'test',forceClose:true});
  assert.equal(f.input.forceClose,true);
  f.progress({event:'progress',phase:'closing',message:'正在退出'});
  f.finish({ok:true,data:{pending:false}});
  assert.deepEqual(await pending,{pending:false});
  assert.equal(events.find(e=>e.phase==='closing')?.message,'正在退出');
});

test('bridge rejects unsuccessful exit even when stdout claims success',async()=>{
  let child;
  const execute=createAntigravity({platform:'win32',spawnProcess(){child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();return child}});
  const pending=execute({action:'state'});
  child.stdout.end('{"ok":true,"data":{}}');child.emit('close',1);
  await assert.rejects(pending,/未返回有效结果/);
});

test('bridge rejects malformed force option before launching',async()=>{
  const execute=createAntigravity({platform:'win32',spawnProcess(){throw Error('must not launch')}});
  await assert.rejects(execute({action:'switch',forceClose:'true'}),/无效/);
});

test('bridge stops a timed out component and releases busy only after exit',async()=>{
  let child,killed=false;
  const execute=createAntigravity({platform:'win32',timeoutMs:5,spawnProcess(){
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=()=>{killed=true;setTimeout(()=>child.emit('close',null),5)};return child;
  }});
  const pending=execute({action:'switch',id:'test'});
  const rejected=assert.rejects(pending,/超时/);
  await new Promise(resolve=>setTimeout(resolve,7));assert.equal(killed,true);
  await assert.rejects(execute({action:'state'}),/正在执行/);
  await rejected;
});
