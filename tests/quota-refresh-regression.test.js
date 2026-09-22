const {test}=require('node:test');
const assert=require('node:assert/strict');
const {displaySnapshot}=require('../src/quota/display-snapshot');
const {normalizeBucket,combineBuckets}=require('../src/quota/local-records');
const {remaining}=require('../src/ui/statistics');
const before='2026-09-22T10:00:00Z', after='2026-09-22T10:00:01Z';
const reset=Date.parse('2026-09-27T10:00:00Z')/1000;
const local=(used,resetsAt=reset,id='codex',at=after)=>normalizeBucket({limit_id:id,primary:{used_percent:used,window_minutes:10080,resets_at:resetsAt}},at);
const official=(resetsAt=reset)=>({source:'official-app-server',checkedAt:before,weekly:{usedPercent:41,resetsAt:resetsAt?new Date(resetsAt*1000).toISOString():null}});

test('manual refresh followed by local polls cannot jump to 100% on shifted or missing reset times',()=>{
  for(const oldReset of [reset,null])for(const newReset of [reset,reset+1,reset+604800,null]){
    const queried=official(oldReset);
    for(let poll=0;poll<3;poll++){
      const result=displaySnapshot(queried,local(0,newReset,'codex',new Date(Date.parse(after)+poll*1000).toISOString()));
      assert.equal(remaining(result.weekly),59,`old reset ${oldReset}, incoming reset ${newReset}`);
      assert.equal(Date.parse(result.checkedAt),Date.parse(before),'rejected observation must not advance displayed freshness');
    }
  }
});

test('local file aggregation preserves nonzero usage until a reset is observed after expiry',()=>{
  const previous=local(41,reset,'codex',before);
  for(const next of [local(0,reset+1),local(0,reset+604800)])for(const entries of [[previous,next],[next,previous]])
    assert.equal(combineBuckets(entries).weekly.usedPercent,41);
  const resetObserved=local(0,reset+604800,'codex',new Date(reset*1000+1000).toISOString());
  assert.equal(combineBuckets([previous,resetObserved]).weekly.usedPercent,0);
  assert.equal(remaining(displaySnapshot(official(),resetObserved).weekly),100);
});

test('a model-specific local bucket cannot replace the refreshed Codex account quota',()=>{
  const result=displaySnapshot(official(),local(0,reset+604800,'codex-other-model'));
  assert.equal(remaining(result.weekly),59);
  assert.equal(Date.parse(result.checkedAt),Date.parse(before));
  const withMain={...local(0,reset+604800,'codex-other-model'),additional:[local(48)]};
  assert.equal(remaining(displaySnapshot(official(),withMain).weekly),52);
});
