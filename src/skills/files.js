'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const YAML=require('yaml');
const key=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,24);
const normalize=value=>{const p=path.resolve(value).replace(/^\\\\\?\\/,'');return process.platform==='win32'?p.toLowerCase():p;};
function inside(root,file){const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function safeRelative(value){
  if(typeof value!=='string'||!value||value.length>500||value.includes('\\')||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('仓库文件路径不安全，已停止安装。');
  return value;
}
function metadata(body){
  if(typeof body!=='string'||Buffer.byteLength(body)>512000)throw Error('SKILL.md 过大。');
  const match=body.replace(/^\uFEFF/,'').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!match||match[1].length>16000)throw Error('SKILL.md 缺少有效 YAML 元数据。');
  let data;try{data=YAML.parse(match[1],{maxAliasCount:0,uniqueKeys:true})}catch{throw Error('SKILL.md 的 YAML 元数据无法解析。');}
  if(typeof data?.name!=='string'||!data.name.trim()||data.name.length>100||typeof data.description!=='string'||!data.description.trim()||data.description.length>8000)throw Error('Skill 需要有效的 name 与 description。');
  return {name:data.name.trim(),description:data.description.trim()};
}
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,value,{mode:0o600});await fs.rename(temp,file)}finally{await fs.rm(temp,{force:true}).catch(()=>{})}}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw Error('Skills 数据无法读取，已保留原文件。')}}
async function inventory(roots){
  const entries=new Map(),warnings=[];
  for(const root of roots){let children;try{children=await fs.readdir(root,{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')warnings.push('无法读取技能目录：'+root);continue;}
    for(const entry of children.slice(0,1000)){
      if(entry.name.startsWith('.')||(!entry.isDirectory()&&!entry.isSymbolicLink()))continue;
      const folder=path.join(root,entry.name),file=path.join(folder,'SKILL.md');
      try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>512000)continue;const real=await fs.realpath(file),id=key(normalize(real)),info=metadata(await fs.readFile(real,'utf8'));
        const previous=entries.get(id);if(previous)previous.aliases.push(file);else entries.set(id,{id,...info,file:real,folder:path.dirname(real),aliases:[file]});
      }catch(e){if(e.code!=='ENOENT')warnings.push(entry.name+'：'+(e.code?'文件不可读':e.message));}
    }
    if(children.length>1000)warnings.push('目录条目超过 1000，仅显示前 1000 项。');
  }
  return {items:[...entries.values()],warnings};
}
module.exports={key,normalize,inside,safeRelative,metadata,atomic,readJson,inventory};
