const {test}=require('node:test');const assert=require('node:assert/strict');
const {planLabel}=require('../src/ui/plans');
const {normalizeOfficialAccount}=require('../src/official-account');

test('model-specific limits never become the main account allowance',()=>{
  const account={account:{type:'chatgpt',planType:'pro'}};
  const model={limitId:'premium',primary:{usedPercent:80,windowDurationMins:10080}};
  const result=normalizeOfficialAccount(account,{rateLimits:model,rateLimitsByLimitId:{premium:model}});
  assert.equal(result.quota.limitId,'codex');assert.equal(result.quota.weekly,null);
  assert.equal(result.quota.additional[0].limitId,'premium');assert.equal(result.quota.additional[0].weekly.usedPercent,80);
  const main={primary:{usedPercent:20,windowDurationMins:10080}};
  const combined=normalizeOfficialAccount(account,{rateLimits:model,rateLimitsByLimitId:{codex:main,premium:model}});
  assert.equal(combined.quota.weekly.usedPercent,20);assert.equal(combined.quota.additional[0].weekly.usedPercent,80);
});

test('invalid usage and reset values stay unknown without throwing',()=>{
  const result=normalizeOfficialAccount({account:{type:'chatgpt'}},{rateLimits:{primary:{usedPercent:NaN,windowDurationMins:300,resetsAt:Infinity}},rateLimitResetCredits:{availableCount:-1}});
  assert.equal(result.quota.session.usedPercent,null);assert.equal(result.quota.session.resetsAt,null);assert.equal(result.quota.resetCredits,null);
});
test('Pro tiers use distinct protocol identifiers, not percentages',()=>{
  assert.equal(planLabel('pro'),'Pro');assert.equal(planLabel('prolite'),'Pro Lite');assert.equal(planLabel('promax'),'Pro Max');
  assert.equal(planLabel('self_serve_business_prolite'),'Business Pro Lite');
  assert.equal(planLabel(null),'套餐未知');assert.equal(planLabel('new-tier'),'套餐待识别');
  for(const plan of ['ent26','enterprise_cbp_automation','enterprise_cbp_usage_based','edu_plus','edu_pro'])assert.notEqual(planLabel(plan),'套餐待识别');
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
  assert.equal(showFiveHour('promax',{}),false);assert.equal(showFiveHour('promax',{proFiveHourEnabled:true}),true);
  assert.equal(showFiveHour('plus',{}),true);assert.equal(showFiveHour(null,{}),true);
  assert.equal(showFiveHour('pro',{proFiveHourEnabled:true}),true);
  assert.equal(showFiveHour('prolite',{proFiveHourEnabled:true}),true);
  assert.equal(showFiveHour('pro',{proFiveHourEnabled:'false'}),false);
});
