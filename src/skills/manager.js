'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {inventory,key,normalize,atomic,readJson}=require('./files');
const {readConfig,createSkillMatcher,writeSkillConfig}=require('./config');
const {createMarketplace,repository,reference}=require('./github');
function createSkillsManager({root,home,userHome,bank=path.join(userHome,'.skillshub'),writeConfig=writeSkillConfig,fetcher,encrypt,decrypt,translationFetcher}){
  const file=path.join(root,'library.json'),codexSkills=path.join(home,'skills'),agentSkills=path.join(userHome,'.agents','skills');
  const translator=require('./translation').createTranslator({fetcher:translationFetcher});
  const tokens=require('./token-store').createTokenStore({root,encrypt,decrypt});
  const market=createMarketplace({root:path.join(root,'market'),fetcher,getToken:tokens.read});let queue=Promise.resolve();const plans=new Map();
  const initial=()=>({version:1,revision:0,groups:[{id:'common',name:'通用基础',skillIds:[]},{id:'daily',name:'日常',skillIds:[]},{id:'research',name:'科研',skillIds:[]}],activeGroupIds:[],managedIds:[],installed:[],history:[],customSources:[]});
  async function state(){const value=await readJson(file,initial());if(value.version!==1||!Array.isArray(value.groups)||!Array.isArray(value.installed))throw Error('Skills 分组文件格式无效。');if(value.customSources===undefined)value.customSources=[];if(!Array.isArray(value.customSources))throw Error('Skills 来源文件格式无效，原数据已保留。');return value;}
  async function save(value){value.revision++;await atomic(file,JSON.stringify(value,null,2));}
  function exclusive(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}
  async function scan(){const s=await state(),found=await inventory([bank,codexSkills,agentSkills]),config=await readConfig(home),enabledForItem=await createSkillMatcher(config.skills?.config||[]);
    for(const item of found.items){const source=s.installed.find(i=>i.id===item.id);item.source=source?.source||null;item.managed=!!source;item.linked=item.aliases.some(f=>normalize(path.dirname(path.dirname(f)))!==normalize(bank));item.enabled=item.linked&&enabledForItem(item);item.groupIds=s.groups.filter(g=>g.skillIds.includes(item.id)).map(g=>g.id);}
    return {...s,githubToken:await tokens.status(),items:found.items,warnings:found.warnings,bank,home,sources:[...market.sources.map(source=>({...source,id:'builtin:'+source.repo,ref:'HEAD',custom:false})),...s.customSources.map(source=>({...source,custom:true}))]};
  }
  function revision(s,value){if(s.revision!==value)throw Error('Skills 列表已变化，请刷新后重试。');}
  function groupIds(s,ids){if(!Array.isArray(ids)||ids.length>40||ids.some(id=>!s.groups.some(g=>g.id===id)))throw Error('请选择有效的分组。');return [...new Set(ids)];}
  async function install(input){return exclusive(async()=>{const s=await state();revision(s,input.revision);const groups=groupIds(s,input.groupIds);const installed=await market.install(input.token,bank);const real=await fs.realpath(path.join(installed.folder,'SKILL.md')),id=key(normalize(real));s.installed.push({id,...installed});for(const g of s.groups)if(groups.includes(g.id))g.skillIds.push(id);s.history.unshift({at:new Date().toISOString(),text:'安装 '+installed.name+'（未自动启用）'});await save(s);return scan();});}
  async function saveGroup(input){return exclusive(async()=>{const s=await state();revision(s,input.revision);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>40)throw Error('分组名称需为 1–40 个字符。');if(s.groups.some(g=>g.id!==input.id&&g.name===input.name.trim()))throw Error('分组名称已存在。');
    const found=await inventory([bank,codexSkills,agentSkills]),known=new Set(found.items.map(i=>i.id));if(!Array.isArray(input.skillIds)||input.skillIds.length>1000||input.skillIds.some(id=>!known.has(id)))throw Error('分组包含不可用技能，请重新读取。');
    let group=s.groups.find(g=>g.id===input.id);if(!group){if(input.id||s.groups.length>=40)throw Error('分组不存在或已达 40 个上限。');group={id:crypto.randomUUID()};s.groups.push(group);}Object.assign(group,{name:input.name.trim(),skillIds:[...new Set(input.skillIds)]});await save(s);return scan();});}
  async function removeGroup(input){return exclusive(async()=>{const s=await state();revision(s,input.revision);if(input.id==='common')throw Error('通用基础组不能删除。');if(s.activeGroupIds.includes(input.id))throw Error('请先切换或停用该组，再删除。');s.groups=s.groups.filter(g=>g.id!==input.id);await save(s);return scan();});}
  async function saveSource(input){return exclusive(async()=>{
    const s=await state();revision(s,input.revision);
    const repo=repository(input.repo).toLowerCase(),ref=reference(input.ref),name=typeof input.name==='string'?input.name.trim():'';
    if(!name||name.length>40)throw Error('来源名称需为 1–40 个字符。');
    let source=s.customSources.find(source=>source.id===input.id);
    if(input.id&&!source)throw Error('自定义来源不存在，内置来源不能修改。');
    if(s.customSources.some(source=>source.id!==input.id&&source.repo.toLowerCase()===repo&&source.ref===ref)||ref==='HEAD'&&market.sources.some(source=>source.repo.toLowerCase()===repo))throw Error('此仓库和版本已在发现技能中，请直接选择已有来源。');
    if(!source){if(s.customSources.length>=40)throw Error('自定义来源已达 40 个上限，请先移除不需要的来源。');source={id:crypto.randomUUID()};s.customSources.push(source);}
    Object.assign(source,{name,repo,ref});await save(s);return scan();
  });}
  async function removeSource(input){return exclusive(async()=>{
    const s=await state();revision(s,input.revision);if(!s.customSources.some(source=>source.id===input.id))throw Error('自定义来源不存在，内置来源不能移除。');
    s.customSources=s.customSources.filter(source=>source.id!==input.id);await save(s);return scan();
  });}
  async function plan(input){await queue;const s=await scan();revision(s,input.revision);const ids=groupIds(s,input.groupIds),wanted=new Set(s.groups.filter(g=>ids.includes(g.id)).flatMap(g=>g.skillIds)),controlled=new Set([...s.managedIds,...s.groups.flatMap(g=>g.skillIds)]);
    const missing=[...wanted].filter(id=>!s.items.some(i=>i.id===id));if(missing.length)throw Error('所选分组有技能已被移除，请先编辑分组。');
    const targets=s.items.filter(i=>controlled.has(i.id)),changes=targets.map(i=>({id:i.id,name:i.name,path:i.file,enabled:wanted.has(i.id),before:i.enabled,linked:i.linked,folder:i.folder}));
    const token=crypto.randomUUID();if(plans.size>20)plans.clear();plans.set(token,{revision:s.revision,ids,changes,expires:Date.now()+600000});
    return {token,enable:changes.filter(c=>c.enabled&&!c.before).map(c=>c.name),disable:changes.filter(c=>!c.enabled&&c.before).map(c=>c.name),groups:s.groups.filter(g=>ids.includes(g.id)).map(g=>g.name),unchanged:s.items.length-changes.filter(c=>c.before!==c.enabled).length};
  }
  async function apply(input){return exclusive(async()=>{const p=plans.get(input.token);if(!p||p.expires<Date.now())throw Error('切换预览已过期。');const s=await state();revision(s,p.revision);
    const links=[];for(const c of p.changes){const real=await fs.realpath(c.path);if(normalize(real)!==normalize(c.path))throw Error('技能路径已变化，请重新预览。');if(c.enabled&&!c.linked){const dest=path.join(codexSkills,'cam-'+path.basename(c.folder));try{await fs.lstat(dest);throw Error('Codex 中已有同名路径，未覆盖：'+path.basename(dest))}catch(e){if(e.code!=='ENOENT')throw e;}links.push({dest,source:c.folder});}}
    // Recovery record contains only skill rules, never the full credential-bearing config.
    const prior=(await readConfig(home)).skills?.config||[];
    await atomic(path.join(root,'last-apply.json'),JSON.stringify({at:new Date().toISOString(),previous:prior,changes:p.changes.map(c=>({path:c.path,enabled:c.enabled}))},null,2));
    await writeConfig(home,p.changes.map(c=>({path:c.path,enabled:c.enabled})));
    try{await fs.mkdir(codexSkills,{recursive:true});for(const link of links)await fs.symlink(link.source,link.dest,process.platform==='win32'?'junction':'dir');}
    catch{throw Error('Skills 配置已保存，但创建链接失败。请重新读取后再次应用；恢复记录已保留。');}
    s.activeGroupIds=p.ids;s.managedIds=[...new Set([...s.managedIds,...p.changes.map(c=>c.id)])];s.history.unshift({at:new Date().toISOString(),text:'配置已切换到 '+(s.groups.filter(g=>p.ids.includes(g.id)).map(g=>g.name).join(' + ')||'停用所有分组')});s.history=s.history.slice(0,50);s.pendingRestart=true;
    try{await save(s)}catch{throw Error('Codex 配置已写入，但分组记录保存失败。请刷新核对实际启用状态。');}plans.delete(input.token);return scan();});}
  async function detail(id){const s=await scan(),item=s.items.find(i=>i.id===id);if(!item)throw Error('技能不存在，请刷新。');return {...item,body:await fs.readFile(item.file,'utf8')};}
  return {translate:translator.translate,cancelTranslation:translator.cancel,list:async()=>{await queue;return scan()},catalog:market.catalog,preview:market.preview,saveToken:input=>exclusive(async()=>{await tokens.save(input?.value);return scan()}),removeToken:()=>exclusive(async()=>{await tokens.remove();return scan()}),install,saveGroup,removeGroup,saveSource,removeSource,plan,apply,detail};
}
module.exports={createSkillsManager};
