const {randomUUID}=require('node:crypto');
const {KINDS}=require('./store');
const {MAX_INPUT_CHARS,MAX_SESSIONS,splitMaterials,estimatePlan,distill,digest}=require('./distillation');
const {memoryJobStore}=require('./jobs');
function redact(text){return text.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[已隐藏令牌]').replace(/((?:access_token|refresh_token|api_key|password)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,'$1[已隐藏]');}
function createWorkbench({library,store,execute,withAccount,resolveModel,jobs=memoryJobStore(),report=()=>{}}){
  let active=null,state={phase:'idle'},saved=null,loading;
  const publish=next=>{state=next;report(next)};
  const summary=job=>({jobId:job.id,title:job.request.title,model:job.modelSelection.model,reasoningEffort:job.modelSelection.reasoningEffort,completed:job.completed||0,totalCalls:job.plan.calls,resumable:true});
  async function ready(){if(!loading)loading=(async()=>{saved=await jobs.load();if(saved&&!active)publish({phase:'paused',...summary(saved),message:'检测到未完成任务，可从已保存的检查点继续。'});})();try{await loading}catch(e){loading=null;throw e;}}
  async function prepare(request,signal){
    if(!request||!Object.hasOwn(KINDS,request.kind)||typeof request.title!=='string'||!request.title.trim()||request.title.length>120)throw Error('请填写标题并选择产物类型。');
    if(typeof request.instructions!=='string'||request.instructions.length>3000||typeof request.project!=='string'||request.project.length>500)throw Error('配置内容过长或格式错误。');
    if(request.model!==undefined&&(typeof request.model!=='string'||(request.model&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(request.model))))throw Error('模型名称格式无效。');
    if(!Array.isArray(request.selection)||!request.selection.length||request.selection.length>MAX_SESSIONS)throw Error(`请选择 1 至 ${MAX_SESSIONS} 个会话中的消息。`);
    const {items}=await library.list({force:true}),byId=new Map(items.map(i=>[i.id,i]));const materials=[],sources=[];let chars=0;const ids=new Set();
    for(const selected of request.selection){if(signal?.aborted)throw Error('已暂停蒸馏。');if(!selected||ids.has(selected.id))throw Error('会话选择重复或无效。');ids.add(selected.id);const meta=byId.get(selected.id);if(!meta||!Array.isArray(selected.messages)||!selected.messages.length||selected.messages.length>500)throw Error('所选素材已归档、移除或变化，请重新选择。');
      const transcript=await library.transcript(selected.id),byIndex=new Map(transcript.messages.map(m=>[m.index,m]));
      const messages=[...new Set(selected.messages)].map(index=>{const message=byIndex.get(index);if(!message||message.truncated||selected.fingerprints?.[index]!==message.fingerprint)throw Error('所选消息缺失、过长或已变化，不能混用旧检查点；请放弃旧任务后重新选择。');chars+=message.text.length;if(chars>MAX_INPUT_CHARS)throw Error('素材超过单任务 1200 万字符保护上限，请分项目处理。');return {...message,text:redact(message.text)};});
      materials.push({messages});sources.push({sessionId:meta.sessionId,title:meta.title,messages:messages.map(m=>m.index),fingerprints:Object.fromEntries(messages.map(m=>[m.index,m.fingerprint]))});
    }
    return {chunks:splitMaterials(materials),sources,chars};
  }
  function launch(request,resume){
    if(active)throw Error('已有蒸馏任务正在运行。');if(saved&&!resume)throw Error('已有可恢复任务，请先继续或放弃。');
    const job={abort:new AbortController()};active=job;publish({phase:'preparing',...(saved?summary(saved):{}),startedAt:new Date().toISOString()});
    job.done=(async()=>{try{
      await ready();if(saved&&!resume)throw Error('已有可恢复任务，请先继续或放弃。');if(resume&&!saved)throw Error('没有可恢复的任务。');
      // Covers a crash between the draft commit and checkpoint cleanup.
      if(resume&&store.findJob){const existing=await store.findJob(saved.id);if(existing){await jobs.clear(saved.id);saved=null;publish({phase:'completed',itemId:existing.id});return;}}
      request=resume?saved.request:structuredClone(request);
      const prepared=await prepare(request,job.abort.signal);if(job.abort.signal.aborted)throw Error('已暂停蒸馏。');
      await withAccount(async()=>{
        const modelSelection=await resolveModel(resume?saved.modelSelection:request);
        if(resume&&digest(modelSelection)!==digest(saved.modelSelection))throw Error('原任务模型或推理强度已不可用，不能混用检查点。');
        const signature=digest({chunks:prepared.chunks,selection:request.selection,kind:request.kind,title:request.title,project:request.project,instructions:request.instructions,modelSelection});
        if(resume&&signature!==saved.signature)throw Error('素材或任务配置已变化，不能混用检查点；请放弃后重新选择。');
        if(job.abort.signal.aborted)throw Error('已暂停蒸馏。');
        if(!resume){const manifest={version:1,pipeline:2,id:randomUUID(),request,modelSelection,signature,plan:estimatePlan(prepared.chunks.length),createdAt:new Date().toISOString(),completed:0};await jobs.create(manifest);saved=manifest;}
        publish({phase:'running',...summary(saved)});let evidence=[],evidenceLinks=[];
        const body=await distill({chunks:prepared.chunks,brief:JSON.stringify({kind:KINDS[request.kind],format:({skill:'Skill 正文：适用条件、步骤、检查与限制，不生成 YAML 头或虚构脚本',workflow:'输入、步骤、产出、验证和失败处理',prompt:'可复制提示词：目标、输入占位符、边界和输出要求',profile:'用户明确表达的偏好，不推断敏感特征',task:'背景、已决定事项、约束、未解决问题和下一步'})[request.kind],title:redact(request.title),instructions:redact(request.instructions)}),execute,modelSelection,signal:job.abort.signal,
          checkpoint:{read:key=>jobs.readStep(saved.id,key),write:async(key,value)=>{await jobs.writeStep(saved.id,key,value);saved.completed++;}},
          onEvidence:(value,links)=>{evidence=value;evidenceLinks=links},progress:step=>publish({...state,...step,completed:saved.completed})});
        if(job.abort.signal.aborted)throw Error('已暂停蒸馏。');
        const item=await store.save({kind:request.kind,title:request.title,project:request.project,body:redact(body),status:'draft',sources:prepared.sources,evidence:evidence.map(f=>({...f,text:redact(f.text),evidence:f.evidence.map(e=>({...e,quote:redact(e.quote)}))})),evidenceLinks,jobId:saved.id},{generated:true});
        await jobs.clear(saved.id);saved=null;publish({phase:'completed',itemId:item.id});
      });
    }catch(e){publish({phase:job.abort.signal.aborted?'paused':'failed',...(saved?summary(saved):{}),message:e.message||'蒸馏失败，已完成检查点保留。'})}finally{active=null}})();return state;
  }
  return {
    ready,state:()=>state,busy:()=>!!active,
    async preview(request){await ready();if(saved)throw Error('已有可恢复任务，请先继续或放弃。');const prepared=await prepare(request);return {...estimatePlan(prepared.chunks.length),chars:prepared.chars,sessions:prepared.sources.length,messages:prepared.sources.reduce((n,s)=>n+s.messages.length,0)};},
    start:request=>launch(request,false),resume:()=>launch(null,true),
    async discard(){if(active)throw Error('请先暂停任务。');await ready();if(saved){await jobs.clear(saved.id);saved=null;}publish({phase:'idle'});return state;},
    async cancel(){if(active){active.abort.abort();await active.done}return state;},
  };
}
module.exports={redact,createWorkbench};
