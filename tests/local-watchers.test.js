const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');

test('failed local log and session watchers are handled and rebuilt by the existing polling loop',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  const start=source.indexOf('async function startLocalLogWatcher()');
  const end=source.indexOf('\nasync function switchAccount(',start);
  const watchers=[],polls=[];let refreshes=0;
  const context={localLogWatcher:null,sessionsWatcher:null,sessionsPollingInterval:null,
    fs:{mkdir:async()=>{},stat:async()=>({mtimeMs:0})},
    fsSync:{watch:()=>{const watcher=new EventEmitter();watcher.close=()=>{watcher.closed=true};watchers.push(watcher);return watcher}},
    codexDir:()=>'/synthetic',sessionsDir:()=>'/synthetic/sessions',logsDbPath:()=>'/synthetic/logs',logsDbWalPath:()=>'/synthetic/wal',
    scheduleLocalLogRefresh:()=>{refreshes++},shouldRefreshForLocalLog:()=>true,
    localDataCache:{getSessionFiles:async()=>[]},walkSessionFiles:()=>{},
    SESSION_POLL_RECENT_WINDOW_MS:1000,SESSION_POLL_RECENT_FILE_LIMIT:10,lastKnownLocalQuotaMtimeMs:0,
    setInterval:callback=>{polls.push(callback);return {unref(){}}},
  };
  vm.runInNewContext(source.slice(start,end),context);
  await context.startLocalLogWatcher();await context.startSessionsWatcher();await context.startSessionsPolling();
  for(const watcher of [...watchers]){
    assert.doesNotThrow(()=>watcher.emit('error',Error('synthetic watch failure')));
    assert.equal(watcher.closed,true);
  }
  assert.equal(refreshes,2);
  await polls[0]();
  assert.equal(watchers.length,4,'Both watchers recover on the next poll');
  assert.equal(polls.length,1,'The existing polling loop is reused');
});
