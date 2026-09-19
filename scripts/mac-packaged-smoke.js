// Run only the native packaged Mac application with synthetic credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-mac-package-')),home=path.join(temp,'codex');fs.mkdirSync(home);
const jwt=v=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify(v)).toString('base64url')+'.synthetic';
const auth=JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:jwt({sub:'fixture',exp:2000000000,'https://api.openai.com/auth':{chatgpt_account_id:'fixture',chatgpt_plan_type:'prolite'}}),id_token:jwt({sub:'fixture',email:'fixture@example.invalid'}),refresh_token:'SYNTHETIC-MAC-PACKAGE'}});
fs.writeFileSync(path.join(home,'auth.json'),auth);fs.writeFileSync(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\n');
const exe=path.resolve('release',process.arch==='arm64'?'mac-arm64':'mac','Codex Auth Manager.app','Contents','MacOS','Codex Auth Manager');
const port=19339,env={...process.env,CODEX_HOME:home,CAM_DATA_ROOT:path.join(temp,'vault')};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(exe,[`--user-data-dir=${path.join(temp,'profile')}`,`--remote-debugging-port=${port}`],{env,stdio:'ignore'});
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
  let target;
  for(let i=0;i<120;i++){try{target=(await pages()).find(p=>p.url.includes('manager.html'));if(target)break}catch{}await sleep(250)}
  assert.ok(target,'Packaged main window available');const main=await connect(target);
  for(let i=0;i<60;i++){if(await main.eval('!!window.codexAuth && !!document.querySelector("h1")'))break;await sleep(200)}
  const state=await main.eval('window.codexAuth.importCurrent("Mac fixture")');
  assert.equal(state.version,require('../package.json').version);assert.equal(state.platform,'darwin');assert.equal(state.credentialProtection,'macOS Keychain');assert.equal(state.accounts.length,1);
  assert.equal(JSON.stringify(state).includes('SYNTHETIC-MAC-PACKAGE'),false);
  await main.eval('window.codexAuth.showWidget()');
  let widget;for(let i=0;i<60;i++){widget=(await pages()).find(p=>p.url.includes('meter.html'));if(widget)break;await sleep(100)}
  assert.ok(widget,'Packaged native meter available');const meter=await connect(widget);
  for(let i=0;i<60;i++){if(await meter.eval('document.querySelector("#plan")?.textContent==="Pro 5x"'))break;await sleep(100)}
  assert.equal(await meter.eval('document.querySelector("#plan").textContent'),'Pro 5x');
  assert.equal(fs.readFileSync(path.join(home,'auth.json'),'utf8'),auth);
  console.log('MAC PACKAGE PASS: native executable, Keychain account import, isolated vault, real IPC, Pro 5x and meter; original synthetic auth preserved.');
 }finally{for(const socket of sockets)socket.close();if(child.exitCode===null)child.kill();}
})().catch(error=>{console.error('MAC PACKAGE FAIL:',error.message);process.exitCode=1});
