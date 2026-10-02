const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');

function fixture({initialFailure=false}={}) {
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  const start=source.indexOf('async function startAuthWatcher()');
  const end=source.indexOf('\nfunction shouldRefreshForLocalLog',start);
  const watchers=[],polls=[];
  let syncs=0,attempts=0;
  const context={authWatcher:null,authSyncInterval:null,
    fs:{mkdir:async()=>{}},codexDir:()=>'/synthetic-codex-home',
    fsSync:{watch:()=>{
      attempts++;
      if(initialFailure&&attempts===1)throw Error('synthetic unavailable directory');
      const watcher=new EventEmitter();watcher.closed=false;watcher.close=()=>{watcher.closed=true};watchers.push(watcher);return watcher;
    }},
    scheduleAuthSync:()=>{syncs++},shouldSyncAuthFile:()=>true,
    setInterval:callback=>{polls.push(callback);return {unref(){}}},
  };
  vm.runInNewContext(source.slice(start,end),context);
  return {context,watchers,polls,get syncs(){return syncs}};
}

test('an asynchronous auth watcher failure is handled and observation resumes on the next poll',async()=>{
  const f=fixture();await f.context.startAuthWatcher();
  const first=f.watchers[0];
  assert.doesNotThrow(()=>first.emit('error',Error('synthetic directory replacement')));
  assert.equal(first.closed,true);
  const previous=f.syncs;
  await f.polls[0]();
  assert.ok(f.syncs>previous,'Polling still synchronizes current credentials');
  assert.equal(f.watchers.length,2,'The failed native watcher is recreated');
  assert.equal(f.polls.length,1,'Recovery does not add duplicate polling loops');
});

test('auth polling is available when the native watcher cannot initially be created',async()=>{
  const f=fixture({initialFailure:true});await f.context.startAuthWatcher();
  assert.equal(f.polls.length,1);
  await f.polls[0]();
  assert.ok(f.syncs>0);
  assert.equal(f.watchers.length,1);
});
