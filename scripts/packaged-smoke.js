// Launch ONLY the built application, with a separate vault and synthetic credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-package-smoke-'));
const home=path.join(temp,'codex');fs.mkdirSync(home);
const jwt=v=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(v)).toString('base64url')+'.synthetic';
const auth=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt({sub:'test',exp:2000000000,'https://api.openai.com/auth':{chatgpt_account_id:'packaged-test',chatgpt_plan_type:'prolite'}}),id_token:jwt({email:'test@example.invalid',sub:'test'}),refresh_token:'SYNTHETIC-PACKAGED-TEST'},last_refresh:new Date().toISOString()});
fs.writeFileSync(path.join(home,'auth.json'),auth);fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
const exe=path.resolve('release/win-unpacked/Codex Auth Manager.exe'),port=19337;
const env={...process.env,CODEX_HOME:home,CAM_DATA_ROOT:path.join(temp,'vault')};delete env.ELECTRON_RUN_AS_NODE;
// Compile an offline native CLI fixture and measure whether its console is visible.
const cliRoot=path.join(temp,'cli'),pkg=path.join(cliRoot,'node_modules','@openai','codex');
const nativePkg=path.join(pkg,'node_modules','@openai','codex-win32-x64');
const cliExe=path.join(nativePkg,'vendor','x86_64-pc-windows-msvc','bin','codex.exe');
fs.mkdirSync(path.dirname(cliExe),{recursive:true});fs.mkdirSync(path.join(pkg,'bin'));
fs.writeFileSync(path.join(cliRoot,'codex.cmd'),'@echo off\r\n');
fs.writeFileSync(path.join(pkg,'package.json'),'{"name":"@openai/codex"}');
fs.writeFileSync(path.join(nativePkg,'package.json'),'{"name":"@openai/codex-win32-x64"}');
fs.writeFileSync(path.join(pkg,'bin','codex.js'),'throw Error("Do not launch the npm wrapper")');
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -Path 'scripts/fixture-cli.cs' -OutputAssembly '${cliExe.replaceAll("'","''")}' -OutputType ConsoleApplication`],{windowsHide:true});
const pathKey=Object.keys(env).find(k=>k.toLowerCase()==='path')||'Path';env[pathKey]=cliRoot+path.delimiter+(env[pathKey]||'');
env.CAM_TEST_CLI_MARKER=path.join(temp,'queried');
const child=spawn(exe,[`--user-data-dir=${path.join(temp,'profile')}`,`--remote-debugging-port=${port}`],{env,windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sockets=[];
async function pages(){return fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())}
async function connect(target){
  const socket=new WebSocket(target.webSocketDebuggerUrl);sockets.push(socket);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let seq=0;const pending=new Map();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
  return {send,eval:async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Renderer exception');return r.result?.value}};
}
(async()=>{
  try{
    let target;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Packaged process exited early');try{target=(await pages()).find(p=>p.url.includes('manager.html'));if(target)break}catch{}await sleep(200)}
    assert.ok(target,'Packaged main window created');const main=await connect(target);
    for(let i=0;i<60;i++){if(await main.eval('!!window.codexAuth && !!document.querySelector("h1")'))break;await sleep(200)}
    const state=await main.eval('window.codexAuth.importCurrent("Packaged test account")');
    assert.equal(state.settings.proFiveHourEnabled,false);
    assert.equal(state.version,'0.3.6');assert.equal(state.accounts[0].planType,'prolite');
    assert.ok(!JSON.stringify(state).includes('SYNTHETIC-PACKAGED-TEST'));
    assert.equal(state.storeRoot,path.join(temp,'vault'));
    assert.equal(await main.eval('window.planLabel("prolite")'),'Pro 5x');
    assert.ok(await main.eval('Array.from(document.styleSheets).some(s=>s.href?.includes("aurora.css"))'));
    const frame=await main.eval('(()=>{document.querySelector(".page-scroll").scrollTop=10000;const h=document.querySelector(".topbar").getBoundingClientRect(),s=document.querySelector(".page-scroll").getBoundingClientRect();return {top:h.top,edge:h.bottom,scrollTop:s.top,root:window.scrollY,safe:document.querySelector(".top-right").getBoundingClientRect().right<=innerWidth-138}})()');
    assert.equal(frame.top,0);assert.equal(frame.root,0);assert.ok(frame.scrollTop>=frame.edge);assert.ok(frame.safe);
    await main.eval('window.codexAuth.setWindowTheme(true)');await main.eval('window.codexAuth.setWindowTheme(false)');
    await main.eval('window.codexAuth.showWidget()');
    let meterTarget;for(let i=0;i<80;i++){meterTarget=(await pages()).find(p=>p.url.includes('meter.html'));if(meterTarget)break;await sleep(150)}
    assert.ok(meterTarget,'Packaged meter loaded');const meter=await connect(meterTarget);
    for(let i=0;i<60;i++){if(await meter.eval('document.querySelector("#plan")?.textContent === "Pro 5x"'))break;await sleep(200)}
    assert.equal(await meter.eval('document.querySelector("#plan").textContent'),'Pro 5x');
    assert.equal(await meter.eval('document.querySelectorAll(".stat-icon svg").length'),3);
    await meter.eval('window.codexAuth.setWidgetTopmost(true)');
    assert.equal((await meter.eval('window.codexAuth.getWidgetTopmost()')).pinned,true);
    assert.equal(await meter.eval('document.querySelector("#session").textContent'),'—');
    assert.equal(await meter.eval('document.querySelector("#quota-title").textContent'),'每周额度');
    assert.equal(await meter.eval('document.querySelector("#weekly-section").hidden'),true);
    await main.eval('window.codexAuth.updateSettings({proFiveHourEnabled:true})');
    for(let i=0;i<60;i++){if(await meter.eval('document.querySelector("#quota-title").textContent')==='5 小时额度')break;await sleep(100)}
    assert.equal(await meter.eval('document.querySelector("#quota-title").textContent'),'5 小时额度','Setting broadcast updates meter');
    assert.equal(await meter.eval('document.querySelector("#weekly-section").hidden'),false);
    assert.equal((await main.eval('window.codexAuth.getState()')).settings.proFiveHourEnabled,true);

    await main.eval('window.codexAuth.updateSettings({proFiveHourEnabled:false})');
    fs.mkdirSync('output/playwright',{recursive:true});
    const shot=await meter.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('output/playwright/packaged-meter.png',Buffer.from(shot.data,'base64'));
    const mainShot=await main.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('output/playwright/packaged-main.png',Buffer.from(mainShot.data,'base64'));
    await main.eval('window.codexAuth.hideWidget()');
    await sleep(11000);
    assert.equal(fs.existsSync(path.join(temp,'queried')),false,'Startup, focus and periodic local refresh must not call the CLI');
    await main.eval('window.codexAuth.getState().then(s=>window.codexAuth.refreshOfficial(s.accounts[0].id))');
    for(let i=0;i<100&&!fs.existsSync(path.join(temp,'queried'));i++)await sleep(100);
    assert.ok(fs.existsSync(path.join(temp,'queried')),'Explicit official refresh invokes isolated synthetic CLI');
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'queried'))).consoleVisible,false,'Native quota process must have no visible console');
    assert.equal(fs.readFileSync(path.join(home,'auth.json'),'utf8'),auth);
    assert.ok(fs.existsSync('release/win-unpacked/resources/app.asar.unpacked/src/windows-codex.ps1'));
    console.log('PACKAGED PASS: EXE 0.3.6 startup, isolated vault, real IPC/DPAPI, Pro 5x, shared theme, native meter, pin, missing quota, unpacked Windows helper, current auth unchanged.');
    await main.eval('window.close()').catch(()=>{});
  }finally{for(const socket of sockets)socket.close();if(child.exitCode===null)child.kill();}
})().catch(e=>{console.error('PACKAGED FAIL:',e.message);process.exitCode=1});
