const {test}=require('node:test');
const assert=require('node:assert/strict');
const {summarize,remaining,compact}=require('../src/ui/statistics');
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
