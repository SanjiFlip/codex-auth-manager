const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:256,height:256,show:false,frame:false,transparent:true,webPreferences:{sandbox:true}});
  const svg=fs.readFileSync(path.join(__dirname,'../src/ui/assets/manager.svg'),'utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="margin:0;background:transparent">'+svg+'</body>'));
  const png=(await win.webContents.capturePage()).resize({width:256,height:256}).toPNG();
  fs.writeFileSync(path.join(__dirname,'../src/ui/assets/manager.png'),png);
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync(path.join(__dirname,'../src/ui/assets/manager.ico'),Buffer.concat([header,png]));
  console.log('Application PNG and ICO generated.');app.exit(0);
}).catch(()=>app.exit(1));
