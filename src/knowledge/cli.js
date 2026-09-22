const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {resolveCli}=require('../official-login');
const {stopChild}=require('../child-process-cleanup');
const {EFFORT_ID}=require('./models');
function cliArgs(model,reasoningEffort,schemaPath){
  const args=['-a','never','exec','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--ephemeral','--sandbox','read-only','--json','--color','never'];
  const config=['web_search="disabled"','project_doc_max_bytes=0','model_provider="openai"','cli_auth_credentials_store="file"','features.skip_host_skill_discovery=true'];
  for(const name of ['shell_tool','unified_exec','apps','plugins','memories','hooks','multi_agent','multi_agent_v2','browser_use','computer_use','image_generation','code_mode','skill_search','skill_implicit_invocation'])config.push(`features.${name}=false`);
  for(const value of config)args.push('-c',value);
  if(reasoningEffort)args.push('-c',`model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  if(schemaPath)args.push('--output-schema',schemaPath);
  if(model)args.push('--model',model);args.push('-');return args;
}
async function executeDistillation({home,prompt,outputSchema,model='',reasoningEffort='',signal,resolve=resolveCli,spawnProcess=spawn,stop=stopChild,timeoutMs=180000}){
  if(model&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model))throw Error('模型名称格式无效。');
  if(typeof reasoningEffort!=='string'||(reasoningEffort&&!EFFORT_ID.test(reasoningEffort)))throw Error('推理强度格式无效。');
  const cli=await resolve();if(signal?.aborted)throw Error('已取消蒸馏。');
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'cam-distill-'));
  const env={...process.env,CODEX_HOME:home};for(const key of Object.keys(env))if(/^(OPENAI_|CODEX_(ACCESS_TOKEN|API_KEY|BASE_URL)|ELECTRON_RUN_AS_NODE$)/i.test(key))delete env[key];
  let child,timer,abort,stopPromise;let buffer='',bytes=0,result='',completed=false,failure=null;
  try{
    const schemaPath=outputSchema?path.join(cwd,'response-schema.json'):undefined;
    if(schemaPath)await fs.writeFile(schemaPath,JSON.stringify(outputSchema),{mode:0o600});
    return await new Promise((resolveResult,reject)=>{
      const fail=message=>{if(!failure)failure=new Error(message);if(child&&!stopPromise)stopPromise=Promise.resolve().then(()=>stop(child)).catch(()=>{}).then(()=>reject(failure));};
      child=spawnProcess(cli.command,[...cli.args,...cliArgs(model,reasoningEffort,schemaPath)],{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      abort=()=>fail('已取消蒸馏。');signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>fail('蒸馏超时，请减少素材后重试。'),timeoutMs);
      child.stderr.resume();child.stdin.on('error',()=>fail('无法向 Codex CLI 发送素材。'));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        bytes+=chunk.length;if(bytes>2*1024*1024){fail('CLI 输出超过限制，本次未保存结果。');return;}
        buffer+=chunk.toString('utf8');let newline;
        while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let event;try{event=JSON.parse(line)}catch{continue;}
          if(event.type==='item.completed'&&event.item?.type==='agent_message')result=event.item.text||'';
          if(event.type==='turn.completed')completed=true;
          if(event.type==='turn.failed'||event.type==='error')fail('Codex 蒸馏失败，请检查当前登录、可用额度或模型名称。');
          if(event.item&&['command_execution','mcp_tool_call','web_search','file_change'].includes(event.item.type))fail('检测到非文本工具操作，已中止本次蒸馏。');
        }
      });
      child.once('error',()=>reject(new Error('无法启动 Codex 原生 CLI，请检查安装。')));
      child.once('close',code=>{if(failure)return reject(failure);if(code!==0||!completed||!result.trim())return reject(new Error('CLI 未返回完整结果。请使用支持 exec --ignore-user-config / --ignore-rules / --ephemeral 的新版 Codex CLI，并检查登录状态。'));if(result.length>80000)return reject(new Error('结果超过 80000 字符，请缩小素材范围。'));resolveResult(result.trim());});
      if(signal?.aborted)abort();else child.stdin.end(prompt);
    });
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(child&&child.exitCode==null&&child.signalCode==null)await stop(child);if(stopPromise)await stopPromise;await fs.rm(cwd,{recursive:true,force:true}).catch(()=>{});}
}
module.exports={executeDistillation,cliArgs};
