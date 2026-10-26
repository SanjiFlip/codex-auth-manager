'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
function createAntigravity({platform=process.platform,spawnProcess=spawn,report=()=>{},timeoutMs=90000}={}){
  let busy=false;
  return async function execute(input={}){
    if(platform!=='win32')return {supported:false,accounts:[],backups:[],warning:'Antigravity 账号切换目前仅支持 Windows。'};
    if(!input||!['state','save','rename','remove','switch','restore','open','configure'].includes(input.action))throw Error('无效的 Antigravity 操作。');
    for(const key of ['id','name','executable'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>2048))throw Error('无效的操作参数。');
    if(input.forceClose!==undefined&&typeof input.forceClose!=='boolean')throw Error('无效的操作参数。');
    if(busy)throw Error('Antigravity 操作正在执行，请稍候。');
    busy=true;
    try{return await new Promise((resolve,reject)=>{
      const file=path.join(__dirname,'antigravity','AntigravityBridge.exe').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
      const child=spawnProcess(file,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      let output='',bytes=0,result,invalid=false,timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{report({phase:'error',message:'Antigravity 组件未退出，请等待退出后再恢复，勿重复切换。'})}},timeoutMs);
      timer.unref?.();
      function consume(line){
        if(!line.trim())return;
        try{
          const value=JSON.parse(line.replace(/^\uFEFF/,''));
          if(result){invalid=true;return}
          if(value.event==='progress'){
            if(typeof value.phase!=='string'||typeof value.message!=='string'){invalid=true;return}
            report({phase:value.phase,message:value.message,identityVerified:false});
          }else if(typeof value.ok==='boolean')result=value;
          else invalid=true;
        }catch{invalid=true}
      }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024){invalid=true;return}
        output+=chunk;
        let end;while((end=output.indexOf('\n'))>=0){consume(output.slice(0,end));output=output.slice(end+1)}
      });
      child.stderr.resume();
      child.stdin.on('error',()=>{});
      child.on('error',()=>{clearTimeout(timer);reject(Error('无法启动 Antigravity 组件，请重新构建或安装完整版本。'))});
      child.on('close',code=>{
        clearTimeout(timer);consume(output);
        if(timedOut)return reject(Error('Antigravity 操作超时，组件已停止。请刷新状态；如有中断记录，先恢复原登录。'));
        if(invalid||!result||(result.ok&&code!==0))return reject(Error('Antigravity 组件未返回有效结果；如切换中断，请刷新并恢复备份。'));
        if(!result.ok)return reject(Error(result.error||'Antigravity 操作失败。'));
        resolve(result.data);
      });
      child.stdin.end(JSON.stringify({action:input.action,id:input.id,name:input.name,executable:input.executable,forceClose:input.forceClose===true})+'\n');
    })}finally{busy=false}
  };
}
module.exports={createAntigravity};
