// Real Electron windows, isolated empty vault; never closes or switches Codex.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-window-smoke-'));
process.env.CODEX_HOME=path.join(temp,'codex');fs.mkdirSync(process.env.CODEX_HOME);
app.setPath('appData',temp);app.setPath('userData',path.join(temp,'profile'));
require(process.argv.includes('--packaged') ? '../release/win-unpacked/resources/app.asar/src/main.js' : '../src/main');
const timeout=setTimeout(()=>{console.error('WINDOW FAIL: timeout');app.exit(1)},30000);
const timer=setInterval(async()=>{
 const win=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('manager.html'));
 if(!win||win.webContents.isLoading())return;clearInterval(timer);
 try{
  if(process.platform==='darwin'){const {safeStorage}=require('electron');assert.equal(safeStorage.isEncryptionAvailable(),true);assert.equal(safeStorage.decryptString(safeStorage.encryptString('synthetic-window-check')),'synthetic-window-check');}
  let unexpectedQuit=false;
  const guard=event=>{unexpectedQuit=true;event.preventDefault()};
  app.on('before-quit',guard);
  win.close();
  assert.equal(unexpectedQuit,false,'Closing main without a meter must not quit');
  assert.equal(win.isDestroyed(),false);assert.equal(win.isVisible(),false);
  await win.webContents.executeJavaScript('window.codexAuth.showMainWindow()');
  assert.equal(win.isVisible(),true);
  await win.webContents.executeJavaScript('window.codexAuth.showWidget()');
  const meter=BrowserWindow.getAllWindows().find(w=>w.id!==win.id);
  win.close();assert.equal(win.isVisible(),false);assert.equal(meter.isVisible(),true);
  await win.webContents.executeJavaScript('window.codexAuth.showMainWindow();window.codexAuth.hideWidget()');
  win.close();assert.equal(win.isVisible(),false);assert.equal(unexpectedQuit,false);
  await win.webContents.executeJavaScript('window.codexAuth.showMainWindow()');
  assert.equal(win.isVisible(),true);
  app.removeListener('before-quit',guard);
  app.once('will-quit',()=>{clearTimeout(timeout);console.log('WINDOW PASS: close hides with absent, visible and hidden meter; reopen works; explicit quit exits.');});
  app.quit();
 }catch(error){console.error('WINDOW FAIL:',error.message);app.exit(1)}
},100);
