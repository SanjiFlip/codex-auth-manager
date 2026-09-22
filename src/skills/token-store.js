'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {atomic}=require('./files');
function createTokenStore({root,encrypt,decrypt}){
  const file=path.join(root,'github-token.enc');
  async function status(){try{await fs.access(file);return {configured:true}}catch(e){if(e.code==='ENOENT')return {configured:false};throw Error('无法读取 GitHub Token 状态。')}}
  async function read(){let body;try{body=await fs.readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw Error('无法读取 GitHub Token，请重新保存或移除。')}
    try{if(!decrypt)throw Error();return validate(await decrypt(body))}catch{throw Error('无法解密 GitHub Token，请重新保存或移除。')}}
  function validate(value){if(typeof value!=='string'||!/^[-A-Za-z0-9_]{20,255}$/.test(value.trim()))throw Error('请输入有效的 GitHub Personal Access Token。');return value.trim()}
  async function save(value){const token=validate(value);let body;try{if(!encrypt)throw Error();body=await encrypt(token)}catch{throw Error('系统加密服务不可用，Token 未保存。')}
    try{await atomic(file,body)}catch{throw Error('GitHub Token 保存失败。')}return status();}
  async function remove(){try{await fs.rm(file,{force:true})}catch{throw Error('GitHub Token 移除失败。')}return status();}
  return {status,read,save,remove};
}
module.exports={createTokenStore};
