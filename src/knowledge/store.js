const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const KINDS={skill:'Skill',workflow:'工作流',prompt:'提示词',profile:'个人偏好',task:'任务记忆'};
function content(input){
  if(!input||!Object.hasOwn(KINDS,input.kind))throw Error('请选择有效的产物类型。');
  const text=(key,max,required=false)=>{if(typeof input[key]!=='string'||input[key].length>max||(required&&!input[key].trim()))throw Error('内容为空或超过长度限制：'+key);return input[key].trim()};
  return {kind:input.kind,title:text('title',120,true),body:text('body',80000,true),project:text('project',500)};
}
function createKnowledgeStore({root,encrypt,decrypt}){
  const file=path.join(root,'knowledge.enc');let queue=Promise.resolve();
  async function read(){
    let raw;try{raw=await fs.readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')return {version:1,items:[]};throw e;}
    try{const data=JSON.parse(await decrypt(raw));if(data.version!==1||!Array.isArray(data.items))throw Error();return data;}catch{throw Error('知识库无法解密或格式异常，已保留原文件。');}
  }
  function mutate(fn){const task=queue.then(async()=>{const data=await read();const value=fn(data);const encrypted=await encrypt(JSON.stringify(data));await fs.mkdir(root,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,encrypted,{mode:0o600});await fs.rename(temp,file)}finally{await fs.rm(temp,{force:true}).catch(()=>{})}return value;});queue=task.catch(()=>{});return task;}
  return {
    async get(id){await queue;return (await read()).items.find(item=>item.id===id)},
    async findJob(jobId){await queue;return (await read()).items.find(item=>item.jobId===jobId)},
    async list(){await queue;return (await read()).items.map(({evidence,evidenceLinks,...item})=>({...item,evidenceCount:evidence?.length||0})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},
    save(input,{generated=false}={}){const fields=content(input);return mutate(data=>{
      if(generated&&input.jobId){const existing=data.items.find(i=>i.jobId===input.jobId);if(existing)return existing;}
      const old=input.id?data.items.find(x=>x.id===input.id):null;
      if(input.id&&!old)throw Error('该条目已删除，请刷新。');
      if(old&&input.revision!==old.revision)throw Error('条目已在其他窗口修改，请刷新后再编辑。');
      const now=new Date().toISOString();const item={...fields,id:old?.id||randomUUID(),revision:(old?.revision||0)+1,createdAt:old?.createdAt||now,updatedAt:now,status:input.status==='draft'?'draft':'saved',jobId:old?.jobId||(generated?input.jobId:undefined),evidenceLinks:old?.evidenceLinks||(generated?input.evidenceLinks:undefined),evidence:old?.evidence||(generated?input.evidence:undefined),origin:old?.origin||(generated?'distill':'manual'),sources:old?.sources||(generated?input.sources:[])||[]};
      if(old)data.items[data.items.indexOf(old)]=item;else{if(data.items.length>=1000)throw Error('知识库已达 1000 条，请先导出整理。');data.items.push(item)}return item;
    })},
    remove(id,revision){return mutate(data=>{const item=data.items.find(x=>x.id===id);if(!item||item.revision!==revision)throw Error('条目已变化，请刷新后重试。');data.items=data.items.filter(x=>x.id!==id);return true})},
  };
}
function markdown(item){
  const sources=(item.sources||[]).map(s=>`- Codex 会话 ${s.title}（${s.sessionId}），消息 ${s.messages.map(n=>n+1).join(', ')}`).join('\n');
  const links=item.evidenceLinks?.length?'\n\n## 章节与证据关联\n\n'+item.evidenceLinks.map(s=>`- ${s.heading}：${s.factIds.join(', ')}`).join('\n'):'';
  const evidence=item.evidence?.length?'\n\n## 完整证据档案\n\n'+require('./distillation').evidenceMarkdown(item.evidence):'';
  const body=`${item.body}${links}${evidence}\n\n---\n\n类型：${KINDS[item.kind]}\n项目：${item.project||'未指定'}\n更新时间：${item.updatedAt}\n${sources?'\n来源：\n'+sources+'\n':''}`;
  if(item.kind==='skill')return `---\nname: distilled-${item.id.slice(0,8)}\ndescription: ${JSON.stringify(item.title)}\n---\n\n# ${item.title}\n\n${body}`;
  return `# ${item.title}\n\n${body}`;
}
module.exports={KINDS,content,createKnowledgeStore,markdown};
