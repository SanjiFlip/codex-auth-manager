const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path').posix;
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
function processesInBundle(stdout,appPath){
  const prefix=appPath+'/Contents/';
  return String(stdout).split('\n').flatMap(line=>{
    const match=/^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    return match&&match[2].startsWith(prefix)?[{pid:Number(match[1]),executable:match[2]}]:[];
  });
}
function createMacCodex({execute=promisify(execFile),home=os.homedir(),realpath=fs.realpath,signal=(pid,sig)=>process.kill(pid,sig),wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=15000}={}){
  const run=async(command,args)=>{const result=await execute(command,args,{timeout:20000,maxBuffer:4*1024*1024});return result.stdout;};
  const list=()=>run('/bin/ps',['-ww','-axo','pid=,comm=']);
  async function discover(){
    const apps=[];
    for(const name of ['Codex','ChatGPT'])for(const folder of ['/Applications',path.join(home,'Applications')]){
      const candidate=path.join(folder,name+'.app');
      try{
        const appPath=await realpath(candidate);
        const info=JSON.parse(await run('/usr/bin/plutil',['-convert','json','-o','-',path.join(appPath,'Contents','Info.plist')]));
        if(!/^com\.openai\./i.test(info.CFBundleIdentifier||'')||!info.CFBundleExecutable)continue;
        if(apps.some(app=>app.appPath===appPath))continue;
        apps.push({appPath,executable:appPath+'/Contents/MacOS/'+info.CFBundleExecutable,version:info.CFBundleShortVersionString||null});
      }catch{/* Not installed or not a readable application bundle. */}
    }
    if(!apps.length)throw Error('未找到 Codex / ChatGPT 桌面应用。请安装到 /Applications 或 ~/Applications 后重试。');
    const stdout=await list();
    const running=apps.filter(app=>processesInBundle(stdout,app.appPath).length);
    if(running.length>1)throw Error('检测到多个 Codex / ChatGPT 应用正在运行，请先退出多余实例后重试；凭据尚未改写。');
    return running[0]||apps[0];
  }
  async function stop({force=false,launcher}={}){
    const app=launcher||await discover();
    let targets=processesInBundle(await list(),app.appPath);
    if(!targets.length)return;
    if(force===true){
      for(const target of targets){try{signal(target.pid,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw Error('无法结束 Codex 后台进程；凭据尚未改写。');}}
    }else{
      // NSRunningApplication requests normal termination without Apple Events automation permission.
      const main=targets.find(target=>target.executable===app.executable);
      try{if(main)await run('/usr/bin/osascript',['-l','JavaScript','-e',"ObjC.import('AppKit'); function run(argv) { const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0])); if (app && !app.isTerminated) app.terminate; }",String(main.pid)]);}
      catch{throw Error('[CODEX_STILL_RUNNING] Codex 退出请求未完成。请用应用菜单退出后重试，或保存任务后确认结束后台；凭据尚未改写。');}
    }
    const deadline=Date.now()+timeoutMs;
    do{
      targets=processesInBundle(await list(),app.appPath);
      if(!targets.length)return;
      await wait(150);
    }while(Date.now()<deadline);
    throw Error('[CODEX_STILL_RUNNING] Codex 仍在后台运行。请使用应用菜单退出后重试；凭据尚未改写。');
  }
  async function launch(app){
    await run('/usr/bin/open',['-a',app.appPath]);
    const deadline=Date.now()+timeoutMs;
    do{if(processesInBundle(await list(),app.appPath).some(p=>p.executable===app.executable))return;await wait(150)}while(Date.now()<deadline);
    throw Error('未能确认 Codex 启动成功。');
  }
  return {discover,stop,launch};
}
module.exports={...createMacCodex(),createMacCodex,processesInBundle};
