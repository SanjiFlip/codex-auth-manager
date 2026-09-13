// Actual main/preload/renderers, synthetic credentials and a stubbed official service.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-realtime-'));
const home=path.join(temp,'codex');fs.mkdirSync(home);
process.env.CODEX_HOME=home;process.env.CAM_DATA_ROOT=path.join(temp,'vault');
app.setPath('userData',path.join(temp,'electron'));
const jwt=v=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(v)).toString('base64url')+'.synthetic';
const auth=JSON.stringify({auth_mode:"chatgpt",tokens:{access_token:jwt({sub:'realtime','https://api.openai.com/auth':{chatgpt_account_id:'realtime',chatgpt_plan_type:'pro'}}),id_token:jwt({sub:'realtime',email:'realtime@example.invalid'}),refresh_token:'SYNTHETIC-REALTIME-TEST'}});
fs.writeFileSync(path.join(home,'auth.json'),auth);fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
let percent=12,calls=0;
require('../src/official-account').queryOfficialAccount=async()=>{calls++;await new Promise(r=>setTimeout(r,100));return {planType:'pro',email:'realtime@example.invalid',quota:{source:'official-app-server',checkedAt:new Date().toISOString(),session:null,weekly:{usedPercent:percent,resetsAt:new Date(Date.now()+86400000).toISOString()},resetCredits:1}}};
require('../src/main');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label,ms=9000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await sleep(100)}throw Error(label)}
const evaluate=(w,s)=>w.webContents.executeJavaScript(s);
setTimeout(()=>{console.error('REALTIME FAIL: timeout');app.exit(1)},50000);
(async()=>{
  let main,meter;
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));return main&&!main.webContents.isLoading()},'main startup');
  const state=await evaluate(main,'window.codexAuth.importCurrent("Realtime test")');const id=state.accounts[0].id;
  await evaluate(main,'window.codexAuth.showWidget()');
  await until(()=>{meter=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('meter.html'));return meter&&!meter.webContents.isLoading()},'meter startup');
  await until(()=>evaluate(meter,'document.querySelector("#tokens").textContent === "0"'),'initial usage');
  const sessions=path.join(home,'sessions');fs.mkdirSync(sessions,{recursive:true});
  const file=path.join(sessions,'rollout-realtime.jsonl');
  const now=new Date().toISOString();
  fs.writeFileSync(file,JSON.stringify({type:'session_meta',timestamp:now,payload:{id:'realtime-session',timestamp:now}})+'\n');
  fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:now,payload:{type:'token_count',info:{total_token_usage:{input_tokens:1234,total_tokens:1234}}}})+'\n');
  await until(async()=>await evaluate(meter,'document.querySelector("#tokens").textContent === "1,234"')&&await evaluate(main,'document.querySelector(".summary-grid").textContent.includes("1,234")'),'log event must refresh both windows within 9 seconds');
  console.log('PASS: local log event refreshes both windows');
  assert.equal(calls,0,'Startup and local events must not query the remote service');
  percent=37;await evaluate(main,`window.codexAuth.refreshOfficial(${JSON.stringify(id)})`);
  await until(()=>evaluate(meter,'document.querySelector("#session").textContent === "63%"'),'official refresh must reach meter');
  console.log('PASS: manual official refresh broadcasts to meter');
  const later=new Date().toISOString();
  fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:later,payload:{type:'token_count',rate_limits:{plan_type:'pro',primary:{used_percent:49,window_minutes:10080,resets_at:Math.floor(Date.now()/1000)+86400}}}})+'\n');
  await until(()=>evaluate(meter,'document.querySelector("#session").textContent === "51%"'),'newer local quota must replace old official snapshot');
  assert.ok(await evaluate(meter,'!document.querySelector("#session-reset").textContent.includes("已到期")'),'local Unix reset timestamp displays correctly');
  console.log('PASS: newer local quota overrides old official cache');

  const before=calls;
  await Promise.all([evaluate(main,'window.codexAuth.refreshLocalData()'),evaluate(meter,'window.codexAuth.refreshLocalData()')]);
  await sleep(11000);
  assert.equal(calls,before,'Local refresh must not invoke remote query');
  assert.equal(fs.readFileSync(path.join(home,'auth.json'),'utf8'),auth);
  console.log('REALTIME PASS: log changes, cross-window quota, local-only refresh, current auth preserved');app.exit(0);
})().catch(e=>{console.error('REALTIME FAIL:',e.message);app.exit(1)});
