'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {safeRelative,metadata,atomic,readJson,key,inside}=require('./files');
const SOURCES=[{repo:'openai/skills',name:'OpenAI',description:'官方 Codex 技能目录',prefix:'skills/.curated/'},{repo:'anthropics/skills',name:'Anthropic',description:'写作、设计与开发技能',prefix:'skills/'},{repo:'K-Dense-AI/claude-scientific-skills',name:'科研工具箱',description:'科研分析、文献与可视化技能',prefix:'skills/'}];
function repository(value){const s=String(value||'').trim().replace(/^https:\/\/github\.com\//i,'').replace(/\/$/,'').replace(/\.git$/,'');if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(s)||s.split('/').some(x=>x==='.'||x==='..'))throw Error('请输入 GitHub 仓库地址，例如 owner/repository。');return s;}
function reference(value){const ref=value===undefined||value===''?'HEAD':value;if(typeof ref!=='string'||ref.length>150||/[\x00-\x20?#]/.test(ref))throw Error('分支或版本格式无效。');return ref;}
async function download(url,{fetcher=fetch,max=8*1024*1024,token}={}){
  const headers={'User-Agent':'Codex-Auth-Manager','Accept':'application/vnd.github+json'};
  if(token&&new URL(url).origin==='https://api.github.com')headers.Authorization='Bearer '+token;
  const response=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();const limited=response.status===429||response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||!!response.headers.get('retry-after'));const seconds=Number(response.headers.get('retry-after')),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;const retryAt=limited?Math.max(Date.now()+60000,seconds>0?Date.now()+seconds*1000:reset||0):0;throw Object.assign(Error(response.status===401?'GitHub Token 无效或已过期，请更新或移除。':limited?`GitHub API 暂时限流，预计 ${new Date(retryAt).toLocaleTimeString('zh-CN')} 后恢复。`:`GitHub 请求失败（${response.status}）。`),{status:response.status,limited,retryAt});}
  const parts=[];let length=0;for await(const part of response.body){length+=part.length;if(length>max)throw Error('下载内容超过大小限制。');parts.push(part)}return Buffer.concat(parts);
}
function createMarketplace({root,fetcher=fetch,getToken=async()=>null}){
  const previews=new Map(),catalogs=new Map(),pending=new Map();const cooldowns=new Map();
  const archive=options=>require('./archive').archiveTree({...options,download:(url,options)=>download(url,{...options,fetcher})});
  const json=async (url,token)=>JSON.parse((await download(url,{fetcher,token})).toString('utf8'));
  async function catalog(input={}){
    const repo=repository(input.repo||SOURCES[0].repo),ref=reference(input.ref);
    const token=await getToken(),identity=token?key(token):'anonymous';
    const id=repo+'@'+ref+':'+identity;if(pending.has(id))return pending.get(id);
    const task=readCatalog(repo,ref,input.force,token,identity);pending.set(id,task);try{return await task}finally{pending.delete(id)}
  }
  async function readCatalog(repo,ref,force,token,identity){
    const cooldownFile=path.join(root,token?'api-cooldown-'+identity+'.json':'api-cooldown.json');
    let cooldown=cooldowns.get(identity);
    const cacheFile=path.join(root,'catalog-'+key(repo+'@'+ref)+'.json'),cached=catalogs.get(repo+'@'+ref)||await readJson(cacheFile,null);
    if(cached&&!force&&Date.now()-Date.parse(cached.fetchedAt)<600000){catalogs.set(repo+'@'+ref,cached);return cached;}
    const prefix=SOURCES.find(s=>s.repo.toLowerCase()===repo.toLowerCase())?.prefix;let commit,files,transport='api',notice='';
    try{
      try{
        if(cooldown===undefined){cooldown=await readJson(cooldownFile,{until:0});cooldowns.set(identity,cooldown)}
        if(cooldown.until>Date.now())throw Object.assign(Error(`GitHub API 暂时限流，预计 ${new Date(cooldown.until).toLocaleTimeString('zh-CN')} 后恢复。`),{limited:true,retryAt:cooldown.until});
        if(token){const info=await json(`https://api.github.com/repos/${repo}`,token);if(info.private)throw Object.assign(Error('技能商店仅支持公开仓库。'),{status:404});}
        const result=await json(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,token);if(!/^[a-f0-9]{40}$/.test(result.sha))throw Error('GitHub 未返回有效版本。');commit=result.sha;
        const tree=await json(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`,token);if(tree.truncated||!Array.isArray(tree.tree))throw Error('仓库目录过大或不完整。');files=tree.tree;
      }catch(error){
        if(error.limited){cooldown={until:error.retryAt};cooldowns.set(identity,cooldown);await atomic(cooldownFile,JSON.stringify(cooldown));}
        if(error.status===401)throw error;
        if(cached)return {...cached,stale:true,warning:error.message};
        if(error.status===404)throw error;
        const snapshot=await archive({repo,ref,prefix});commit=snapshot.commit;files=snapshot.files;transport='archive';notice=error.limited?'GitHub API 限流，已通过官方仓库快照读取，可正常预览和安装。':'已通过官方仓库快照读取技能目录。';
      }
      const items=files.filter(f=>f.type==='blob'&&(f.path==='SKILL.md'||f.path.endsWith('/SKILL.md'))&&(!prefix||f.path.startsWith(prefix))&&!f.path.split('/').includes('.system')).map(f=>{safeRelative(f.path);const folder=f.path==='SKILL.md'?'':f.path.slice(0,-9);return {id:key(repo+'/'+folder),repo,ref,commit,folder,name:folder.split('/').pop()||repo.split('/')[1],url:`https://github.com/${repo}/tree/${commit}/${folder}`}});
      const value={repo,ref,commit,transport,notice,fetchedAt:new Date().toISOString(),items:items.slice(0,500),total:items.length,limited:items.length>500,files};await atomic(cacheFile,JSON.stringify(value));catalogs.set(repo+'@'+ref,value);return value;
    }catch(error){if(cached)return {...cached,stale:true,warning:error.message};throw Error('暂时无法读取技能商店：'+error.message+' 请检查网络后重试；无需修改 Codex 登录。');}
  }
  function publicCatalog(value){const {files,...result}=value;return result;}
  async function preview(input){
    const cat=await catalog(input),item=cat.items.find(x=>x.id===input.id);if(!item)throw Error('技能目录已变化，请刷新商店。');
    const prefix=item.folder?item.folder+'/':'';
    const files=cat.files.filter(f=>f.path.startsWith(prefix)&&f.type!=='tree');
    if(!files.length||files.length>500)throw Error('单个技能最多安装 500 个文件。');
    let bytes=0;const paths=new Set();for(const f of files){safeRelative(f.path);const relative=f.path.slice(prefix.length);safeRelative(relative);if(paths.has(relative.toLowerCase()))throw Error('仓库包含大小写冲突文件。');paths.add(relative.toLowerCase());if(f.type!=='blob'||!['100644','100755'].includes(f.mode))throw Error('技能包含符号链接或子模块，不能直接安装。');bytes+=f.size||0;if(f.size>2*1024*1024||bytes>20*1024*1024)throw Error('技能超过单文件 2 MB / 总计 20 MB 上限。');}
    const raw=file=>`https://raw.githubusercontent.com/${item.repo}/${item.commit}/${file.split('/').map(encodeURIComponent).join('/')}`;
    const body=(await download(raw(prefix+'SKILL.md'),{fetcher,max:512000})).toString('utf8');const info=metadata(body);
    const licenseFile=cat.files.find(f=>f.type==='blob'&&/^(LICENSE|LICENCE|COPYING)(\.[\w-]+)?$/i.test(f.path));
    const license=licenseFile?(await download(raw(licenseFile.path),{fetcher,max:256000})).toString('utf8'):'仓库根目录未发现许可证；请先确认使用许可。';
    const token=crypto.randomUUID();if(previews.size>=20)previews.delete(previews.keys().next().value);
    previews.set(token,{item,files,body,license,licensePath:licenseFile?.path,expires:Date.now()+600000});
    return {token,...item,...info,body,license,fileCount:files.length,bytes,stale:!!cat.stale};
  }
  async function install(token,bank){
    const p=previews.get(token);if(!p||p.expires<Date.now())throw Error('安装预览已过期，请重新查看。');
    const {item,files}=p,slug=item.name.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,45)||'skill';
    const target=path.join(bank,`cam-${slug}-${item.id.slice(0,8)}`);if(!inside(bank,target))throw Error('安装目标无效。');
    await fs.mkdir(bank,{recursive:true});try{await fs.lstat(target);throw Error('技能已存在，不覆盖现有文件。')}catch(e){if(e.code!=='ENOENT')throw e;}
    const staging=await fs.mkdtemp(path.join(bank,'.cam-install-'));const prefix=item.folder?item.folder+'/':'';let total=0;
    try{for(const file of files){const relative=safeRelative(file.path.slice(prefix.length)),dest=path.join(staging,...relative.split('/'));if(!inside(staging,dest))throw Error('安装文件超出目标目录。');
        const buffer=await download(`https://raw.githubusercontent.com/${item.repo}/${item.commit}/${file.path.split('/').map(encodeURIComponent).join('/')}`,{fetcher,max:2*1024*1024});
        total+=buffer.length;if(total>20*1024*1024)throw Error('技能下载超过 20 MB。');
        const digest=crypto.createHash('sha1').update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest('hex');if(digest!==file.sha)throw Error('下载文件与预览版本不一致。');
        await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,buffer,{mode:file.mode==='100755'?0o700:0o600});}
      const info=metadata(await fs.readFile(path.join(staging,'SKILL.md'),'utf8'));
      await fs.writeFile(path.join(staging,'.cam-origin.json'),JSON.stringify({...item,installedAt:new Date().toISOString()},null,2),{mode:0o600});
      if(p.licensePath)await fs.writeFile(path.join(staging,'.cam-repository-license.txt'),p.license,{mode:0o600});
      await fs.rename(staging,target);previews.delete(token);return {...info,folder:target,source:item};
    }finally{await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});}
  }
  return {sources:SOURCES,catalog:async input=>publicCatalog(await catalog(input)),preview,install};
}
module.exports={createMarketplace,repository,reference,SOURCES};
