const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
async function stopChild(child,{platform=process.platform}={}){
  if(!child?.pid||child.exitCode!=null||child.signalCode!=null)return;
  if(platform==='win32'){
    await execute('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000}).catch(()=>{});
  }else{
    // Only the native CLI child created by this app; never a process-name-wide kill.
    try{child.kill('SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error;}
  }
}
module.exports={stopChild};
