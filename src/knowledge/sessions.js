const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const MAX_BYTES=32*1024*1024;
// No renderer-supplied paths are ever opened. Symlinks are excluded and real paths rechecked.
function createSessionLibrary(home){
  const refs=new Map();
  async function checked(file){const root=await fs.realpath(path.join(home,'sessions'));const actual=await fs.realpath(file);const rel=path.relative(root,actual);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('会话不在允许的目录中。');const stat=await fs.stat(actual);if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('会话文件超过 32 MB，请使用较小的会话。');return actual;}
  async function list(){
    const found=[];let visited=0;
    async function walk(dir,depth=0){if(depth>5)return;let entries;try{entries=await fs.readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e;}
      for(const entry of entries.sort((a,b)=>b.name.localeCompare(a.name))){if(++visited>12000)return;const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file,depth+1);else if(entry.isFile()&&entry.name.endsWith('.jsonl')){const stat=await fs.stat(file);found.push({file,mtime:stat.mtimeMs})}}
    }
    await walk(path.join(home,'sessions'));const items=[];let skipped=0;
    for(const f of found.sort((a,b)=>b.mtime-a.mtime).slice(0,300)){
      try{const file=await checked(f.file),handle=await fs.open(file,'r'),buffer=Buffer.alloc(65536);let bytesRead;try{({bytesRead}=await handle.read(buffer,0,buffer.length,0))}finally{await handle.close()}
        let meta={};for(const line of buffer.subarray(0,bytesRead).toString('utf8').split('\n')){try{const e=JSON.parse(line);if(e.type==='session_meta'){meta=e.payload||{};break}}catch{}}
        const id=crypto.createHash('sha256').update(file).digest('hex');refs.set(id,file);
        items.push({id,title:meta.cwd?path.basename(meta.cwd):path.basename(file,'.jsonl'),project:meta.cwd||'',sessionId:meta.id||path.basename(file,'.jsonl'),updatedAt:new Date(f.mtime).toISOString()});
      }catch{skipped++}
    }
    return {items,skipped,limited:found.length>300||visited>12000};
  }
  async function transcript(id){const file=refs.get(id);if(!file)throw Error('请重新加载会话列表。');const text=await fs.readFile(await checked(file),'utf8');const response=[],legacy=[];let invalidLines=0;
    for(const line of text.split('\n')){let e;try{e=JSON.parse(line)}catch{if(line.trim())invalidLines++;continue;}if(!e||typeof e!=='object')continue;const p=e.payload;
      if(e.type==='response_item'&&p?.type==='message'&&['user','assistant'].includes(p.role)&&(!p.channel||p.channel==='final')){
        const body=(Array.isArray(p.content)?p.content:[]).filter(c=>['input_text','output_text','text'].includes(c.type)).map(c=>c.text||'').join('\n');if(body.trim())response.push({role:p.role,text:body});
      }else if(e.type==='event_msg'&&['user_message','agent_message'].includes(p?.type)&&typeof p.message==='string'){legacy.push({role:p.type==='user_message'?'user':'assistant',text:p.message});}
    }
    const all=response.length?response:legacy;const offset=Math.max(0,all.length-500);return {messages:all.slice(offset).map((m,i)=>({...m,index:i+offset,text:m.text.slice(0,20000),fingerprint:crypto.createHash('sha256').update(m.role+'\n'+m.text).digest('hex'),truncated:m.text.length>20000})),limited:offset>0,invalidLines};
  }
  return {list,transcript};
}
module.exports={createSessionLibrary};
