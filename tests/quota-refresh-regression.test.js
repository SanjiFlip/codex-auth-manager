const {test}=require('node:test');
const assert=require('node:assert/strict');
const {displaySnapshot}=require('../src/quota/display-snapshot');
const {normalizeBucket,combineBuckets}=require('../src/quota/local-records');
const {remaining}=require('../src/ui/statistics');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
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

test('model-only local records and cached snapshots never become the account allowance',()=>{
  const model=local(12,reset,'codex-model');
  assert.equal(displaySnapshot(null,model),null);
  assert.equal(displaySnapshot(model,null),null);
  const combined=combineBuckets([model]);
  assert.equal(combined.limitId,'codex');
  assert.equal(combined.weekly,null);
  assert.equal(combined.additional[0].weekly.usedPercent,12);
  assert.equal(displaySnapshot(null,combined).weekly,null);
  assert.equal(displaySnapshot(null,{...model,additional:[local(48)]}).weekly.usedPercent,48);
});

test('combining model-only placeholders with real account buckets preserves account metadata in either order',()=>{
  const model=combineBuckets([local(12,reset,'codex-model')]);
  const account={...local(41,reset,'codex',before),planType:'pro',credits:{balance:'5'},resetCredits:{availableCount:2,checkedAt:before}};
  for(const buckets of [[model,account],[account,model]]){
    const combined=combineBuckets(buckets);
    assert.equal(combined.planType,'pro');
    assert.deepEqual(combined.credits,account.credits);
    assert.deepEqual(combined.resetCredits,account.resetCredits);
    assert.equal(combined.checkedAt,before);
    assert.equal(combined.weekly.usedPercent,41);
    assert.equal(combined.additional[0].limitId,'codex-model');
  }
});

test('invalid local quota values remain unknown and invalid cached dates cannot break rendering',()=>{
  for(const value of [false,true,[],{},' ',1e100,-1]) {
    const bucket=local(value,value);
    assert.equal(bucket.weekly.usedPercent,null,JSON.stringify(value));
    assert.equal(bucket.weekly.resetsAt,null,JSON.stringify(value));
  }
  for(const resetsAt of [1e100,Infinity,NaN,-1]) {
    const snapshot={source:'local',checkedAt:after,weekly:{usedPercent:12,resetsAt}};
    assert.equal(displaySnapshot(null,snapshot).weekly.resetsAt,null);
  }
  assert.equal(local('0').weekly.usedPercent,0);
});

test('model-specific reset credits stay attached to their model instead of entering account reset history',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cam-quota-buckets-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'record.jsonl');
  const rates={codex:{rate_limit_reset_credits:{available_count:2}},'codex-model':{rate_limit_reset_credits:{available_count:9}}};
  fs.writeFileSync(file,JSON.stringify({type:'event_msg',timestamp:after,payload:{type:'token_count',rate_limits_by_limit_id:rates}}));
  const {parseRecordFile,quotaFromRecords,normalizeResetCredits}=require('../src/quota/local-records');
  const record=await parseRecordFile({path:file});
  assert.deepEqual(record.resets.map(reset=>reset.availableCount),[2]);
  const quota=quotaFromRecords([record],before);
  assert.equal(quota.resetCredits.availableCount,2);
  assert.equal(quota.additional[0].resetCredits.availableCount,9);
  assert.equal(normalizeResetCredits({available_count:false},after),null);
});

test('persisting a new account snapshot cannot inherit windows or reset credits from an old model snapshot',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  const start=source.indexOf('function buildAccountQuotaSnapshot(');
  const end=source.indexOf('\nfunction windowLearningSample',start);
  const context={selectWindow:require('../src/quota/select-window').selectWindow,newestResetCredits:(...resets)=>resets.filter(Boolean).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]??null};
  vm.runInNewContext(source.slice(start,end),context);
  const previous={...local(41,reset,'codex-model',before),schemaVersion:2,resetCredits:{availableCount:9,checkedAt:before}};
  const current=combineBuckets([local(12,reset,'codex-model')]);
  const saved=context.buildAccountQuotaSnapshot(current,previous);
  assert.equal(saved.weekly,null);
  assert.equal(saved.resetCredits,null);
  const same=context.buildAccountQuotaSnapshot(local(0),{...local(41,reset,'codex',before),schemaVersion:2});
  assert.equal(same.weekly.usedPercent,41,'Same-bucket zero protection remains intact');
});

test('old model caches are filtered before resolving or persisting account quota and reset credits',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  let stored;
  const context={QUOTA_MODE_ONLINE:'online',rateWindowHasDisplayData:window=>!!window,
    normalizeResetCredits:require('../src/quota/local-records').normalizeResetCredits,
    selectWindow:require('../src/quota/select-window').selectWindow,
    estimateLocalQuota:require('../src/quota/local-estimate').estimateLocalQuota,
    readBestLocalQuota:async()=>combineBuckets([local(12,reset,'codex-model')]),
    readLocalRecords:async()=>[],readLocalResetCredits:async()=>null,
    saveAccountQuotaSnapshot:async(id,quota)=>{stored=context.buildAccountQuotaSnapshot(quota)},
  };
  for(const [first,next] of [
    ['function localStoredQuotaSnapshot(','async function dashboardScope('],
    ['function resolveQuota(','async function readBestLocalQuota('],
    ['async function resolveQuotaWithMode(','async function getQuota('],
    ['function newestResetCredits(','async function saveAccountResetCredits('],
    ['function buildAccountQuotaSnapshot(','function windowLearningSample('],
  ]){const start=source.indexOf(first);vm.runInNewContext(source.slice(start,source.indexOf(next,start)),context)}
  const old={...local(41,reset,'codex-model',before),schemaVersion:2,resetCredits:{availableCount:9,checkedAt:before}};
  const cached=context.localStoredQuotaSnapshot(old);
  assert.equal(cached,null,'Model-only caches are unavailable as account snapshots');
  const scope={hasCurrentAuth:true,accountId:'synthetic',since:before,accountQuotaSnapshot:cached};
  const quota=await context.resolveQuotaWithMode(scope,[]);
  assert.equal(quota.weekly,null);
  assert.equal(quota.resetCredits,null);
  assert.equal(stored.weekly,null);
  assert.equal(displaySnapshot(null,stored).weekly,null);
  assert.equal(context.resolveQuota(scope,null).source,'unavailable');
  const mixed=context.localStoredQuotaSnapshot({...old,additional:[local(48)]});
  assert.equal(mixed.limitId,'codex');
  assert.equal(mixed.weekly.usedPercent,48);
  assert.equal(mixed.resetCredits,null);
});
