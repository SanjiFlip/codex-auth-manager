'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {safeRelative,metadata,atomic,readJson,key,inside}=require('./files');
const SOURCES=[{repo:'openai/skills',name:'OpenAI',description:'官方 Codex 技能目录',prefix:'skills/.curated/'},{repo:'anthropics/skills',name:'Anthropic',description:'写作、设计与开发技能',prefix:'skills/'},{repo:'K-Dense-AI/scientific-agent-skills',name:'科研工具箱',description:'科研分析、文献与可视化技能',prefix:'skills/'}];
function repository(value){const s=String(value||'').trim().replace(/^https:\/\/github\.com\//i,'').replace(/\/$/,'').replace(/\.git$/,'');if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(s)||s.split('/').some(x=>x==='.'||x==='..'))throw Error('请输入 GitHub 仓库地址，例如 owner/repository。');return s.toLowerCase()==='k-dense-ai/claude-scientific-skills'?'K-Dense-AI/scientific-agent-skills':s;}
function reference(value){const ref=value===undefined||value===''?'HEAD':value;if(typeof ref!=='string'||ref.length>150||/[\x00-\x20?#]/.test(ref))throw Error('分支或版本格式无效。');return ref;}
async function download(url,{fetcher=fetch,max=8*1024*1024,token}={}){
  const headers={'User-Agent':'Codex-Auth-Manager','Accept':'application/vnd.github+json'};
  if(token&&new URL(url).origin==='https://api.github.com')headers.Authorization='Bearer '+token;
  const response=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();const limited=response.status===429||response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||!!response.headers.get('retry-after'));const seconds=Number(response.headers.get('retry-after')),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;const retryAt=limited?Math.max(Date.now()+60000,seconds>0?Date.now()+seconds*1000:reset||0):0;throw Object.assign(Error(response.status===401?'GitHub Token 无效或已过期，请更新或移除。':limited?`GitHub API 暂时限流，预计 ${new Date(retryAt).toLocaleTimeString('zh-CN')} 后恢复。`:`GitHub 请求失败（${response.status}）。`),{status:response.status,limited,retryAt});}
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Object.assign(Error('下载内容超过大小限制。'),{code:'DOWNLOAD_LIMIT'});}
  const parts=[];let length=0;for await(const part of response.body){length+=part.length;if(length>max)throw Object.assign(Error('下载内容超过大小限制。'),{code:'DOWNLOAD_LIMIT'});parts.push(part)}return Buffer.concat(parts);
}
function createMarketplace({root,fetcher=fetch,getToken=async()=>null,readGitTree=options=>require('./git-tree').gitTree(options)}){
  const previews=new Map(),catalogs=new Map(),pending=new Map();const cooldowns=new Map();
  const archive=options=>require('./archive').archiveTree({...options,download:(url,options)=>download(url,{...options,fetcher})});
  const json=async (url,token)=>JSON.parse((await download(url,{fetcher,token})).toString('utf8'));
  async function catalog(input={}){
    const repo=repository(input.repo||SOURCES[0].repo),ref=reference(input.ref);
    const token=await getToken(),identity=token?key(token):'anonymous';
    const id=repo+'@'+ref+':'+identity;
    if(!pending.has(id))pending.set(id,readCatalog(repo,ref,input.force,token,identity));
    const task=pending.get(id);try{const value=await task;if(token!==await getToken())throw Error('GitHub Token 已变化，请重新读取目录。');return value}finally{if(pending.get(id)===task)pending.delete(id)}
  }
  async function readCatalog(repo,ref,force,token,identity){
    const cooldownFile=path.join(root,token?'api-cooldown-'+identity+'.json':'api-cooldown.json');
    let cooldown=cooldowns.get(identity);
    const cacheKey=repo+'@'+ref+':'+identity,cacheFile=path.join(root,'catalog-'+key(repo+'@'+ref)+'.json');
    const memory=catalogs.get(cacheKey),disk=memory?null:await readJson(cacheFile,null),cached=memory||(disk?.format===2&&!disk.private?disk:null);
    if(cached&&!force&&Date.now()-Date.parse(cached.fetchedAt)<600000)return cached;
    const prefix=SOURCES.find(s=>s.repo.toLowerCase()===repo.toLowerCase())?.prefix;let commit,files,transport='api',notice='',isPrivate=!!cached?.private;
    try{
      try{
        if(cooldown===undefined){cooldown=await readJson(cooldownFile,{until:0});cooldowns.set(identity,cooldown)}
        if(cooldown.until>Date.now())throw Object.assign(Error(`GitHub API 暂时限流，预计 ${new Date(cooldown.until).toLocaleTimeString('zh-CN')} 后恢复。`),{limited:true,retryAt:cooldown.until});
        if(token){const info=await json(`https://api.github.com/repos/${repo}`,token);isPrivate=info.private===true;}
        const result=await json(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,token);if(!/^[a-f0-9]{40}$/.test(result.sha))throw Error('GitHub 未返回有效版本。');commit=result.sha;
        files=await readTree(repo,commit,token,prefix);
      }catch(error){
        if(error.limited){cooldown={until:error.retryAt};cooldowns.set(identity,cooldown);await atomic(cooldownFile,JSON.stringify(cooldown));}
        if([401,404].includes(error.status)||error.status===403&&!error.limited||isPrivate)throw error;
        if(cached)return {...cached,stale:true,warning:error.message};
        if(repo.toLowerCase()==='k-dense-ai/scientific-agent-skills'){
          const snapshot=await readGitTree({repo,ref});commit=snapshot.commit;files=snapshot.files;transport='git';notice='已通过 Git 轻量目录读取；安装时仅下载所选技能文件。';
        }else{
          let snapshot;try{snapshot=await archive({repo,ref,prefix});transport='archive';notice=error.limited?'GitHub API 限流，已通过官方仓库快照读取，可正常预览和安装。':'已通过官方仓库快照读取技能目录。';}
          catch(fallbackError){if(!['DOWNLOAD_LIMIT','ARCHIVE_LIMIT'].includes(fallbackError.code))throw fallbackError;snapshot=await readGitTree({repo,ref});transport='git';notice='仓库快照过大，已改用 Git 轻量目录；安装时仅下载所选技能文件。';}
          commit=snapshot.commit;files=snapshot.files;
        }
      }
      const items=files.filter(f=>f.type==='blob'&&(f.path==='SKILL.md'||f.path.endsWith('/SKILL.md'))&&(!prefix||f.path.startsWith(prefix))&&!f.path.split('/').includes('.system')).map(f=>{safeRelative(f.path);const folder=f.path==='SKILL.md'?'':f.path.slice(0,-9);return {id:key(repo+'/'+folder),repo,ref,commit,folder,name:folder.split('/').pop()||repo.split('/')[1],url:`https://github.com/${repo}/tree/${commit}/${folder}`}});
      const value={format:2,repo,ref,commit,transport,notice,private:isPrivate,identity,fetchedAt:new Date().toISOString(),items,total:items.length,limited:false,files};
      if(!isPrivate){const {identity:unused,...persisted}=value;await atomic(cacheFile,JSON.stringify(persisted));}
      if(catalogs.size>=16)catalogs.delete(catalogs.keys().next().value);catalogs.set(cacheKey,value);return value;
    }catch(error){if(cached&&!isPrivate&&![401,403,404].includes(error.status))return {...cached,stale:true,warning:error.message};catalogs.delete(cacheKey);throw Error('暂时无法读取技能商店：'+error.message+(error.status===404?' 仓库不存在或无访问权限；私有仓库请设置有该仓库 Contents 读取权限的 GitHub Token。':' 请检查网络或 GitHub Token 后重试。'));}
  }
  // GitHub may truncate recursive trees. Descend into subtrees instead of downloading an archive.
  async function readTree(repo,commit,token,prefix){
    let requests=0,entries=0;
    async function walk(sha,base=''){
      if(++requests>1000)throw Error('仓库目录请求过多，请选择技能子仓库。');
      const tree=await json(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,token);
      if(!Array.isArray(tree.tree))throw Error('仓库目录响应不完整。');
      if(!tree.truncated){entries+=tree.tree.length;if(entries>200000)throw Error('仓库目录条目超过安全上限。');return tree.tree.map(f=>({...f,path:base+f.path}));}
      const shallow=await json(`https://api.github.com/repos/${repo}/git/trees/${sha}`,token);
      if(shallow.truncated||!Array.isArray(shallow.tree))throw Error('仓库子目录响应不完整。');
      const out=[];for(const f of shallow.tree){safeRelative(f.path);const full=base+f.path;
        if(f.type==='tree'){if(!prefix||full.startsWith(prefix)||prefix.startsWith(full+'/'))out.push(...await walk(f.sha,full+'/'));}
        else{if(++entries>200000)throw Error('仓库目录条目超过安全上限。');out.push({...f,path:full});}
      }return out;
    }
    return walk(commit);
  }
  function publicCatalog(value){const {files,identity,...result}=value;return result;}
  async function readFile(item,file,max,privateAccess){
    if(!file||!/^[a-f0-9]{40}$/.test(file.sha))throw Error('技能文件摘要无效，请刷新目录。');
    let buffer;
    if(privateAccess){const token=await getToken();if(!token||key(token)!==privateAccess)throw Error('GitHub Token 已变化，请重新预览技能。');
      const value=JSON.parse((await download(`https://api.github.com/repos/${item.repo}/git/blobs/${file.sha}`,{fetcher,token,max:max*2+4096})).toString('utf8'));
      if(value.encoding!=='base64'||typeof value.content!=='string')throw Error('GitHub 文件响应无效。');buffer=Buffer.from(value.content,'base64');
    }else buffer=await download(`https://raw.githubusercontent.com/${item.repo}/${item.commit}/${file.path.split('/').map(encodeURIComponent).join('/')}`,{fetcher,max});
    if(buffer.length>max)throw Error('下载内容超过大小限制。');
    const digest=crypto.createHash('sha1').update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest('hex');if(digest!==file.sha)throw Error('下载文件与预览版本不一致。');return buffer;
  }
  async function preview(input){
    const cat=await catalog(input),item=cat.items.find(x=>x.id===input.id);if(!item)throw Error('技能目录已变化，请刷新商店。');
    const prefix=item.folder?item.folder+'/':'';
    const files=cat.files.filter(f=>f.path.startsWith(prefix)&&f.type!=='tree');
    if(!files.length||files.length>500)throw Error('单个技能最多安装 500 个文件。');
    let bytes=0;const paths=new Set();for(const f of files){safeRelative(f.path);const relative=f.path.slice(prefix.length);safeRelative(relative);if(paths.has(relative.toLowerCase()))throw Error('仓库包含大小写冲突文件。');paths.add(relative.toLowerCase());if(f.type!=='blob'||!['100644','100755'].includes(f.mode))throw Error('技能包含符号链接或子模块，不能直接安装。');bytes+=f.size||0;if(f.size>2*1024*1024||bytes>20*1024*1024)throw Error('技能超过单文件 2 MB / 总计 20 MB 上限。');}
    const privateAccess=cat.private?cat.identity:null;
    const body=(await readFile(item,files.find(f=>f.path===prefix+'SKILL.md'),512000,privateAccess)).toString('utf8');const info=metadata(body);
    const licenseFile=cat.files.find(f=>f.type==='blob'&&/^(LICENSE|LICENCE|COPYING)(\.[\w-]+)?$/i.test(f.path));
    const license=licenseFile?(await readFile(item,licenseFile,256000,privateAccess)).toString('utf8'):'仓库根目录未发现许可证；请先确认使用许可。';
    const token=crypto.randomUUID();if(previews.size>=20)previews.delete(previews.keys().next().value);
    previews.set(token,{item,files,body,license,privateAccess,licensePath:licenseFile?.path,expires:Date.now()+600000});
    return {token,...item,...info,body,license,fileCount:files.length,bytes:files.some(f=>f.size===undefined)?null:bytes,stale:!!cat.stale};
  }
  async function install(token,bank){
    const p=previews.get(token);if(!p||p.expires<Date.now())throw Error('安装预览已过期，请重新查看。');
    if(p.privateAccess){const credential=await getToken();if(!credential||key(credential)!==p.privateAccess)throw Error('GitHub Token 已变化，请重新预览技能。');}
    const {item,files}=p,slug=item.name.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,45)||'skill';
    const target=path.join(bank,`cam-${slug}-${item.id.slice(0,8)}`);if(!inside(bank,target))throw Error('安装目标无效。');
    await fs.mkdir(bank,{recursive:true});try{await fs.lstat(target);throw Error('技能已存在，不覆盖现有文件。')}catch(e){if(e.code!=='ENOENT')throw e;}
    const staging=await fs.mkdtemp(path.join(bank,'.cam-install-'));const prefix=item.folder?item.folder+'/':'';let total=0;
    let next=0,failed;
    async function worker(){try{while(next<files.length&&!failed){const file=files[next++],relative=safeRelative(file.path.slice(prefix.length)),dest=path.join(staging,...relative.split('/'));if(!inside(staging,dest))throw Error('安装文件超出目标目录。');
        const buffer=await readFile(item,file,2*1024*1024,p.privateAccess);
        total+=buffer.length;if(total>20*1024*1024)throw Error('技能下载超过 20 MB。');
        await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,buffer,{mode:file.mode==='100755'?0o700:0o600});}
      }catch(error){failed=error;}}
    try{await Promise.all(Array.from({length:Math.min(4,files.length)},worker));if(failed)throw failed;
      const info=metadata(await fs.readFile(path.join(staging,'SKILL.md'),'utf8'));
      await fs.writeFile(path.join(staging,'.cam-origin.json'),JSON.stringify({...item,installedAt:new Date().toISOString()},null,2),{mode:0o600});
      if(p.licensePath)await fs.writeFile(path.join(staging,'.cam-repository-license.txt'),p.license,{mode:0o600});
      await fs.rename(staging,target);previews.delete(token);return {...info,folder:target,source:item};
    }finally{await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});}
  }
  return {sources:SOURCES,catalog:async input=>publicCatalog(await catalog(input)),preview,install};
}
module.exports={createMarketplace,repository,reference,SOURCES};
