const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runSwitch}=require('../src/switch-lifecycle');
function fixture(fail) {
  const calls=[];
  const adapter={};
  for(const name of ['preflight','stop','capture','apply','launch','rollback'])adapter[name]=async()=>{calls.push(name);if(name===fail)throw Error('injected failure');return {saved:true}};
  return {calls,adapter};
}
test('exit is confirmed before capturing rotated tokens and writing target',async()=>{
  const {calls,adapter}=fixture();
  const result=await runSwitch(adapter);
  assert.deepEqual(calls,['preflight','stop','capture','apply','launch']);
  assert.equal(result.identityVerified,false);
});
test('invalid target never closes app or writes credentials',async()=>{
  const {calls,adapter}=fixture('preflight');await assert.rejects(runSwitch(adapter));assert.deepEqual(calls,['preflight']);
});
test('exit timeout never captures or writes credentials',async()=>{
  const {calls,adapter}=fixture('stop');await assert.rejects(runSwitch(adapter));assert.deepEqual(calls,['preflight','stop']);
});
test('failed backup stops before credential write',async()=>{
  const {calls,adapter}=fixture('capture');await assert.rejects(runSwitch(adapter),/原凭据未替换/);assert.deepEqual(calls,['preflight','stop','capture']);
});
for(const failed of ['apply','launch'])test(`${failed} failure stops potentially started app and restores original`,async()=>{
  const {calls,adapter}=fixture(failed);await assert.rejects(runSwitch(adapter),/已恢复原凭据/);assert.deepEqual(calls.slice(-2),['stop','rollback']);
});
test('failed rollback must not claim restoration',async()=>{
  const {adapter}=fixture('launch');adapter.rollback=async()=>{throw Error('disk failed')};await assert.rejects(runSwitch(adapter),/自动恢复也未完成/);
});
