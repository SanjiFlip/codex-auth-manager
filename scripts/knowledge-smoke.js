// Actual main, preload, renderers and OS encryption; only synthetic data and model output.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const archive=process.platform==='darwin'?`release/${process.arch==='arm64'?'mac-arm64':'mac'}/Codex Auth Manager.app/Contents/Resources/app.asar/src`:'release/win-unpacked/resources/app.asar/src';
const sourceRoot=path.resolve(process.argv.includes('--packaged')?archive:'src');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-knowledge-smoke-')),home=path.join(temp,'codex');fs.mkdirSync(home);
process.env.CODEX_HOME=home;process.env.CAM_DATA_ROOT=path.join(temp,'vault');app.setPath('userData',path.join(temp,'electron'));
const jwt=value=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(value)).toString('base64url')+'.synthetic';
const auth=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt({sub:'knowledge','https://api.openai.com/auth':{chatgpt_account_id:'fixture',chatgpt_plan_type:'pro'}}),id_token:jwt({sub:'knowledge',email:'knowledge@example.invalid'}),refresh_token:'SYNTHETIC-ONLY'}});
fs.writeFileSync(path.join(home,'auth.json'),auth);fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');fs.mkdirSync(path.join(home,'sessions'));
const rows=[{type:'session_meta',payload:{id:'knowledge-fixture',cwd:'示例项目 / Codex Auth Manager'}}];
for(const [role,text] of [['user','我们希望周额度按照同周期的有效快照更新，不要被异常零值覆盖。'],['assistant','验证主窗口、悬浮窗和日志轮换；新周期重置时允许正常恢复到 100%。'],['user','这条是未选择的合成消息，不参与蒸馏。']])rows.push({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
fs.writeFileSync(path.join(home,'sessions','fixture.jsonl'),rows.map(JSON.stringify).join('\n'));
fs.writeFileSync(path.join(home,'models_cache.json'),JSON.stringify({fetched_at:new Date().toISOString(),models:[{slug:'fixture-balanced',display_name:'均衡模型（合成测试）',visibility:'list',default_reasoning_level:'medium',supported_reasoning_levels:[{effort:'low'},{effort:'medium'}]},{slug:'fixture-deep',display_name:'深度模型（合成测试）',visibility:'list',default_reasoning_level:'high',supported_reasoning_levels:[{effort:'high'},{effort:'xhigh'}]}]}));
const indexRows=[{id:'knowledge-fixture',file:path.toNamespacedPath(path.join(home,'sessions','fixture.jsonl')),title:'额度同步验证',updatedAt:Date.now()+1000}];
for(const [i,title] of ['模型与推理强度选择','账号切换流程','悬浮窗展示规则','本地记忆整理'].entries()){const file=path.join(home,'sessions','extra-'+i+'.jsonl');fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'extra-'+i}}));indexRows.push({id:'extra-'+i,file,title,updatedAt:Date.now()-i*1000});}
require('./fixtures/knowledge-index').writeKnowledgeIndex(home,indexRows,{name:'Codex Auth Manager',root:'/sample/project'});
let calls=0,hold=false;
require(path.join(sourceRoot,'knowledge/cli')).executeDistillation=async({prompt,outputSchema,model,reasoningEffort,signal})=>{calls++;if(calls===1){assert.equal(model,'fixture-deep');assert.equal(reasoningEffort,'xhigh');}assert.ok(!prompt.includes('这条是未选择的合成消息，不参与蒸馏。'));if(hold)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('已取消蒸馏。')),{once:true}));return require('./fixtures/distillation-model')({prompt,outputSchema});};
const exported=path.join(temp,'export.md');dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});
require(path.join(sourceRoot,'main'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(test,label){for(let i=0;i<100;i++){if(await test())return;await sleep(100)}throw Error(label)}
let win;const evaluate=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){console.error("Failed expression:",s);throw e}};const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function screenshot(name){win.showInactive();win.webContents.setBackgroundThrottling(false);await sleep(220);const image=await win.webContents.capturePage();assert.ok(!image.isEmpty(),'screenshot must contain pixels');fs.writeFileSync('output/knowledge/'+name+'.png',image.toPNG());}
setTimeout(()=>{console.error('KNOWLEDGE FAIL timeout');app.exit(1)},50000);
(async()=>{
 await until(()=>{win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));return win&&!win.webContents.isLoading()},'startup');
 win.webContents.on("console-message",(_event,level,message)=>{if(level>=2)console.error("Renderer:",message)});win.setSize(1440,1060);await click('[data-page="distill"]');await sleep(300);await click('[data-kact="sessions"]');await until(()=>evaluate('!!document.querySelector(".k-project-toggle")'),'project list');assert.equal(await evaluate('document.querySelectorAll(".k-session").length'),0);await click('.k-project-toggle');await click('.k-session');await until(()=>evaluate('document.querySelectorAll("[data-message]").length===3'),'transcript');
 await click('[data-project-check]');await until(()=>evaluate('document.querySelector("[data-project-check]").checked'),'project selected');assert.equal(await evaluate('document.querySelectorAll("[data-message]:checked").length'),3);
 await click('[data-session-check]');assert.equal(await evaluate('document.querySelectorAll("[data-message]:checked").length'),0);
 await click('[data-session-check]');await until(()=>evaluate('document.querySelector("[data-session-check]").checked'),'session selected');await click('[data-message="2"]');assert.ok(await evaluate('document.querySelector("[data-session-check]").indeterminate&&document.querySelector("[data-project-check]").indeterminate'));
 await evaluate(`for(const [key,value] of Object.entries({title:'周额度同步验证约定',project:'Codex Auth Manager'})){const el=document.querySelector('[data-kfield="'+key+'"]');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))}`);
 await until(()=>evaluate('document.querySelector("[data-kfield=model]")?.options.length===2'),'local model picker');
 await evaluate(`for(const [key,value] of [['model','fixture-deep'],['reasoningEffort','xhigh']]){const el=document.querySelector('[data-kfield="'+key+'"]');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}`);
 assert.equal(await evaluate('document.querySelector("[data-kfield=reasoningEffort]").options.length'),2);
 await click('[data-kact="preview"]');await until(()=>evaluate('!!document.querySelector(".k-confirm-model")'),'preview ready');assert.equal(calls,0);assert.ok(await evaluate('document.querySelector(".k-confirm-model").textContent.includes("xhigh")'));await click('[data-dialog-action="start"]');await until(()=>evaluate('document.querySelectorAll(".k-card").length===1'),'draft');
 assert.equal(calls,2);assert.equal(await evaluate('window.codexAuth.knowledgeList().then(items=>items[0].status)'),'draft');
 fs.mkdirSync('output/knowledge',{recursive:true});await screenshot('workbench');
 const region=await evaluate(`(()=>{const r=document.querySelector('.k-source-layout').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()`);fs.writeFileSync('output/knowledge/project-sessions.png',(await win.webContents.capturePage(region)).toPNG());
 await click('[data-kact="edit"]');await click('[data-dialog-action="saved"]');await until(()=>evaluate('!document.querySelector("#knowledge-dialog")'),'save');
 await click('[data-page="memory"]');assert.ok(await evaluate('document.querySelector("#k-cards").textContent.includes("已保存")'));await click('[data-kact="export"]');await until(()=>fs.existsSync(exported),'export');assert.match(fs.readFileSync(exported,'utf8'),/来源/);
 await screenshot('memory');
 const encrypted=fs.readFileSync(path.join(temp,'vault','knowledge','knowledge.enc'),'utf8');assert.ok(!encrypted.includes('周额度'));assert.ok(!encrypted.includes('UNSELECTED'));
 win.reload();await until(()=>!win.webContents.isLoading(),'reload');await click('[data-page="memory"]');await until(()=>evaluate('document.querySelectorAll(".k-card").length===1'),'persistent memory');
 win.setSize(1000,820);await evaluate('document.body.classList.add("dark")');await sleep(100);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'responsive page must not overflow horizontally');await screenshot('memory-dark');
 // IPC cancellation uses the real workbench lifecycle with a delayed model fixture.
 hold=true;const refs=await evaluate('window.codexAuth.knowledgeSessions()');const transcript=await evaluate(`window.codexAuth.knowledgeTranscript(${JSON.stringify(refs.items[0].id)})`);
 const req={kind:'task',title:'Cancel fixture',project:'',instructions:'',selection:[{id:refs.items[0].id,messages:[0],fingerprints:{0:transcript.messages[0].fingerprint}}]};
 await evaluate(`window.codexAuth.knowledgeStart(${JSON.stringify(req)})`);await until(()=>calls===3,'second run');const switchError=await evaluate('window.codexAuth.switchAccount("missing").then(()=>"",e=>e.message)');assert.match(switchError,/蒸馏/);await evaluate('window.codexAuth.knowledgeCancel()');assert.equal(await evaluate('window.codexAuth.knowledgeList().then(items=>items.length)'),1);
 assert.equal(fs.readFileSync(path.join(home,'auth.json'),'utf8'),auth);
 // Archive after listing and selection: clicking the stale row quietly removes it.
 await click('[data-page="distill"]');await click('[data-kact="sessions"]');await until(()=>evaluate('!!document.querySelector(".k-project-toggle")'),'active project');if(await evaluate('document.querySelector(".k-project-toggle").getAttribute("aria-expanded")!=="true"'))await click('.k-project-toggle');await until(()=>evaluate('!!document.querySelector(".k-session")'),'active row');
 await click('.k-session');await until(()=>evaluate('document.querySelectorAll("[data-message]").length===3'),'active transcript');await click('[data-kact="select-all"]');
 const db=new (require('node:sqlite').DatabaseSync)(path.join(home,'state_5.sqlite'));
 db.exec("UPDATE threads SET archived=1");db.close();
 await evaluate('document.querySelector("#toast").textContent=""');await click('.k-session');
 await until(()=>evaluate('!document.querySelector(".k-session") && document.querySelector("#k-count").textContent==="已选 0 条"'),'archive removed');
 assert.equal(await evaluate('document.querySelectorAll("[data-message]").length'),0);
 assert.equal(await evaluate('document.querySelector("#toast").textContent'),'','archive race must not surface an IPC error');
 assert.deepEqual(await evaluate(`window.codexAuth.knowledgeTranscript(${JSON.stringify(refs.items[0].id)})`),{unavailable:true,messages:[]});
 console.log('KNOWLEDGE PASS: selection consent, draft, save, encrypted persistence, export, reload, cancel, account-switch guard, extended paths, archived selection removal, auth unchanged');app.exit(0);
})().catch(e=>{console.error('KNOWLEDGE FAIL:',e.message);app.exit(1)});
