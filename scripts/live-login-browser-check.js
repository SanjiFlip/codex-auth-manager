// Opt-in live verification: opens an official authorization page, then cancels.
// Never completes authorization, saves an account, or touches the real CODEX_HOME.
const {app,shell}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {createLogin}=require('../src/official-login');
const root=fs.mkdtempSync(path.resolve('output/live-browser-check-'));
app.setPath('userData',path.join(root,'profile'));
let opened=false;
const login=createLogin({root:path.join(root,'pending'),save:async()=>{throw Error('This check must never save an account');},
 openBrowser:async url=>{await shell.openExternal(url);opened=true;console.log('SYSTEM_BROWSER_OPEN_ACCEPTED '+new URL(url).origin+new URL(url).pathname);},
 report:state=>{console.log(JSON.stringify({phase:state.phase,method:state.method,hasUrl:!!state.url,hasCode:!!state.deviceCode,browserFailed:!!state.browserError}));}});
app.whenReady().then(async()=>{
 let timer;
 try{
  await login.start('Live browser verification');
  await new Promise((resolve,reject)=>{let ticks=0;timer=setInterval(()=>{const s=login.state();if(opened&&s.method==='device'&&s.deviceCode)resolve();else if(s.phase==='error'||++ticks>200)reject(Error('Real login did not reach device code and browser open'));},100);});
  console.log('LIVE PASS: native CLI device authorization plus real shell.openExternal');
  await login.cancel();app.exit(0);
 }catch(error){console.error(error.message);await login.cancel();app.exit(1);}finally{clearInterval(timer);}
});
