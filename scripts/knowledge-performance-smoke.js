// Synthetic knowledge UI only: no preload, accounts, conversation files, network or model calls.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-knowledge-ui-performance-'));
app.setPath('userData',path.join(temp,'electron'));
let win;
const evaluate=source=>win.webContents.executeJavaScript(source);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(source,label){for(let i=0;i<200;i++){if(await evaluate(source))return;await delay(20);}throw Error('Timeout: '+label);}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const timeout=setTimeout(()=>{console.error('KNOWLEDGE PERFORMANCE FAIL timeout');app.exit(1);},30000);
app.whenReady().then(async()=>{
  const html=path.join(temp,'fixture.html');
  fs.writeFileSync(html,`<!doctype html><meta charset="utf-8"><button data-page="distill" class="active"></button><main id="content"></main><script src="${pathToFileURL(path.resolve('src/ui/knowledge.js')).href}"></script>`);
  win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(html);
  await evaluate(`window.fixture={reads:0,projectReads:0,sourceQueries:0,failAt:0,holdAt:0};
    window.fixture.sessions=Array.from({length:3000},(_,i)=>({id:'s'+i,sessionId:'session'+i,title:'Session '+i,project:'Project '+Math.floor(i/30),get projectId(){fixture.projectReads++;return 'p'+Math.floor(i/30)},updatedAt:new Date().toISOString()}));
    window.fixture.messages=Array.from({length:8},(_,i)=>({index:i,role:'user',text:'Synthetic selected message '+i,fingerprint:'f'+i}));
    window.fixtureUI=createKnowledgeUI({demo:false,toast:message=>{fixture.toast=message},api:{
      knowledgeList:async()=>[],knowledgeState:async()=>({phase:'idle'}),
      knowledgeModels:async()=>({defaultModel:'fixture',defaultReasoningEffort:'medium',models:[{id:'fixture',name:'Fixture A',defaultEffort:'medium',efforts:[{effort:'medium'}]},{id:'fixture-b',name:'Fixture B',defaultEffort:'high',efforts:[{effort:'high'}]}]}),
      knowledgeSessions:async()=>({items:fixture.sessions,projectCount:100}),
      knowledgeTranscript:async()=>{fixture.reads++;if(fixture.holdAt===fixture.reads)await new Promise(resolve=>fixture.release=resolve);if(fixture.failAt===fixture.reads)return {unavailable:true,messages:[]};return {messages:fixture.messages};},
      knowledgePreview:async request=>{fixture.previewCalls=(fixture.previewCalls||0)+1;fixture.previewRequest=structuredClone(request);return new Promise((resolve,reject)=>{fixture.resolvePreview=resolve;fixture.rejectPreview=reject;});},
      knowledgeStart:async request=>{if(fixture.startFail)throw Error('Synthetic start failure');fixture.startedRequest=structuredClone(request);return {phase:'running'};}
    }});fixtureUI.render('distill',document.querySelector('#content'));`);
  await until('!!document.querySelector("[data-kact=sessions]") && !document.querySelector("[data-kact=models]").disabled','loaded');
  await click('[data-kact="sessions"]');
  await until('document.querySelectorAll("[data-project-check]").length===100','3000 sessions loaded');
  await evaluate(`fixture.projectReads=0;fixture.sourceQueries=0;fixture.started=performance.now();
    const content=document.querySelector('#content'),queryAll=content.querySelectorAll.bind(content);
    content.querySelectorAll=selector=>{if(['[data-session-check]','[data-project-check]','[data-message]'].includes(selector))fixture.sourceQueries++;return queryAll(selector);};void 0;`);
  await click('[data-project-check="id:p0"]');
  await until('document.querySelector("#k-count").textContent==="已选 240 条"','complete batch');
  const metrics=await evaluate(`({sessions:3000,projects:100,batchSessions:30,selectedMessages:240,transcriptReads:fixture.reads,projectPropertyReads:fixture.projectReads,sourceDomQueries:fixture.sourceQueries,elapsedMs:Math.round((performance.now()-fixture.started)*10)/10})`);
  assert.equal(metrics.transcriptReads,30);
  assert.ok(await evaluate('document.querySelector("[data-project-check=\\"id:p0\\"]").checked'));
  if(!process.argv.includes('--baseline')){
    assert.ok(metrics.projectPropertyReads<50000,'batch selection must not repeatedly scan every project/session pair');
    assert.ok(metrics.sourceDomQueries<=9,'source controls synchronize at batch boundaries');
  }
  await evaluate('fixture.reads=0;fixture.failAt=2');
  await click('[data-project-check="id:p1"]');
  await until('fixture.reads===2 && document.querySelector("[data-kact=cancel-selection]").hidden','unavailable batch');
  assert.equal(await evaluate('document.querySelector("#k-count").textContent'),'已选 240 条','archive rejection preserves existing selection');
  assert.ok(await evaluate('!document.querySelector("[data-project-check=\\"id:p1\\"]").checked'));
  await evaluate('fixture.reads=0;fixture.failAt=0;fixture.holdAt=2');
  await click('[data-project-check="id:p1"]');
  await until('!!fixture.release','pending transcript');
  assert.ok(await evaluate('[...document.querySelectorAll("[data-project-check]")].every(node=>node.disabled)'));
  await click('[data-kact="cancel-selection"]');
  await evaluate('fixture.holdAt=0;fixture.release()');
  await until('document.querySelector("[data-kact=cancel-selection]").hidden','cancelled batch');
  assert.equal(await evaluate('document.querySelector("#k-count").textContent'),'已选 240 条','cancel preserves existing selection');
  await click('[data-project-check="id:p1"]');
  await until('document.querySelector("#k-count").textContent==="已选 480 条"','retry after cancel');
  await click('[data-project-check="id:p0"]');
  assert.equal(await evaluate('document.querySelector("#k-count").textContent'),'已选 240 条','deselect affects only its project');
  assert.ok(await evaluate('document.querySelector("[data-project-check=\\"id:p1\\"]").checked'));
  // Deliberately change the workbench while the model-free preview is pending.
  await evaluate(`fixture.setField=(key,value)=>{const field=document.querySelector('[data-kfield="'+key+'"]');field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));};fixture.setField('title','Snapshot A');`);
  await click('[data-kact="preview"]');
  await until('fixture.previewCalls===1','preview pending');
  assert.ok(await evaluate('document.querySelector("[data-kact=preview]").disabled'));
  await evaluate(`document.querySelector('[data-kact=preview]').dispatchEvent(new MouseEvent('click',{bubbles:true}));fixture.setField('model','fixture-b');fixture.setField('title','Later draft');fixture.setField('kind','workflow');fixture.sessions[30].title='Later session title';`);
  await click('[data-project-check="id:p1"]');
  await evaluate('fixture.resolvePreview({chars:12345,batches:2,levels:1,calls:3})');
  await until('!!document.querySelector("#knowledge-dialog")','preview dialog');
  assert.equal(await evaluate('fixture.previewCalls'),1,'pending preview must be single-flight');
  assert.equal(await evaluate('document.querySelector(".k-confirm-model strong").textContent'),'fixture');
  assert.ok(await evaluate(`(()=>{const text=document.querySelector('#knowledge-dialog').textContent;return text.includes('240 条消息')&&text.includes('任务记忆')&&text.includes('Snapshot A')&&text.includes('Session 30')&&!text.includes('Later session title')})()`),'confirmation must preserve configuration, count and source title snapshot');
  await click('#knowledge-dialog [data-close]');
  assert.ok(await evaluate('!fixture.startedRequest && !document.querySelector("[data-kact=preview]").disabled'),'closing confirmation starts nothing and restores preview');
  await click('[data-project-check="id:p0"]');
  await until('document.querySelector("#k-count").textContent==="已选 240 条"','new selection');
  await click('[data-kact="preview"]');
  await until('fixture.previewCalls===2','failed preview pending');
  await evaluate('fixture.rejectPreview(Error("Synthetic preview failure"))');
  await until('!document.querySelector("[data-kact=preview]").disabled','preview failure restored');
  assert.equal(await evaluate('fixture.toast'),'Synthetic preview failure');
  await evaluate(`fixture.setField('model','fixture');fixture.setField('kind','task');fixture.setField('title','Snapshot A');`);
  await click('[data-kact="preview"]');
  await until('fixture.previewCalls===3','retry preview pending');
  await evaluate(`fixture.setField('model','fixture-b');fixture.setField('title','Later draft');fixture.resolvePreview({chars:12345,batches:2,levels:1,calls:3});`);
  await until('!!document.querySelector(".k-confirm-model")','retry confirmation');
  assert.equal(await evaluate('document.querySelector(".k-confirm-model strong").textContent'),'fixture');
  await evaluate('fixture.startFail=true');
  await click('[data-dialog-action="start"]');
  await until('!document.querySelector("[data-dialog-action=start]").disabled','start failure restored');
  assert.equal(await evaluate('fixture.toast'),'Synthetic start failure');
  await evaluate('fixture.startFail=false');
  await click('[data-dialog-action="start"]');
  await until('!!fixture.startedRequest && !document.querySelector("#knowledge-dialog")','confirmed start');
  assert.deepEqual(await evaluate('({model:fixture.startedRequest.model,reasoningEffort:fixture.startedRequest.reasoningEffort,title:fixture.startedRequest.title,kind:fixture.startedRequest.kind,messages:fixture.startedRequest.selection.reduce((n,s)=>n+s.messages.length,0)})'),{model:'fixture',reasoningEffort:'medium',title:'Snapshot A',kind:'task',messages:240});
  const output=path.resolve('output/knowledge-performance');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,process.argv.includes('--baseline')?'before.json':'after.json'),JSON.stringify(metrics,null,2));
  console.log('KNOWLEDGE PERFORMANCE PASS '+JSON.stringify(metrics));clearTimeout(timeout);app.exit(0);
}).catch(error=>{console.error('KNOWLEDGE PERFORMANCE FAIL',error.stack);clearTimeout(timeout);app.exit(1);});
