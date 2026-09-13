const {test}=require('node:test'),assert=require('node:assert/strict');
const {displaySnapshot}=require('../src/quota/display-snapshot');
const {createOfficialRefresh}=require('../src/official-refresh');
test('new local quota replaces older official windows using observation timestamps',()=>{
  const official={source:'official-app-server',checkedAt:'2026-09-13T00:00:00Z',weekly:{usedPercent:10,resetsAt:'2026-09-20T00:00:00Z'},session:{usedPercent:5},resetCredits:2};
  const local={source:'local',checkedAt:'2026-09-13T00:01:00Z',weekly:{usedPercent:25,resetsAt:1789862400,checkedAt:'2026-09-13T00:01:00Z'}};
  const result=displaySnapshot(official,local);
  assert.equal(result.weekly.usedPercent,25);assert.equal(result.session.usedPercent,5);assert.equal(result.resetCredits,2);
  assert.equal(result.source,'local');assert.equal(result.weekly.resetsAt,new Date(1789862400000).toISOString());
  assert.equal(displaySnapshot(official,{...local,weekly:{...local.weekly,checkedAt:'2026-09-12T00:00:00Z'}}).weekly.usedPercent,10);
  assert.equal(displaySnapshot(null,null),null);
});
test('both windows share one explicit official request, and a later request queries again',async()=>{
  let count=0,release;
  const gate=createOfficialRefresh({refresh:async()=>{count++;await new Promise(r=>release=r);return count}});
  const a=gate.request('a'),b=gate.request('a');
  await Promise.resolve();assert.equal(count,1);release();assert.deepEqual(await Promise.all([a,b]),[1,1]);
  const c=gate.request('a');await Promise.resolve();release();await c;assert.equal(count,2);
});
test('failed explicit calls release the request gate for manual retry',async()=>{
  let count=0;const gate=createOfficialRefresh({refresh:async()=>{count++;throw Error('offline')}});
  await assert.rejects(gate.request('a'),/offline/);
  await assert.rejects(gate.request('a'),/offline/);assert.equal(count,2);
});
