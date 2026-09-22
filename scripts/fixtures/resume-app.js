const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3),temp=arg('fixture-root'),phase=arg('phase');
if(!temp||!['interrupt','resume'].includes(phase))throw Error('Fixture arguments required');
const home=path.join(temp,'codex'),vault=path.join(temp,'vault');fs.mkdirSync(home,{recursive:true});
process.env.CODEX_HOME=home;process.env.CAM_DATA_ROOT=vault;app.setPath('userData',path.join(temp,'electron'));
const jwt=v=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(v)).toString('base64url')+'.synthetic';
if(phase==='interrupt'){
  fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt({sub:'resume-fixture','https://api.openai.com/auth':{chatgpt_account_id:'fixture',chatgpt_plan_type:'pro'}}),id_token:jwt({sub:'resume-fixture',email:'fixture@example.invalid'}),refresh_token:'SYNTHETIC-ONLY'}}));
  fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
  fs.writeFileSync(path.join(home,'models_cache.json'),JSON.stringify({models:[{slug:'fixture',display_name:'恢复测试模型',visibility:'list',default_reasoning_level:'high',supported_reasoning_levels:[{effort:'high'}]}]}));
  fs.mkdirSync(path.join(home,'sessions'));const file=path.join(home,'sessions','fixture.jsonl');
  const messages=Array.from({length:18},(_,index)=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:`SOURCE-${index}-`+'合成测试内容。'.repeat(2200)}]}}));
  fs.writeFileSync(file,messages.map(JSON.stringify).join('\n'));require('./knowledge-index').writeKnowledgeIndex(home,[{id:'resume-source',file,title:'大项目验证材料'}],{name:'断点恢复示例',root:'/sample/project'});
}
const archive=process.platform==='darwin'?`release/${process.arch==='arm64'?'mac-arm64':'mac'}/Codex Auth Manager.app/Contents/Resources/app.asar/src`:'release/win-unpacked/resources/app.asar/src';
const source=path.resolve(process.argv.includes('--packaged')?archive:'src'),callsFile=path.join(temp,'calls.json');let calls=fs.existsSync(callsFile)?JSON.parse(fs.readFileSync(callsFile)):[];
require(path.join(source,'knowledge/cli')).executeDistillation=async req=>{
  assert.equal(req.model,'fixture');assert.equal(req.reasoningEffort,'high');const input=JSON.parse(req.prompt.split('\n').at(-1));calls.push(req.outputSchema.properties.facts?'extract:'+input[0].source:'merge:'+input.map(i=>i.id).join(','));fs.writeFileSync(callsFile,JSON.stringify(calls));
  if(phase==='interrupt'&&calls.length===3)throw Error('合成断连：用于验证断点恢复');return require('./distillation-model')(req);
};
const exported=path.join(temp,'evidence.md');dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});
require(path.join(source,'main'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let win;const evaluate=s=>win.webContents.executeJavaScript(s),click=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
async function until(check,label){for(let i=0;i<150;i++){if(await check())return;await sleep(60)}throw Error('Timeout '+label)}
setTimeout(()=>{console.error('RESUME APP FAIL timeout');app.exit(1)},35000);
(async()=>{
  await until(()=>{win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));return win&&!win.webContents.isLoading()},'startup');win.setSize(1440,1060);
  if(phase==='interrupt'){
    const list=await evaluate('window.codexAuth.knowledgeSessions()'),id=list.items[0].id,transcript=await evaluate(`window.codexAuth.knowledgeTranscript(${JSON.stringify(id)})`);
    const request={kind:'task',title:'大项目自动分批与断点恢复',project:'验证示例',instructions:'',model:'fixture',reasoningEffort:'high',selection:[{id,messages:transcript.messages.map(m=>m.index),fingerprints:Object.fromEntries(transcript.messages.map(m=>[m.index,m.fingerprint]))}]};
    const plan=await evaluate(`window.codexAuth.knowledgePreview(${JSON.stringify(request)})`);assert.ok(plan.chars>240000);await evaluate(`window.codexAuth.knowledgeStart(${JSON.stringify(request)})`);
    await until(()=>evaluate('window.codexAuth.knowledgeState().then(s=>s.phase==="failed")'),'injected failure');assert.equal((await evaluate('window.codexAuth.knowledgeState()')).completed,2);app.exit(0);return;
  }
  await click('[data-page=distill]');await until(()=>evaluate('!!document.querySelector("[data-kact=resume]")'),'restored resume action');const state=await evaluate('window.codexAuth.knowledgeState()');assert.equal(state.phase,'paused');assert.equal(state.completed,2);assert.equal(calls.length,3,'no automatic model call after restart');
  await until(()=>evaluate('!document.querySelector("[data-kfield=model]")?.disabled'),'models loaded');await evaluate('document.querySelector("#toast").style.display="none"');fs.mkdirSync('output/knowledge',{recursive:true});win.showInactive();await sleep(200);fs.writeFileSync('output/knowledge/checkpoint-resume.png',(await win.webContents.capturePage()).toPNG());
  await click('[data-kact=resume]');await click('[data-dialog-action=resume]');await until(()=>evaluate('window.codexAuth.knowledgeState().then(s=>s.phase==="completed")'),'completion');
  const items=await evaluate('window.codexAuth.knowledgeList()');assert.equal(items.length,1);assert.equal(items[0].evidenceCount,18);assert.equal(calls.filter(c=>c==='extract:1:1').length,1);assert.equal(calls.filter(c=>c==='extract:1:2').length,1);assert.equal(calls.filter(c=>c==='extract:1:3').length,2);
  await evaluate(`window.codexAuth.knowledgeExport(${JSON.stringify(items[0].id)})`);assert.match(fs.readFileSync(exported,'utf8'),/完整证据档案/);assert.match(fs.readFileSync(exported,'utf8'),/B18F1/);
  assert.equal(fs.existsSync(path.join(vault,'knowledge','jobs','current.enc')),false);console.log('RESUME APP PASS: restored UI and full export');app.exit(0);
})().catch(error=>{console.error('RESUME APP FAIL',error);app.exit(1)});
