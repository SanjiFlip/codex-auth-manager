const {test:nodeTest}=require('node:test'),assert=require('node:assert/strict');
const test=(name,fn)=>nodeTest(name,{skip:process.platform!=='win32'},fn);
function createWindowsCodex({execute}){
 const childProcess=require('node:child_process'),original=childProcess.execFile;
 const file=require.resolve('../src/windows-codex');delete require.cache[file];
 try{childProcess.execFile=execute;return require(file);}finally{childProcess.execFile=original;delete require.cache[file];}
}
test('tray-resident timeout is distinguished from a broken exit check',async()=>{
 const api=createWindowsCodex({execute:(file,args,options,callback)=>callback({code:2},JSON.stringify({status:'still-running',count:3}))});
 await assert.rejects(api.stop(),/CODEX_STILL_RUNNING.*托盘/);
 const broken=createWindowsCodex({execute:(file,args,options,callback)=>callback({code:1},'')});
 await assert.rejects(broken.stop(),/退出检查执行失败/);
});
test('force exit is opt-in; normal and malformed options cannot request it',async()=>{
 const modes=[];
 const api=createWindowsCodex({execute:(file,args,options,callback)=>{modes.push(args.at(-1));callback(null,'');}});
 await api.stop();await api.stop({force:'true'});await api.stop({force:true});
 assert.deepEqual(modes,['stop','stop','force-stop']);
});

test('PowerShell force mode only ends matching installation processes',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cam-exit-test-'));
 const script=path.resolve('src/windows-codex.ps1').replaceAll("'","''");
 const wrapper=path.join(dir,'fixture.ps1');
 fs.writeFileSync(wrapper,String.raw`$global:alive = $true
function Get-AppxPackage { [pscustomobject]@{InstallLocation='C:\cam-test';Version='1'} }
$global:target = [pscustomobject]@{Path='C:\cam-test\app\ChatGPT.exe';ProcessName='ChatGPT';MainWindowHandle=0;HasExited=$false}
$global:target | Add-Member ScriptMethod Kill { $global:alive=$false; 'target-ended' | Write-Output }
$global:other = [pscustomobject]@{Path='C:\unrelated\ChatGPT.exe';ProcessName='ChatGPT';MainWindowHandle=0;HasExited=$false}
$global:other | Add-Member ScriptMethod Kill { throw 'Unrelated process was targeted' }
function Get-Process { if($global:alive){$global:target}; $global:other }
& '${script}' -Mode force-stop
`);
 try{
  // Native host/module cold start is separate from the script's existing 25s
  // operation budget. Every process and path remains a synthetic test fixture.
  const result=await new Promise(resolve=>{
   const started=Date.now();let readyAt=null,stdout='',stderr='',error=null;
   const command="Get-Command Add-Member,Sort-Object,Select-Object,Where-Object,ConvertTo-Json | Out-Null; [Console]::Out.WriteLine('CAM_TEST_READY'); $fixture=[Console]::ReadLine(); & $fixture";
   const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   const expire=stage=>{error=Error(stage+' timed out; elapsed='+String(Date.now()-started)+'ms; stdout='+stdout+'; stderr='+stderr);child.kill()};
   let timer=setTimeout(()=>expire('PowerShell startup'),60000);
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stdout.on('data',chunk=>{stdout+=chunk;if(readyAt===null&&/^CAM_TEST_READY\r?$/m.test(stdout)){readyAt=Date.now();clearTimeout(timer);timer=setTimeout(()=>expire('PowerShell fixture operation'),25000);child.stdin.end(wrapper+'\n');}});
   child.stderr.on('data',chunk=>{stderr+=chunk});
   child.on('error',cause=>{error??=cause});
   child.stdin.on('error',cause=>{error??=cause;child.kill()});
   child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr,error,startupMs:readyAt===null?null:readyAt-started,operationMs:readyAt===null?null:Date.now()-readyAt})});
  });
  assert.ifError(result.error);assert.equal(result.status,0,`signal=${result.signal}; stdout=${result.stdout}; stderr=${result.stderr}`);assert.match(result.stdout,/target-ended/);
  console.log('PowerShell fixture timings: '+JSON.stringify({startupMs:result.startupMs,operationMs:result.operationMs}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
