const {test}=require('node:test');const assert=require('node:assert/strict');
const {planLabel}=require('../src/ui/plans');
const {normalizeOfficialAccount}=require('../src/official-account');
test('Pro tiers use distinct protocol identifiers, not percentages',()=>{
  assert.equal(planLabel('pro'),'Pro 20x');assert.equal(planLabel('prolite'),'Pro 5x');
  assert.equal(planLabel('self_serve_business_prolite'),'Business Pro Lite');
  assert.equal(planLabel(null),'套餐未知');assert.equal(planLabel('new-tier'),'套餐待识别');
});
test('official response preserves prolite and matches windows by duration',()=>{
  const result=normalizeOfficialAccount({account:{type:'chatgpt',planType:'prolite',email:'fake@example.invalid'}},{rateLimits:{primary:{usedPercent:25,windowDurationMins:10080},secondary:{usedPercent:10,windowDurationMins:300}}});
  assert.equal(result.planType,'prolite');assert.equal(result.quota.session.usedPercent,10);assert.equal(result.quota.weekly.usedPercent,25);
});
test('missing usage windows stay unknown and API key account is rejected',()=>{
  const result=normalizeOfficialAccount({account:{type:'chatgpt',planType:'pro'}},{rateLimits:{}});
  assert.equal(result.quota.session,null);assert.equal(result.quota.weekly,null);
  assert.throws(()=>normalizeOfficialAccount({account:{type:'apiKey'}},{}));
});

test('Pro five-hour display defaults off for both tiers; other plans stay visible',()=>{
  const {showFiveHour}=require('../src/ui/plans');
  assert.equal(showFiveHour('pro',{}),false);assert.equal(showFiveHour('prolite',{}),false);
  assert.equal(showFiveHour('plus',{}),true);assert.equal(showFiveHour(null,{}),true);
  assert.equal(showFiveHour('pro',{proFiveHourEnabled:true}),true);
  assert.equal(showFiveHour('prolite',{proFiveHourEnabled:true}),true);
  assert.equal(showFiveHour('pro',{proFiveHourEnabled:'false'}),false);
});
