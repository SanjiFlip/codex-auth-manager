const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createTranslator}=require('../src/skills/translation');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(){
  const requests=[],jobs=[],cancelled=[],messages=[],status={textContent:''},stop={hidden:true};
  const targets=['Market alpha','Market beta'].map(text=>{const result={innerHTML:''},button={};return {dataset:{tText:text},result,querySelector:selector=>selector==='.s-t-result'?result:button};});
  const translator=createTranslator({interval:0,fetcher:(_url,{signal})=>new Promise((resolve,reject)=>{requests.push({signal,finish:()=>resolve(new Response(JSON.stringify({code:200,data:[{translations:[{text:'中文译文'}]}]})))});signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
  const api={skillsTranslate:input=>{const promise=translator.translate(input);jobs.push(promise);return promise;},skillsCancelTranslation:input=>{cancelled.push(input.id);return Promise.resolve(translator.cancel(input));}};
  const document={querySelectorAll:selector=>selector==='.s-t-status'?[status]:selector==='.s-t-stop'?[stop]:selector==='.s-translation-target'?targets:[],createElement:()=>{const result={hidden:true},pre={},attribution={};return {isConnected:true,querySelector:selector=>selector==='.s-t-detail-result'?result:selector==='.s-t-detail-result pre'?pre:selector==='.s-t-attribution'?attribution:null};}};
  const context={window:{},document,crypto,localStorage:{getItem:()=>JSON.stringify({enabled:true,providers:['suapi']})}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui/skill-translation.js'),'utf8'),context);
  const ui=context.window.createSkillTranslation({api,demo:false,toast:value=>messages.push(value),esc:String,onChange:()=>{}});
  function detail(text){let tools,close;const dialog={querySelector:()=>({after:value=>tools=value}),addEventListener:(_name,fn)=>close=fn};ui.attachDetail(dialog,text);return {start:()=>tools.onclick({target:{closest:selector=>selector==='[data-t-detail]'?{}:null}}),close:()=>{tools.isConnected=false;close();}};}
  const batch=()=>ui.handle({target:{closest:()=>({dataset:{tAction:'batch'}})}},{querySelectorAll:()=>targets});
  return {requests,jobs,cancelled,messages,status,targets,detail,batch};
}

test('a delayed close event from an untranslated detail cannot cancel a newer list translation',async()=>{
  const f=fixture(),oldDetail=f.detail('Old detail body');
  f.batch();await tick();assert.equal(f.requests.length,1);
  oldDetail.close();
  assert.equal(f.requests[0].signal.aborted,false,'a detail without an owned job must not cancel market translation');
  f.requests[0].finish();await f.jobs[0];await tick();assert.equal(f.requests.length,2);
  f.requests[1].finish();await f.jobs[1];await tick();
  assert.equal(f.cancelled.length,0);assert.ok(f.targets.every(target=>target.result.innerHTML.includes('中文译文')));assert.match(f.status.textContent,/已翻译 2 项/);
});

test('closing an older detail leaves the current detail running; closing its owner cancels it',async()=>{
  const f=fixture(),oldDetail=f.detail('First detail body');oldDetail.start();await tick();f.requests[0].finish();await f.jobs[0];await tick();
  const current=f.detail('Second detail body');current.start();await tick();assert.equal(f.requests.length,2);
  oldDetail.close();assert.equal(f.requests[1].signal.aborted,false,'completed detail must not own the new request');
  current.close();await assert.rejects(f.jobs[1],/翻译已取消/);await tick();
  assert.equal(f.cancelled.length,1);assert.equal(f.status.textContent,'已停止');assert.equal(f.messages.length,0);
});
