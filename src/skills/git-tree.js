'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {safeRelative}=require('./files');
// Public repositories only. Fetch commit/tree objects, never check out or run repository code.
async function gitTree({repo,ref,execute=promisify(execFile)}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||typeof ref!=='string'||ref.startsWith('-')||/[\x00-\x20]/.test(ref))throw Error('Git 仓库或引用无效。');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cam-skill-tree-'));
  const env={...process.env};for(const name of Object.keys(env))if(/^GIT_/i.test(name))delete env[name];
  Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(temp,'empty-config'),GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'',GCM_INTERACTIVE:'Never',GIT_NO_LAZY_FETCH:'1'});
  const options={cwd:temp,env,windowsHide:true,shell:false,timeout:90000,maxBuffer:24*1024*1024,encoding:'utf8'};
  const args=['-c','credential.helper=','-c','core.hooksPath='+path.join(temp,'no-hooks'),'-c','protocol.allow=never','-c','protocol.https.allow=always','-c','http.followRedirects=false','-c','http.lowSpeedLimit=1024','-c','http.lowSpeedTime=30'];
  const run=async values=>(await execute('git',[...args,...values],options)).stdout;
  try{
    await fs.writeFile(env.GIT_CONFIG_GLOBAL,'');await run(['init','--bare','--template=','.']);
    await run(['fetch','--depth=1','--filter=blob:none','--no-tags','https://github.com/'+repo+'.git',ref]);
    const commit=(await run(['rev-parse','FETCH_HEAD'])).trim();if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid commit');
    const listing=await run(['ls-tree','-r','-z','--full-tree',commit]),files=[];
    for(const line of listing.split('\0')){if(!line)continue;const match=line.match(/^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);if(!match)throw Error('Invalid tree');safeRelative(match[4]);files.push({mode:match[1],type:match[2],sha:match[3],path:match[4]});if(files.length>200000)throw Error('Tree too large');}
    return {commit,files};
  }catch(error){throw Error(error.code==='ENOENT'?'大仓库轻量读取需要 Git；也可在商店设置 GitHub Token 后通过 API 读取。':'Git 轻量目录读取失败，请检查网络，或设置 GitHub Token 后刷新；不会下载整个大仓库。');}
  finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
module.exports={gitTree};
