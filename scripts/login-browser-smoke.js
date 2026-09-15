// Exercise real main/preload/UI; replace only the CLI and OS browser boundary.
const {app,BrowserWindow,shell}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cam-browser-smoke-'));
process.env.CODEX_HOME=path.join(root,'home');process.env.CAM_DATA_ROOT=path.join(root,'vault');
fs.mkdirSync(process.env.CODEX_HOME);app.setPath('userData',path.join(root,'profile'));
let child;const opened=[];
shell.openExternal=async url=>{opened.push(url);if(opened.length===1)throw Error('Synthetic default browser failure');};
const codeRoot=process.argv.includes('--packaged')?path.resolve('release/win-unpacked/resources/app.asar/src'):path.resolve(__dirname,'../src');
const moduleLogin=require(path.join(codeRoot,'official-login')),original=moduleLogin.createLogin;
moduleLogin.createLogin=options=>original({...options,resolve:async()=>({command:'synthetic',args:[]}),
  spawnProcess:()=>{child=new EventEmitter();child.pid=98765;child.stdout=new PassThrough();child.stderr=new PassThrough();return child;},
  stopProcess:async()=>child.emit('close',1)});
require(path.join(codeRoot,'main'));
const timeout=setTimeout(()=>{console.error('BROWSER SMOKE timeout');app.exit(1)},30000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await sleep(100)}throw Error('Condition timed out');}
(async()=>{
  let win;
  await until(()=>{win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('manager.html'));return win&&!win.webContents.isLoading();});
  const run=code=>win.webContents.executeJavaScript(code);
  await until(()=>run(`Boolean(window.codexAuth&&document.querySelector('[data-action="add"]'))`));
  await run(`document.querySelector('[data-action="add"]').click()`);
  await run(`document.querySelector('[data-action="login"]').click()`);
  await until(()=>Boolean(child));
  child.stderr.write('Open https://auth.openai.com/oauth/authorize?state=synthetic\n');
  await until(()=>run(`document.querySelector('#login-status').textContent.includes('无法打开默认浏览器')`));
  assert.equal(opened.length,1);
  assert.equal(await run(`document.querySelector('#open-login').disabled`),false);
  await run(`document.querySelector('#open-login').click()`);
  await until(()=>opened.length===2);
  await until(()=>run(`document.querySelector('#login-status').textContent.includes('请在浏览器')`));
  assert.equal(opened[1],'https://auth.openai.com/oauth/authorize?state=synthetic');
  await run(`window.codexAuth.cancelLogin()`);
  assert.equal(await run(`document.querySelector('#open-login').disabled`),true);
  assert.deepEqual(fs.readdirSync(path.join(root,'vault','pending-logins')),[]);
  console.log('BROWSER SMOKE PASS: add button -> login IPC -> desktop browser opener -> visible failure -> retry -> cancellation.');
  clearTimeout(timeout);app.exit(0);
})().catch(error=>{console.error('BROWSER SMOKE FAIL:',error.message);app.exit(1);});
