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
  await evaluate('document.querySelector("[data-action=statistics-export]").click()');await until('!busy');
  assert.equal(saveCalls,1);assert.equal(fs.existsSync(exported),false,'cancel writes nothing');
  cancelSave=false;
  await evaluate('document.querySelector("[data-action=statistics-export]").click()');await until('!busy');
  assert.equal(saveCalls,2);const csv=fs.readFileSync(exported,'utf8');assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('本机近7天总计'));assert.ok(!csv.includes(temp));
  assert.ok(csv.includes('"本机近7天总计","","","1","","","","","100"'),'actual raw log path preserves missing token fields');
  assert.ok(!csv.includes('SYNTHETIC-PRIVATE'));
  for(const dark of [false,true]){await evaluate(`document.body.classList.toggle('dark',${dark})`);assert.equal(await evaluate('document.querySelector("#content").scrollWidth<=document.querySelector("#content").clientWidth'),true)}
  const other=new BrowserWindow({show:false,webPreferences:{preload:path.join(source,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  await other.loadURL('data:text/html,<title>isolated unauthorized window</title>');
  assert.equal(await other.webContents.executeJavaScript('window.codexAuth.checkForUpdates().then(()=>false,()=>true)'),true);
  assert.equal(await other.webContents.executeJavaScript('window.codexAuth.exportStatistics().then(()=>false,()=>true)'),true);other.destroy();
  assert.equal(saveCalls,2);assert.equal(fs.existsSync(path.join(home,'auth.json')),false);
  console.log('Settings smoke passed: runtime version, opt-in update check, trusted platform links, cache, CSV export/cancel, frame restriction, light/dark layout.');
  clearTimeout(timeout);app.exit(0);
})().catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});
