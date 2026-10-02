const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,remaining,compact,sevenDayRange,tokenValue}=require('../src/ui/statistics');
test('missing statistics stay unknown; loaded empty calendar days are zero',()=>{
  assert.equal(summarize(null).todayTokens,null);
  const data=summarize({daily:[]},new Date(2026,8,12));
  assert.equal(data.daily.length,7);
  assert.equal(data.daily[0].day,'2026-09-06');
  assert.equal(data.todayTokens,0);
});
test('seven-day total excludes old days and does not add cached tokens twice',()=>{
  const data=summarize({daily:[{day:'2026-09-01',tokenUsage:{totalTokens:999}},{day:'2026-09-11',tokenUsage:{totalTokens:20}},{day:'2026-09-12',tokenUsage:{totalTokens:100,cachedInputTokens:80},sessions:3}]},new Date(2026,8,12));
  assert.equal(data.weekTokens,120);assert.equal(data.todaySessions,3);assert.equal(data.todayTokens,100);
});
test('unavailable quota is not confused with zero remaining',()=>{
  assert.equal(remaining(null),null);assert.equal(remaining({usedPercent:100}),0);
  assert.equal(remaining({usedPercent:110}),0);assert.equal(compact(null),'—');
});
test('seven-day window starts at local midnight and ends at the observation time',()=>{
  const now=new Date(2026,9,2,12,34,56),range=sevenDayRange(now);
  assert.equal(range.since,new Date(2026,8,26).toISOString());
  assert.equal(range.until,now.toISOString());
  assert.equal(now.getHours(),12,'does not mutate caller time');
});
test('unrecorded values render unknown while measured zero stays zero',()=>{
  assert.equal(tokenValue({tokenUsage:{inputTokens:0},tokenAvailability:{inputTokens:false}},'inputTokens'),null);
  assert.equal(tokenValue({tokenUsage:{inputTokens:0},tokenAvailability:{inputTokens:true}},'inputTokens'),0);
  const now=new Date(2026,9,2),data=summarize({daily:[{day:'2026-10-02',tokenUsage:{totalTokens:0},tokenAvailability:{totalTokens:false}}]},now);
  assert.equal(data.todayTokens,null);assert.equal(data.weekTokens,null);assert.equal(compact(data.weekTokens),'—');
});
test('snapshot date keeps display and export calendar stable across midnight',()=>{
  const usage={until:new Date(2026,9,2,23,59).toISOString(),daily:[{day:'2026-10-02',tokenUsage:{totalTokens:100}}]};
  const data=summarize(usage,new Date(2026,9,3,0,1));
  assert.equal(data.daily[6].day,'2026-10-02');assert.equal(data.todayTokens,100);
});
