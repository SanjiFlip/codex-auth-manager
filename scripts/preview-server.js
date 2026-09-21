const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../src/ui');
const allowed=new Set(['knowledge.js','knowledge.css','manager.html','manager.css','manager.js','plans.js','statistics.js','aurora.css','meter.html','meter.css','meter.js']);
http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1)||'manager.html';
  if(!allowed.has(name)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');
  fs.createReadStream(path.join(root,name)).pipe(res);
}).listen(Number(process.env.CAM_PREVIEW_PORT||4317),'127.0.0.1',()=>console.log('Preview server ready.'));
