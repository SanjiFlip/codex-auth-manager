const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1024,height:1024,show:false,frame:false,transparent:true,webPreferences:{sandbox:true}});
  const svg=fs.readFileSync(path.join(__dirname,'../src/ui/assets/manager.svg'),'utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="margin:0;background:transparent"><style>svg{width:1024px;height:1024px}</style>'+svg+'</body>'));
  const rendered=await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname,'../src/ui/assets/manager-mac.png'),rendered.resize({width:1024,height:1024}).toPNG());
  if(process.argv.includes('--mac-only')){console.log('macOS icon generated from existing SVG.');app.exit(0);return;}
  const png=rendered.resize({width:256,height:256}).toPNG();
  fs.writeFileSync(path.join(__dirname,'../src/ui/assets/manager.png'),png);
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync(path.join(__dirname,'../src/ui/assets/manager.ico'),Buffer.concat([header,png]));
  console.log('Application PNG and ICO generated.');app.exit(0);
}).catch(()=>app.exit(1));
