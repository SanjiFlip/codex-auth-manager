const {test}=require('node:test');
const assert=require('node:assert/strict');
const {usageCsv}=require('../src/usage-export');

test('CSV exports seven local days and aggregates without private metadata or double counting',()=>{
  const csv=usageCsv({email:'PRIVATE_EMAIL',path:'PRIVATE_PATH',messages:['PRIVATE_PROMPT'],daily:[
    {day:'2026-09-01',tokenUsage:{totalTokens:999}},
    {day:'2026-09-22',sessions:2,tokenUsage:{inputTokens:80,cachedInputTokens:60,outputTokens:20,reasoningOutputTokens:10,totalTokens:100}}
  ],models:[{model:'模型 A',tokenUsage:{totalTokens:100}}],sessionsAnalyzed:2,tokenUsage:{totalTokens:100}},new Date(2026,8,22));
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('2026-09-16'));assert.ok(!csv.includes('2026-09-15'));
  assert.ok(csv.includes('"本机每日","2026-09-22","","2","80","60","20","10","100"'));
  assert.ok(csv.includes('"本机近7天总计","","","2","","","","","100"'));
  assert.ok(csv.includes('"本机每日","2026-09-16","","0","0","0","0","0","0"'));
  assert.ok(!csv.includes('PRIVATE'));assert.ok(!csv.includes('999'));
});
test('CSV neutralizes spreadsheet formulas and escapes quotes and line breaks',()=>{
  const csv=usageCsv({models:[{model:' =HYPERLINK("https://example.invalid")',tokenUsage:{totalTokens:1}},{model:'\t@SUM(1)',tokenUsage:{}},{model:'a,"b"\nc',tokenUsage:{totalTokens:NaN}}]},new Date(2026,8,22));
  assert.ok(csv.includes('"\' =HYPERLINK(""https://example.invalid"")"'));
  assert.ok(csv.includes('"\'\t@SUM(1)"'));assert.ok(csv.includes('"a,""b""\nc"'));
  assert.ok(!csv.includes('NaN'));assert.throws(()=>usageCsv(null),/尚无/);
});
