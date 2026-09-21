// Deterministic visual and interaction checks. No preload, credentials, network or CLI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve('output/design'); fs.mkdirSync(root, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-design-'));
app.setPath('userData', temp); app.commandLine.appendSwitch('force-device-scale-factor','1');
let win, meter; const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evaluate = async js => {try{return await win.webContents.executeJavaScript(js)}catch(e){console.error('Expression:',js);throw e}};
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const screenshot = async (name, target = win) => { target.showInactive(); await sleep(220); fs.writeFileSync(path.join(root, name+'.png'), (await target.webContents.capturePage()).toPNG()); };
setTimeout(() => { console.error('DESIGN FAIL timeout'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  win = new BrowserWindow({ width:1400,height:940,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3){errors.push(message);console.error(message)}});
  await win.loadFile(path.resolve('src/ui/manager.html'), { query:{demo:'1'} }); await sleep(150);
  assert.equal(await evaluate('document.querySelectorAll(".account-card").length'),4);
  assert.equal(await evaluate('document.querySelector(".account-card").querySelectorAll(".meter").length'),1,'Pro off should use the full card for weekly quota');
  const redraw = await evaluate(`(async()=>{const before=document.querySelector('.account-card');await refreshLive();return before===document.querySelector('.account-card')})()`);
  assert.equal(redraw,true,'unchanged live data should preserve DOM');
  await evaluate(`const searchBox=document.querySelector('#search');searchBox.value='studio';searchBox.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await evaluate('document.querySelectorAll(".account-card").length'),1);
  await evaluate(`search='';render()`);
  await evaluate(`run(async()=>render())`);assert.ok(await evaluate('[...document.querySelectorAll(".switch-btn")].every(button=>!button.disabled)'),'account controls must recover after an operation');
  for(const page of ['accounts','usage','quotas','distill','memory','activity','diagnostics','settings']){
    await click(`[data-page="${page}"]`); await sleep(50); await screenshot(page);
    assert.ok(await evaluate('document.querySelector("#content").scrollWidth<=document.querySelector("#content").clientWidth'),'no horizontal overflow '+page);
  }
  // Large synthetic library uses the same renderer and delegated event handlers.
  await click('[data-page="distill"]');
  await evaluate(`window.designMessages=Array.from({length:500},(_,i)=>({index:i,role:i%2?'assistant':'user',text:'合成素材 '+i+'。用于验证分页、选择和滚动保留。',fingerprint:'f'+i}));
    window.designItems=Array.from({length:250},(_,i)=>({id:'item'+i,kind:['task','profile','workflow','skill','prompt'][i%5],title:'知识条目 '+String(i).padStart(3,'0'),body:'项目背景、已确认约定与可复用方法。',project:'示例项目',origin:'distill',status:i%3?'saved':'draft',sources:[],updatedAt:new Date(Date.now()-i*60000).toISOString()}));
    window.designUI=window.createKnowledgeUI({api:{knowledgeModels:async()=>({defaultModel:'design-model',defaultReasoningEffort:'medium',models:[{id:'design-model',name:'设计测试模型',defaultEffort:'medium',efforts:[{effort:'medium'}]}]}),knowledgeList:async()=>window.designItems,knowledgeState:async()=>({phase:'idle'}),knowledgeSessions:async()=>({items:Array.from({length:150},(_,i)=>({id:'s'+i,title:'项目会话 '+i,project:'示例项目',sessionId:'session'+i,updatedAt:new Date().toISOString()}))}),knowledgeTranscript:async()=>({messages:window.designMessages})},demo:false,toast});
    window.designUI.render('distill',document.querySelector('#content'));`);
  await sleep(50);await click('[data-kact="sessions"]');await sleep(50);
  assert.equal(await evaluate('document.querySelectorAll(".k-session").length'),50);
  await click('.k-session');await sleep(50);
  assert.equal(await evaluate('document.querySelectorAll("[data-message]").length'),24);
  assert.ok(await evaluate(`(()=>{const node=document.querySelector('[data-message="0"]'),box=document.querySelector('.k-transcript');box.scrollTop=90;const before=box.scrollTop;node.click();return document.querySelector('[data-message="0"]')===node&&box.scrollTop===before&&node.closest('.k-message').classList.contains('chosen')})()`),'selection must preserve message node and scroll');
  await click('[data-key="messages"][data-step="1"]');await click('[data-message="24"]');
  await click('[data-key="messages"][data-step="-1"]');assert.ok(await evaluate(`document.querySelector('[data-message="0"]').checked`));
  await click('[data-kact="selected-only"]');assert.equal(await evaluate('document.querySelectorAll("[data-message]").length'),2);
  await click('[data-message="0"]');assert.equal(await evaluate('document.querySelectorAll("[data-message]").length'),1);
  await click('[data-kact="selected-only"]');await click('[data-kact="select-all"]');assert.equal(await evaluate('document.querySelectorAll("[data-message]:checked").length'),24);assert.ok(await evaluate('document.querySelector("#k-count").textContent.includes("500")'),'select all spans all pages');await click('[data-kact="select-all"]');assert.ok(await evaluate('document.querySelector("#k-count").textContent.includes("0")'));await click('[data-kact="select-all"]');assert.equal(await evaluate('document.querySelector("[data-kact=clear]")'),null);
  await evaluate(`const title=document.querySelector('[data-kfield="title"]');title.value='保留输入和焦点';title.dispatchEvent(new Event('input',{bubbles:true}));title.focus();window.keptTitle=title;window.designUI.update({phase:'running'});`);
  assert.ok(await evaluate('document.activeElement===window.keptTitle&&window.keptTitle.value==="保留输入和焦点"'),'progress must not replace inputs');
  await evaluate(`window.designUI.update({phase:'idle'});`);
  await evaluate(`window.designMessages[0]={...window.designMessages[0],text:'Edited material',fingerprint:'changed'};`);await click('.k-session.selected');await sleep(50);assert.ok(await evaluate(`!document.querySelector('[data-message="0"]').checked`),'changed selected content must require renewed review');
  await screenshot('distill-large');
  await click('[data-page="memory"]');await evaluate(`window.designUI.render('memory',document.querySelector('#content'))`);
  assert.equal(await evaluate('document.querySelectorAll(".k-card").length'),24);
  await evaluate(`const q=document.querySelector('#k-query');q.value='条目 249';q.dispatchEvent(new Event('input',{bubbles:true}))`);await sleep(180);
  assert.equal(await evaluate('document.querySelectorAll(".k-card").length'),1);
  await evaluate(`{const q=document.querySelector('#k-query');q.value='no match';q.dispatchEvent(new Event('input',{bubbles:true}))}`);await sleep(180);await click('[data-kact="reset-filters"]');
  assert.equal(await evaluate('document.querySelectorAll(".k-card").length'),24);
  await screenshot('memory-large');
  win.setSize(1000,820);await evaluate('document.body.classList.add("dark")');
  for(const page of ['accounts','usage','quotas','distill','memory','activity','diagnostics','settings']){
    await click(`[data-page="${page}"]`);await sleep(30);
    assert.ok(await evaluate('document.querySelector("#content").scrollWidth<=document.querySelector("#content").clientWidth'),'compact overflow '+page);
    await screenshot(page+'-compact-dark');
  }
  meter = new BrowserWindow({width:360,height:560,frame:false,transparent:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await meter.loadFile(path.resolve('src/ui/meter.html'),{query:{demo:'1'}});await sleep(100);
  const me = js => meter.webContents.executeJavaScript(js);
  assert.ok(await me('document.querySelector(".meter-content").scrollHeight<=document.querySelector(".meter-content").clientHeight'),'weekly-only meter should fit');
  await screenshot('meter-pro',meter);
  await me('document.querySelector("#account-trigger").click()');await screenshot('meter-menu',meter);
  await me('document.querySelector("[data-id=c]").click();document.querySelector("#switch-btn").click();document.querySelector("#confirm-switch").click()');await sleep(200);
  assert.ok(await me('!document.querySelector("#weekly-section").hidden'));
  assert.ok(await me('document.querySelector(".meter-content").scrollHeight<=document.querySelector(".meter-content").clientHeight'),'Plus meter should fit');
  await me('document.querySelector("#message").hidden=true;document.body.classList.add("dark")');await screenshot('meter-plus-dark',meter);
  assert.deepEqual(errors,[]);
  const report={checks:'8 pages at 1400x940 and 1000x820; Pro/Plus meter at 360x560; search, pagination, selection, focus retention, unchanged refresh',messageNodes:24,totalMessages:500,memoryCards:24,totalItems:250,sessionNodes:50,totalSessions:150,unchangedRefreshPreservesDOM:redraw};
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log('DESIGN PASS '+JSON.stringify(report));app.exit(0);
}).catch(error=>{console.error('DESIGN FAIL',error.stack);app.exit(1)});
