// Actual main/preload/windows; isolated synthetic accounts and a fake OS adapter.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-account-display-'));
const home=path.join(temp,'codex');fs.mkdirSync(home);
process.env.CODEX_HOME=home;process.env.CAM_DATA_ROOT=path.join(temp,'vault');
app.setPath('appData',temp);app.setPath('userData',path.join(temp,'electron'));
fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
const jwt=value=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(value)).toString('base64url')+'.synthetic';
function credentials(person,workspace){return JSON.stringify({auth_mode:'chatgpt',tokens:{
  access_token:jwt({sub:person,exp:2000000000,'https://api.openai.com/auth':{chatgpt_account_id:workspace,chatgpt_plan_type:'plus'}}),
  id_token:jwt({sub:person,email:person+'@example.invalid'}),refresh_token:'SYNTHETIC-'+person+'-'+workspace,
}})}
const first=credentials('first','shared-workspace'),second=credentials('second','shared-workspace'),otherWorkspace=credentials('first','other-workspace');
const authPath=path.join(home,'auth.json');fs.writeFileSync(authPath,first);
const packaged=process.argv.includes('--packaged');
const source=packaged?path.join(__dirname,'../release',process.platform==='darwin'?(process.arch==='arm64'?'mac-arm64':'mac'):'win-unpacked',...(process.platform==='darwin'?['Codex Auth Manager.app','Contents','Resources']:['resources']),'app.asar','src'):path.join(__dirname,'../src');
const lifecycle=require(path.join(source,process.platform==='darwin'?'mac-codex':'windows-codex'));
let failLaunch=false;
lifecycle.discover=async()=>({synthetic:true});lifecycle.stop=async()=>{};
lifecycle.launch=async()=>{if(failLaunch)throw Error('Synthetic startup failure')};
require(path.join(source,'official-account')).queryOfficialAccount=async()=>{throw Error('Synthetic offline service')};
require(path.join(source,'main'));
const timeout=setTimeout(()=>{console.error('ACCOUNT DISPLAY FAIL: timeout');app.exit(1)},60000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(window,code)=>window.webContents.executeJavaScript(code);
async function until(test,label){for(let i=0;i<100;i++){if(await test())return;await sleep(100)}throw Error(label)}
(async()=>{
  let main,meter;
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));return main&&!main.webContents.isLoading()},'main startup');
  const save=async(name,content)=>{fs.writeFileSync(authPath,content);const state=await evaluate(main,`window.codexAuth.importCurrent(${JSON.stringify(name)})`);return state.accounts.find(a=>a.isActive).id};
  const a=await save('First account',first),b=await save('Second account',second),c=await save('Other workspace',otherWorkspace);
  assert.equal(new Set([a,b,c]).size,3,'People in one workspace and workspaces of one person stay distinct');
  await evaluate(main,`window.codexAuth.switchAccount(${JSON.stringify(a)})`);
  await evaluate(main,'window.codexAuth.showWidget()');
  await until(()=>{meter=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('meter.html'));return meter&&!meter.webContents.isLoading()},'meter startup');
  const selected=()=>evaluate(meter,'document.querySelector("#selected-name").textContent');
  await until(async()=>await selected()==='First account','initial current account');
  await evaluate(main,`window.codexAuth.switchAccount(${JSON.stringify(b)})`);
  await until(async()=>await evaluate(meter,`state.accounts.find(a=>a.isActive)?.id===${JSON.stringify(b)}`),'meter receives switched state');
  assert.equal(await selected(),'Second account','Main-window switch must update the meter identity together with its quota');
  assert.equal(await evaluate(meter,'document.querySelector("#selection-state").textContent'),'当前账号');
  console.log('PASS: main-window switch synchronizes the meter identity');
  // A user choice remains pending during ordinary refreshes.
  await evaluate(meter,`document.querySelector('#account-trigger').click();document.querySelector('[data-id="${a}"]').click()`);
  await evaluate(main,'window.codexAuth.refreshLocalData()');
  await evaluate(meter,'load()');
  assert.equal(await selected(),'First account');
  assert.equal(await evaluate(meter,'document.querySelector("#selection-state").textContent'),'待切换');
  console.log('PASS: refreshing preserves an explicitly chosen switch target');
  fs.writeFileSync(authPath,first);
  const externalSummary=await evaluate(main,'window.codexAuth.getAllAccountsQuota()');
  assert.deepEqual(externalSummary.accounts.filter(account=>account.isActive).map(account=>account.id),[a],'Current credentials override the previously switched id in the quota API');
  await until(async()=>await evaluate(meter,`state.accounts.find(a=>a.isActive)?.id===${JSON.stringify(a)}`),'external login reaches meter');
  assert.equal(await evaluate(meter,'document.querySelector("#selection-state").textContent'),'当前账号');
  fs.writeFileSync(authPath,second);
  await until(async()=>await evaluate(meter,`state.accounts.find(a=>a.isActive)?.id===${JSON.stringify(b)}`),'second external login reaches meter');
  assert.equal(await selected(),'Second account','External login must follow the current account when no pending choice remains');
  await until(()=>evaluate(main,'document.querySelector(".active-panel h2").textContent.includes("Second account")'),'main identity follows external login');
  assert.equal(await evaluate(main,'document.querySelectorAll(".account-card.selected").length'),1);
  console.log('PASS: external login and the current marker synchronize across both windows');
  await evaluate(main,`window.codexAuth.switchAccount(${JSON.stringify(c)})`);
  await until(async()=>await selected()==='Other workspace','same-person workspace switch follows current identity');
  failLaunch=true;
  const failure=await evaluate(main,`window.codexAuth.switchAccount(${JSON.stringify(b)}).then(()=>null,e=>e.message)`);
  assert.match(failure,/已恢复原凭据/);failLaunch=false;
  await until(async()=>await evaluate(meter,`!busy&&state.accounts.find(a=>a.isActive)?.id===${JSON.stringify(c)}`),'rollback state arrives');
  assert.equal(await selected(),'Other workspace');assert.equal(fs.readFileSync(authPath,'utf8'),otherWorkspace);
  console.log('PASS: failed launch restores the displayed identity and credential file');
  fs.writeFileSync(authPath,'{}');
  const invalid=await evaluate(main,'window.codexAuth.getAllAccountsQuota()');
  assert.equal(invalid.accounts.filter(account=>account.isActive).length,0,'Unreadable identity must not fall back to a saved account');
  fs.unlinkSync(authPath);
  const state=await evaluate(main,'window.codexAuth.getState()');
  assert.equal(state.accounts.filter(a=>a.isActive).length,0,'Missing credentials must not mark any saved account current');
  const summary=await evaluate(main,'window.codexAuth.getAllAccountsQuota()');
  assert.equal(summary.accounts.filter(a=>a.isActive).length,0,'Quota summary must not fall back to the last switched account');
  const dashboard=await evaluate(main,'window.codexAuth.getDashboard()');
  assert.equal(dashboard.scope.accountId,null,'Dashboard must not attach absent credentials to an old account');
  await evaluate(meter,'load()');
  assert.notEqual(await evaluate(meter,'document.querySelector("#selection-state").textContent'),'当前账号');
  await until(()=>evaluate(main,'document.querySelectorAll(".account-card.selected").length===0'),'logged-out main marker clears');
  console.log('PASS: absent credentials clear current-account flags in UI and quota APIs');
  assert.ok(!JSON.stringify(state).includes('SYNTHETIC-'),'Credentials never cross public IPC');
  clearTimeout(timeout);console.log('ACCOUNT DISPLAY PASS ('+(packaged?'packaged':'source')+'): switches, external login, pending choice, workspace isolation, rollback and logout');app.exit(0);
})().catch(error=>{console.error('ACCOUNT DISPLAY FAIL:',error.message);app.exit(1)});
