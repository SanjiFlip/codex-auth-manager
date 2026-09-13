const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createInterface}=require('node:readline');
const {resolveCli}=require('./official-login');
const execute=promisify(execFile);

function normalizeOfficialAccount(accountResult, limitsResult, checkedAt=new Date().toISOString()) {
  if(accountResult?.account?.type!=='chatgpt')throw new Error('官方服务未识别到 ChatGPT 登录。');
  const raw=limitsResult?.rateLimits;
  const all=limitsResult?.rateLimitsByLimitId;
  const bucket=all?.codex||raw;
  const window=value=>value?{usedPercent:typeof value.usedPercent==='number'?Math.max(0,Math.min(100,value.usedPercent)):null,windowMinutes:value.windowDurationMins??null,resetsAt:typeof value.resetsAt==='number'?new Date(value.resetsAt*1000).toISOString():null,checkedAt}:null;
  const windows=[bucket?.primary,bucket?.secondary].filter(Boolean);
  return {
    planType:accountResult.account.planType||bucket?.planType||null,
    email:accountResult.account.email||null,
    quota:{source:'official-app-server',checkedAt,resetCredits:typeof limitsResult?.rateLimitResetCredits?.availableCount==='number'?limitsResult.rateLimitResetCredits.availableCount:null,session:window(windows.find(w=>w.windowDurationMins===300)),weekly:window(windows.find(w=>w.windowDurationMins===10080))},
  };
}

async function queryOfficialAccount(home,{resolve=resolveCli,spawnProcess=spawn}={}) {
  const cli=await resolve();
  const env={...process.env,CODEX_HOME:home};delete env.OPENAI_API_KEY;delete env.CODEX_ACCESS_TOKEN;
  const child=spawnProcess(cli.command,[...cli.args,'app-server','--listen','stdio://','-c','cli_auth_credentials_store="file"'],{env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const childClosed=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve)});
  const pending=new Map();let nextId=0,closed=false;
  child.stderr.resume();
  const lines=createInterface({input:child.stdout});
  const fail=()=>{closed=true;for(const request of pending.values())request.reject(new Error('官方账号服务已退出。'));pending.clear()};
  child.on('error',fail);child.on('close',fail);
  lines.on('line',line=>{
    if(line.length>2000000)return;
    let message;try{message=JSON.parse(line)}catch{return}
    const request=pending.get(message.id);if(!request)return;
    pending.delete(message.id);
    if(message.error)request.reject(new Error('官方账号或额度查询失败，请检查网络与登录状态。'));
    else request.resolve(message.result);
  });
  function rpc(method,params={}) {
    return new Promise((resolve,reject)=>{
      if(closed)return reject(new Error('官方服务未启动。'));
      const id=nextId++;pending.set(id,{resolve,reject});
      child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){pending.delete(id);reject(new Error('无法与官方账号服务通信。'))}});
    });
  }
  let timer;
  try {
    return await Promise.race([
      (async()=>{
        await rpc('initialize',{clientInfo:{name:'codex_auth_manager',title:'Codex Auth Manager',version:require('../package.json').version}});
        child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
        const account=await rpc('account/read',{refreshToken:false});
        const limits=await rpc('account/rateLimits/read');
        return normalizeOfficialAccount(account,limits);
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('官方账号查询超时，请稍后重试。')),25000)}),
    ]);
  }finally{
    clearTimeout(timer);lines.close();
    if(child.pid&&!closed)await execute('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000}).catch(()=>{});
    let closeTimer;
    await Promise.race([childClosed,new Promise(resolve=>{closeTimer=setTimeout(resolve,3000)})]);
    clearTimeout(closeTimer);
    fail();
  }
}
module.exports={queryOfficialAccount,normalizeOfficialAccount};
