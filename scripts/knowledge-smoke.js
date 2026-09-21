// Actual main, preload, renderers and OS encryption; only synthetic data and model output.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const sourceRoot=process.argv.includes('--packaged')?path.resolve('release/win-unpacked/resources/app.asar/src'):path.resolve('src');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-knowledge-smoke-')),home=path.join(temp,'codex');fs.mkdirSync(home);
process.env.CODEX_HOME=home;process.env.CAM_DATA_ROOT=path.join(temp,'vault');app.setPath('userData',path.join(temp,'electron'));
const jwt=value=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(value)).toString('base64url')+'.synthetic';
const auth=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt({sub:'knowledge','https://api.openai.com/auth':{chatgpt_account_id:'fixture',chatgpt_plan_type:'pro'}}),id_token:jwt({sub:'knowledge',email:'knowledge@example.invalid'}),refresh_token:'SYNTHETIC-ONLY'}});
fs.writeFileSync(path.join(home,'auth.json'),auth);fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');fs.mkdirSync(path.join(home,'sessions'));
const rows=[{type:'session_meta',payload:{id:'knowledge-fixture',cwd:'示例项目 / Codex Auth Manager'}}];
for(const [role,text] of [['user','我们希望周额度按照同周期的有效快照更新，不要被异常零值覆盖。'],['assistant','验证主窗口、悬浮窗和日志轮换；新周期重置时允许正常恢复到 100%。'],['user','这条是未选择的合成消息，不参与蒸馏。']])rows.push({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
fs.writeFileSync(path.join(home,'sessions','fixture.jsonl'),rows.map(JSON.stringify).join('\n'));
let calls=0,hold=false;
require(path.join(sourceRoot,'knowledge/cli')).executeDistillation=async({prompt,signal})=>{calls++;assert.ok(!prompt.includes('这条是未选择的合成消息，不参与蒸馏。'));if(hold)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('已取消蒸馏。')),{once:true}));return '## 已决定事项\n\n保留同周期最后有效的周额度。[1:1]\n\n## 验证方法\n\n同时检查主窗口、悬浮窗与日志轮换。[1:2]\n\n## 适用边界\n\n新周期正常重置允许显示 100%。';};
const exported=path.join(temp,'export.md');dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});
require(path.join(sourceRoot,'main'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(test,label){for(let i=0;i<100;i++){if(await test())return;await sleep(100)}throw Error(label)}
let win;const evaluate=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){console.error("Failed expression:",s);throw e}};const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
setTimeout(()=>{console.error('KNOWLEDGE FAIL timeout');app.exit(1)},50000);
(async()=>{
 await until(()=>{win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));return win&&!win.webContents.isLoading()},'startup');
 win.webContents.on("console-message",(_event,level,message)=>{if(level>=2)console.error("Renderer:",message)});win.setSize(1440,1060);await click('[data-page="distill"]');await sleep(300);await click('[data-kact="sessions"]');await until(()=>evaluate('!!document.querySelector(".k-session")'),'session list');await click('.k-session');await until(()=>evaluate('document.querySelectorAll("[data-message]").length===3'),'transcript');
 await click('[data-message="0"]');await click('[data-message="1"]');
 await evaluate(`for(const [key,value] of Object.entries({title:'周额度同步验证约定',project:'Codex Auth Manager'})){const el=document.querySelector('[data-kfield="'+key+'"]');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}`);
 await click('[data-kact="preview"]');assert.equal(calls,0);await click('[data-dialog-action="start"]');await until(()=>evaluate('document.querySelectorAll(".k-card").length===1'),'draft');
 assert.equal(calls,1);assert.equal(await evaluate('window.codexAuth.knowledgeList().then(items=>items[0].status)'),'draft');
 fs.mkdirSync('output/knowledge',{recursive:true});fs.writeFileSync('output/knowledge/workbench.png',(await win.webContents.capturePage()).toPNG());
 await click('[data-kact="edit"]');await click('[data-dialog-action="saved"]');await until(()=>evaluate('!document.querySelector("#knowledge-dialog")'),'save');
 await click('[data-page="memory"]');assert.ok(await evaluate('document.querySelector("#k-cards").textContent.includes("已保存")'));await click('[data-kact="export"]');await until(()=>fs.existsSync(exported),'export');assert.match(fs.readFileSync(exported,'utf8'),/来源/);
 fs.writeFileSync('output/knowledge/memory.png',(await win.webContents.capturePage()).toPNG());
 const encrypted=fs.readFileSync(path.join(temp,'vault','knowledge','knowledge.enc'),'utf8');assert.ok(!encrypted.includes('周额度'));assert.ok(!encrypted.includes('UNSELECTED'));
 win.reload();await until(()=>!win.webContents.isLoading(),'reload');await click('[data-page="memory"]');await until(()=>evaluate('document.querySelectorAll(".k-card").length===1'),'persistent memory');
 win.setSize(1000,820);await evaluate('document.body.classList.add("dark")');await sleep(100);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'responsive page must not overflow horizontally');fs.writeFileSync('output/knowledge/memory-dark.png',(await win.webContents.capturePage()).toPNG());
 // IPC cancellation uses the real workbench lifecycle with a delayed model fixture.
 hold=true;const refs=await evaluate('window.codexAuth.knowledgeSessions()');const transcript=await evaluate(`window.codexAuth.knowledgeTranscript(${JSON.stringify(refs.items[0].id)})`);
 const req={kind:'task',title:'Cancel fixture',project:'',instructions:'',selection:[{id:refs.items[0].id,messages:[0],fingerprints:{0:transcript.messages[0].fingerprint}}]};
 await evaluate(`window.codexAuth.knowledgeStart(${JSON.stringify(req)})`);await until(()=>calls===2,'second run');const switchError=await evaluate('window.codexAuth.switchAccount("missing").then(()=>"",e=>e.message)');assert.match(switchError,/蒸馏/);await evaluate('window.codexAuth.knowledgeCancel()');assert.equal(await evaluate('window.codexAuth.knowledgeList().then(items=>items.length)'),1);
 assert.equal(fs.readFileSync(path.join(home,'auth.json'),'utf8'),auth);
 console.log('KNOWLEDGE PASS: selection consent, draft, save, encrypted persistence, export, reload, cancel, account-switch guard, auth unchanged');app.exit(0);
})().catch(e=>{console.error('KNOWLEDGE FAIL:',e.message);app.exit(1)});
