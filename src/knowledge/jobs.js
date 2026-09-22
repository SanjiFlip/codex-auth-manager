'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
// One recoverable task at a time. Each validated model result is an atomic encrypted file.
function createJobStore({root,encrypt,decrypt}){
  const manifest=path.join(root,'current.enc');
  const folder=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('任务标识无效。');return path.join(root,id)};
  const stepFile=(id,key)=>{if(!/^(extract-\d+|merge-\d+-\d+|final)$/.test(key))throw Error('检查点标识无效。');return path.join(folder(id),key+'.enc')};
  async function read(file){try{const raw=await fs.readFile(file,'utf8');return JSON.parse(await decrypt(raw))}catch(e){if(e.code==='ENOENT')return null;throw Error('蒸馏检查点无法解密或已损坏，原文件已保留。')}}
  async function write(file,value){const raw=await encrypt(JSON.stringify(value));await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,raw,{mode:0o600});await fs.rename(temp,file)}finally{await fs.rm(temp,{force:true}).catch(()=>{})}}
  return {
    async load(){const value=await read(manifest);if(!value)return null;if(value.version!==1||value.pipeline!==2||!value.request||!value.signature)throw Error('蒸馏任务版本不兼容，原文件已保留。');folder(value.id);const names=await fs.readdir(folder(value.id)).catch(e=>{if(e.code==='ENOENT')return [];throw e});return {...value,completed:names.filter(n=>/^(extract-\d+|merge-\d+-\d+|final)\.enc$/.test(n)).length};},
    async create(value){if(await read(manifest))throw Error('已有可恢复任务，请先继续或放弃。');await write(manifest,value)},
    readStep:(id,key)=>read(stepFile(id,key)),
    writeStep:(id,key,value)=>write(stepFile(id,key),value),
    async clear(id){const current=await read(manifest);if(current?.id!==id)throw Error('恢复任务已变化，请重新读取。');const target=path.resolve(folder(id)),base=path.resolve(root);if(path.dirname(target)!==base)throw Error('任务路径无效。');await fs.rm(manifest,{force:true});await fs.rm(target,{recursive:true,force:true});},
  };
}
// Tests can run without a filesystem, with the same checkpoint protocol.
function memoryJobStore(){let current=null;const steps=new Map();return {load:async()=>current&&({...structuredClone(current),completed:steps.size}),create:async value=>{if(current)throw Error('已有可恢复任务，请先继续或放弃。');current=structuredClone(value)},readStep:async(id,key)=>steps.get(id+':'+key),writeStep:async(id,key,value)=>steps.set(id+':'+key,structuredClone(value)),clear:async()=>{current=null;steps.clear()}}}
module.exports={createJobStore,memoryJobStore};
