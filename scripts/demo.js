// UI preview has no preload, IPC bridge, account access or Codex process control.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('temp'), 'codex-auth-manager-demo'));
app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);
  const win=new BrowserWindow({width:1240,height:880,title:'Codex Auth Manager · 演示',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.setWindowOpenHandler(({url})=>{
    const target=new URL(url);if(target.protocol!=='file:'||!target.pathname.endsWith('/meter.html')||target.search!=='?demo=1')return {action:'deny'};
    const meter=new BrowserWindow({width:360,height:560,frame:false,transparent:true,resizable:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    meter.webContents.setWindowOpenHandler(()=>({action:'deny'}));meter.loadURL(url);return {action:'deny'};
  });
  win.loadFile(path.join(__dirname,'../src/ui/manager.html'),{query:{demo:'1'}});
});
app.on('window-all-closed',()=>app.quit());
