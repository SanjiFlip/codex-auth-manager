'use strict';
const {spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const TOML=require('@iarna/toml');
const {resolveCli}=require('../official-login'),{stopChild}=require('../child-process-cleanup');
const {normalize}=require('./files');
async function readConfig(home){try{return TOML.parse(await fs.readFile(path.join(home,'config.toml'),'utf8'))}catch(e){if(e.code==='ENOENT')return {};throw Error('Codex 配置无法解析，未修改任何设置。')}}
async function selectorPath(value){if(typeof value!=='string')return '';try{return normalize(await fs.realpath(value))}catch{return normalize(value)}}
async function enabledFor(item,entries){let enabled=true;for(const rule of entries){if(rule.name===item.name||rule.path&&await selectorPath(rule.path)===normalize(item.file))enabled=rule.enabled!==false;}return enabled;}
async function patchEntries(entries,changes){const paths=new Set(changes.map(c=>normalize(c.path))),result=[];for(const entry of entries)if(!entry.path||!paths.has(await selectorPath(entry.path)))result.push(entry);return [...result,...changes];}
// Use Codex's versioned TOML editor, preserving unrelated settings and comments.
async function withConfigServer(home,action,{resolve=resolveCli,spawnProcess=spawn}={}){
  const cli=await resolve(),cwd=await fs.mkdtemp(path.join(os.tmpdir(),'cam-skills-config-'));
  const env={...process.env,CODEX_HOME:home};delete env.ELECTRON_RUN_AS_NODE;
  let child,lines,timer,childClosed,closed=false,id=0;const pending=new Map();
  const fail=message=>{closed=true;for(const p of pending.values())p.reject(Error(message));pending.clear();};
  try{
    child=spawnProcess(cli.command,[...cli.args,'app-server','--listen','stdio://','-c','analytics.enabled=false','-c','feedback.enabled=false'],{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    childClosed=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve)});
    child.stderr.resume();child.on('error',()=>fail('无法启动 Codex CLI 配置服务。'));child.on('close',()=>fail('Codex CLI 配置服务已退出。'));child.stdin.on('error',()=>fail('Codex CLI 配置通道已关闭。'));
    lines=createInterface({input:child.stdout});lines.on('line',line=>{if(line.length>4000000)return fail('配置响应超过限制。');let value;try{value=JSON.parse(line)}catch{return;}const call=pending.get(value.id);if(!call)return;pending.delete(value.id);value.error?call.reject(Error('Codex 拒绝配置更改，可能已被其他程序修改，请重新读取后重试。')):call.resolve(value.result);});
    const rpc=(method,params)=>new Promise((resolve,reject)=>{if(closed)return reject(Error('配置服务未启动。'));const next=id++;pending.set(next,{resolve,reject});child.stdin.write(JSON.stringify({id:next,method,params})+'\n');});
    return await Promise.race([(async()=>{await rpc('initialize',{clientInfo:{name:'codex_auth_manager_skills',version:require('../../package.json').version}});child.stdin.write('{"method":"initialized","params":{}}\n');return action(rpc)})(),new Promise((_,reject)=>{timer=setTimeout(()=>{fail('配置服务超时，请检查配置后重试。');reject(Error('配置服务超时，请检查配置后重试。'));},25000)})]);
  }finally{clearTimeout(timer);lines?.close();if(child&&child.exitCode==null&&child.signalCode==null)await stopChild(child);if(childClosed){let endTimer;await Promise.race([childClosed,new Promise(resolve=>{endTimer=setTimeout(resolve,3000)})]);clearTimeout(endTimer);}fail('配置操作已结束。');await fs.rm(cwd,{recursive:true,force:true}).catch(()=>{});}
}
async function writeSkillConfig(home,changes,options={}){
  return withConfigServer(home,async rpc=>{
    const response=await rpc('config/read',{includeLayers:true});
    const layer=response.layers?.find(l=>l.name.type==='user'&&!l.name.profile&&normalize(l.name.file)===normalize(path.join(home,'config.toml')));
    if(!layer?.version)throw Error('无法确认 Codex 用户配置版本，未写入设置。');
    const before=layer.config?.skills?.config||[],after=await patchEntries(before,changes);
    await rpc('config/batchWrite',{filePath:layer.name.file,expectedVersion:layer.version,edits:[{keyPath:'skills.config',value:after,mergeStrategy:'replace'}],reloadUserConfig:false});
    const actual=(await readConfig(home)).skills?.config||[];
    if(JSON.stringify(actual)!==JSON.stringify(after)){
      // TOML readers can reorder object keys; compare the meaning instead.
      const canonical=a=>JSON.stringify(a.map(e=>({path:e.path,name:e.name,enabled:e.enabled})));
      if(canonical(actual)!==canonical(after))throw Error('配置写入后核对不一致，请重新读取当前状态。');
    }
    return {before,after};
  },options);
}
module.exports={readConfig,enabledFor,patchEntries,writeSkillConfig,withConfigServer};
