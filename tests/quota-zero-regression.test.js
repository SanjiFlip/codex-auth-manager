const {test}=require('node:test');
const assert=require('node:assert/strict');
const {displaySnapshot}=require('../src/quota/display-snapshot');
const {normalizeBucket,combineBuckets}=require('../src/quota/local-records');
const reset=1790410329;
const bucket=(used,seconds=reset,at='2026-09-21T12:00:00Z')=>normalizeBucket({limit_id:'codex',primary:{used_percent:used,window_minutes:10080,resets_at:seconds}},at);
test('fresh local zero cannot overwrite measured usage in the same weekly period',()=>{
  const official={source:'official-app-server',checkedAt:'2026-09-21T11:00:00Z',weekly:{usedPercent:41,resetsAt:new Date(reset*1000).toISOString()}};
  assert.equal(displaySnapshot(official,bucket(0)).weekly.usedPercent,41);
  assert.equal(displaySnapshot(official,bucket(46)).weekly.usedPercent,46);
  assert.equal(displaySnapshot(official,bucket(0,reset+604800,new Date(reset*1000+1000).toISOString())).weekly.usedPercent,0);
  assert.equal(displaySnapshot({...official,checkedAt:'2026-09-21T13:00:00Z',weekly:{...official.weekly,usedPercent:0}},bucket(46)).weekly.usedPercent,0);
});
test('local records retain a measured window across zero and partial events in either file order',()=>{
  const previous=bucket(46,reset,'2026-09-21T11:00:00Z');
  for(const next of [bucket(0),bucket(null),bucket(0,null)]) {
    for(const entries of [[previous,next],[next,previous]]) {
      const result=combineBuckets(entries);
      assert.equal(result.weekly.usedPercent,46);
      assert.equal(result.weekly.checkedAt,previous.checkedAt);
    }
  }
  assert.equal(combineBuckets([previous,bucket(0,reset+604800,new Date(reset*1000+1000).toISOString())]).weekly.usedPercent,0);
  assert.equal(combineBuckets([bucket(0)]).weekly.usedPercent,0);
});
