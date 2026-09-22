'use strict';
const crypto=require('node:crypto'),yauzl=require('yauzl');
const {safeRelative}=require('./files');
function resolveRef(buffer,ref){
  const refs=new Map();
  for(let offset=0;offset<buffer.length;){
    const header=buffer.toString('ascii',offset,offset+4);if(!/^[a-f0-9]{4}$/i.test(header))throw Error('Git 仓库引用响应无效。');const n=parseInt(header,16);offset+=4;if(n<=2)continue;if(n<4||offset+n-4>buffer.length)throw Error('Git 仓库引用响应不完整。');
    const line=buffer.toString('utf8',offset,offset+n-4).split('\0')[0].trim();offset+=n-4;const match=line.match(/^([a-f0-9]{40}) (.+)$/);if(match)refs.set(match[2],match[1]);
  }
  const names=ref==='HEAD'?['HEAD']:ref.startsWith('refs/')?[ref]:['refs/heads/'+ref,'refs/tags/'+ref];
  for(const name of names){const commit=refs.get(name+'^{}')||refs.get(name);if(commit)return commit;}throw Error('公开仓库未找到指定分支或 Tag。');
}
async function zipTree(buffer,commit,prefix){
  const zip=await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value)));
  const files=[];let entries=0,expanded=0,root;
  try{return await new Promise((resolve,reject)=>{
    zip.on('error',reject);zip.on('end',()=>resolve(files));
    zip.on('entry',entry=>{(async()=>{
      if(++entries>50000)throw Object.assign(Error('仓库压缩包条目过多。'),{code:'ARCHIVE_LIMIT'});expanded+=entry.uncompressedSize;if(expanded>256*1024*1024)throw Object.assign(Error('仓库解压体积超过 256 MB 保护上限。'),{code:'ARCHIVE_LIMIT'});
      const parts=entry.fileName.split('/'),base=parts.shift();if(!root)root=base;if(base!==root||!base.endsWith('-'+commit))throw Error('仓库快照目录与固定提交不一致。');
      const name=parts.join('/');if(!name||entry.fileName.endsWith('/')){zip.readEntry();return;}safeRelative(name);
      const mode=entry.externalFileAttributes>>>16,type=mode&0o170000;
      const record={path:name,type:'blob',mode:type===0o120000?'120000':type&&type!==0o100000?type.toString(8):(mode&0o111?'100755':'100644'),size:entry.uncompressedSize,sha:null};
      if(entry.isEncrypted())throw Error('不支持加密仓库压缩包。');
      if(record.size<=2*1024*1024&&(!prefix||name.startsWith(prefix)||/^(LICENSE|LICENCE|COPYING)(\.[\w-]+)?$/i.test(name))){
        const stream=await new Promise((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error?reject(error):resolve(value)));
        const hash=crypto.createHash('sha1').update(Buffer.from(`blob ${record.size}\0`));let read=0;
        for await(const part of stream){read+=part.length;if(read>record.size||read>2*1024*1024){stream.destroy();throw Error('仓库文件解压长度不一致。');}hash.update(part)}
        if(read!==record.size)throw Error('仓库文件不完整。');record.sha=hash.digest('hex');
      }
      files.push(record);zip.readEntry();
    })().catch(reject);});zip.readEntry();
  });}finally{zip.close();}
}
async function archiveTree({repo,ref,prefix,download}){
  const commit=/^[a-f0-9]{40}$/i.test(ref)?ref.toLowerCase():resolveRef(await download(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`,{max:16*1024*1024}),ref);
  const zip=await download(`https://codeload.github.com/${repo}/zip/${commit}`,{max:64*1024*1024});
  return {commit,files:await zipTree(zip,commit,prefix)};
}
module.exports={resolveRef,zipTree,archiveTree};
