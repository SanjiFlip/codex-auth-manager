// Actual IPC and UI with isolated local data; no real network, browser or credentials.
const {app,BrowserWindow,dialog,shell}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-settings-smoke-'));
const home=path.join(temp,'codex');fs.mkdirSync(home);
process.env.CODEX_HOME=home;process.env.CAM_DATA_ROOT=path.join(temp,'vault');app.setPath('appData',temp);app.setPath('userData',path.join(temp,'electron'));
fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
const sessionDir=path.join(home,'sessions');fs.mkdirSync(sessionDir);
const timestamp=new Date().toISOString();
fs.writeFileSync(path.join(sessionDir,'rollout-synthetic-usage.jsonl'),[
  {type:'session_meta',timestamp,payload:{id:'synthetic-usage',timestamp,cwd:'SYNTHETIC-PRIVATE-PATH'}},
  {type:'turn_context',payload:{model:'fixture'}},
  {type:'response_item',payload:{type:'message',content:[{text:'SYNTHETIC-PRIVATE-CONTENT'}]}},
  {type:'event_msg',timestamp,payload:{type:'token_count',info:{total_token_usage:{total_tokens:100}}}}
].map(value=>JSON.stringify(value)).join('\n')+'\n');
// Exercise the actual statistics IPC with history, future records and a session
// continuing across the seven-day boundary. No real account or log is read.
const snapshot=new Date(),start=new Date(snapshot);start.setHours(0,0,0,0);start.setDate(start.getDate()-6);
const old=new Date(start);old.setDate(old.getDate()-2);
const yesterday=new Date(snapshot);yesterday.setDate(yesterday.getDate()-1);
const future=new Date(snapshot);future.setDate(future.getDate()+1);
function usageRecord(id,points){
  const first=points[0][0].toISOString();
  fs.writeFileSync(path.join(sessionDir,'rollout-'+id+'.jsonl'),[
    {type:'session_meta',timestamp:first,payload:{id,timestamp:first}},
    {type:'turn_context',payload:{model:'fixture'}},
    ...points.map(([date,total])=>({type:'event_msg',timestamp:date.toISOString(),payload:{type:'token_count',info:{total_token_usage:{total_tokens:total}}}})),
  ].map(JSON.stringify).join('\n')+'\n');
}
usageRecord('old',[[old,1000]]);
usageRecord('before-boundary',[[new Date(start.getTime()-1),900]]);
usageRecord('at-boundary',[[start,30]]);
usageRecord('future',[[future,2000]]);
usageRecord('continued',[[old,1000],[yesterday,1050],[snapshot,1070]]);
const packaged=process.argv.includes('--packaged');
const release=path.join(__dirname,'../release');
const source=packaged?path.join(release,process.platform==='darwin'?(process.arch==='arm64'?'mac-arm64':'mac'):'win-unpacked',...(process.platform==='darwin'?['Codex Auth Manager.app','Contents','Resources']:['resources']),'app.asar','src'):path.join(__dirname,'../src');
const lifecycle=require(path.join(source,process.platform==='darwin'?'mac-codex':'windows-codex'));
lifecycle.discover=async()=>({synthetic:true});lifecycle.stop=async()=>{};lifecycle.launch=async()=>{};
require(path.join(source,'official-account')).queryOfficialAccount=async()=>{throw Error('Synthetic offline service')};
const updates=require(path.join(source,'github-updates'));const original=updates.createUpdateChecker;
let requests=0,offline=false;const opened=[];
updates.createUpdateChecker=options=>original({...options,request:async()=>{
  requests++;if(offline)throw Error('Synthetic offline service');
  const tag='v99.0.0',name=updates.installerName('99.0.0',process.platform,process.arch);
  return [{tag_name:tag,draft:false,prerelease:true,assets:[{name,state:'uploaded',size:123,browser_download_url:`https://github.com/SanjiFlip/codex-auth-manager/releases/download/${tag}/${name}`}]}];
}});
shell.openExternal=async url=>{opened.push(url)};
let cancelSave=true,saveCalls=0;
const exported=path.join(temp,'usage.csv');
dialog.showSaveDialog=async()=>{saveCalls++;return cancelSave?{canceled:true}:{canceled:false,filePath:exported}};
require(path.join(source,'main'));
const timeout=setTimeout(()=>{console.error('SETTINGS SMOKE FAIL: timeout');app.exit(1)},60000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await app.whenReady();let win;
  for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));if(win&&!win.webContents.isLoading())break;await sleep(100)}
  assert.ok(win);const evaluate=code=>win.webContents.executeJavaScript(code);
  const until=async code=>{for(let i=0;i<200;i++){if(await evaluate(code))return;await sleep(50)}throw Error('UI condition timeout: '+code)};
  await until('Boolean(document.querySelector("[data-action=add]"))');
  assert.equal(requests,0,'startup must not query GitHub');
  await evaluate('document.querySelector("[data-page=settings]").click()');
  await until('Boolean(document.querySelector("[data-action=check-updates]"))');
  await until(`document.querySelector("#content").textContent.includes(${JSON.stringify('v'+app.getVersion())})`);
  await evaluate('document.querySelector("[data-action=check-updates]").click()');
  await until('document.querySelector("#modal").open&&Boolean(document.querySelector("[data-action=update-installer]"))');
  assert.equal(requests,1);assert.equal(opened.length,0,'checking alone must not open browser');
  await evaluate('document.querySelector("[data-action=update-installer]").click()');
  await until('!busy');assert.equal(opened.length,1);assert.ok(opened[0].endsWith(updates.installerName('99.0.0',process.platform,process.arch)));
  await evaluate('document.querySelector("[data-action=update-release]").click()');await until('!busy');
  assert.equal(opened[1],'https://github.com/SanjiFlip/codex-auth-manager/releases/tag/v99.0.0');
  assert.equal(requests,1,'opening uses recent validated result');
  assert.equal(await evaluate('window.codexAuth.openUpdate("https://example.invalid").then(()=>false,()=>true)'),true);
  await evaluate('document.querySelector("[data-action=close]").click();document.querySelector("[data-page=usage]").click()');
  await until('statistics?.tokenUsage?.totalTokens===200');
  const statisticsResult=await evaluate('window.codexAuth.getStatistics()');
  assert.equal(statisticsResult.sessionsAnalyzed,3,'multi-day session counts once in the week');
  assert.equal(statisticsResult.models[0].tokenUsage.totalTokens,200,'old/future usage excluded from model totals');
  assert.equal(statisticsResult.daily.reduce((sum,row)=>sum+row.tokenUsage.totalTokens,0),200);
  assert.equal(await evaluate('usageStats.summarize(statistics).todayTokens'),120);
  assert.equal(await evaluate('usageStats.summarize(statistics).todaySessions'),2);
  assert.equal(await evaluate('usageStats.summarize(statistics).weekTokens'),200);
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".panel .summary-value")].map(el=>el.textContent)'),['—','—','—','—'],'unrecorded components remain unknown in real renderer');
  await evaluate('document.querySelector("[data-action=statistics-export]").click()');await until('!busy');
  assert.equal(saveCalls,1);assert.equal(fs.existsSync(exported),false,'cancel writes nothing');
  cancelSave=false;
  await evaluate('document.querySelector("[data-action=statistics-export]").click()');await until('!busy');
  assert.equal(saveCalls,2);const csv=fs.readFileSync(exported,'utf8');assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('本机近7天总计'));assert.ok(!csv.includes(temp));
  assert.ok(csv.includes('"本机近7天总计","","","3","","","","","200"'),'actual raw log path preserves missing fields and the shared time window');
  assert.ok(csv.includes('"本机近7天模型","","fixture","3","","","","","200"'));
  assert.ok(!csv.includes('1000'));assert.ok(!csv.includes('2000'));
  assert.ok(!csv.includes('SYNTHETIC-PRIVATE'));
  for(const dark of [false,true]){await evaluate(`document.body.classList.toggle('dark',${dark})`);assert.equal(await evaluate('document.querySelector("#content").scrollWidth<=document.querySelector("#content").clientWidth'),true)}
  fs.mkdirSync('output/design',{recursive:true});
  win.showInactive();await sleep(220);
  fs.writeFileSync('output/design/statistics-unknown.png',(await win.webContents.capturePage()).toPNG());
  const other=new BrowserWindow({show:false,webPreferences:{preload:path.join(source,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  await other.loadURL('data:text/html,<title>isolated unauthorized window</title>');
  assert.equal(await other.webContents.executeJavaScript('window.codexAuth.checkForUpdates().then(()=>false,()=>true)'),true);
  assert.equal(await other.webContents.executeJavaScript('window.codexAuth.exportStatistics().then(()=>false,()=>true)'),true);other.destroy();
  assert.equal(saveCalls,2);assert.equal(fs.existsSync(path.join(home,'auth.json')),false);
  console.log('Settings smoke passed: runtime version, opt-in update check, platform links, cache, real seven-day IPC/UI/CSV, old and future exclusion, boundary baseline, unique sessions, unknown components, export/cancel, frame restriction, light/dark layout.');
  clearTimeout(timeout);app.exit(0);
})().catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});
