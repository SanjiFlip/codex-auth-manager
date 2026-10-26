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

test('exit checks retain the launcher selected during preflight',async()=>{
 const launcher={executable:'C:\\cam-test\\app\\ChatGPT.exe',appId:'OpenAI.Codex_fixture!App',installRoot:'C:\\cam-test'};
 const api=createWindowsCodex({execute:(file,args,options,callback)=>{
  assert.deepEqual(JSON.parse(options.env.CAM_LAUNCH_INFO),launcher);
  callback(null,'');
 }});
 await api.stop({launcher});await api.stop({launcher,force:true});
});

test('owned runtime descriptors survive failed exit, repeated discovery and forced retry without losing tick precision',async()=>{
 const records=[{pid:200,executable:'C:\\fixture\\OpenAI\\Codex\\bin\\new\\codex.exe',startTicks:'639028224000000001'}];
 const calls=[];
 const api=createWindowsCodex({execute:(file,args,options,callback)=>{
  const mode=args.at(-1);calls.push(mode);
  if(calls.length===1){callback({code:2},JSON.stringify({status:'still-running',ownedRuntimes:records}));return;}
  assert.deepEqual(JSON.parse(options.env.CAM_OWNED_RUNTIMES),records);
  callback(null,JSON.stringify(mode==='discover'?{appId:'OpenAI.Codex_fixture!App'}:{status:'stopped',ownedRuntimes:[]}));
 }});
 await assert.rejects(api.stop(),/CODEX_STILL_RUNNING/);
 const launcher=await api.discover();await api.discover();await api.stop({force:true,launcher});
 assert.deepEqual(calls,['stop','discover','discover','force-stop']);
});

test('runtime ownership survives manager restart, follows exact process identity and is saved before closing the GUI',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {execFile}=require('node:child_process'),{promisify}=require('node:util');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cam-runtime-retry-'));
 try{
  const script=path.join(dir,'adapter.ps1'),fixture=path.join(dir,'fixture.ps1'),state=path.join(dir,'state.json'),store=path.join(dir,'store'),closed=path.join(dir,'gui-closed');
  const snapshotFile=path.join(store,'desktop-runtimes.json');
  await fs.writeFile(script,(await fs.readFile(path.resolve('src/windows-codex.ps1'),'utf8')).replaceAll('.AddSeconds(15)','.AddMilliseconds(50)'));
  await fs.writeFile(fixture,String.raw`param($Mode)
$ErrorActionPreference='Stop'
$env:LOCALAPPDATA='C:\cam-runtime-fixture'
$global:guiAlive=$env:CAM_TEST_GUI -eq 'true'
$global:runtimeAlive=$true
function Get-AppxPackage {[pscustomobject]@{InstallLocation='C:\cam-msix';Version='1';PackageFamilyName='OpenAI.Codex_fixture'}}
function Get-StartApps {[pscustomobject]@{AppID='OpenAI.Codex_fixture!App'}}
$global:gui=[pscustomobject]@{Id=100;Path='C:\cam-msix\app\ChatGPT.exe';ProcessName='ChatGPT';MainWindowHandle=1;StartTime=[datetime]'2026-01-01';HasExited=$false}
$global:gui | Add-Member ScriptMethod CloseMainWindow {
 $saved=@([IO.File]::ReadAllText((Join-Path $env:CAM_DATA_ROOT 'desktop-runtimes.json')) | ConvertFrom-Json)
 if($saved.Count -ne 1 -or $saved[0].startTicks -ne '639028224000000001'){throw 'Runtime ownership must be saved before closing the GUI'}
 [IO.File]::WriteAllText($env:CAM_TEST_CLOSED,'closed')
 $global:guiAlive=$false;return $true
}
$global:runtime=[pscustomobject]@{Id=200;Path='C:\cam-runtime-fixture\OpenAI\Codex\bin\new\codex.exe';ProcessName='codex';MainWindowHandle=0;StartTime=[datetime]::new([long]639028224000000001,[DateTimeKind]::Utc);HasExited=$false}
$global:runtime | Add-Member ScriptMethod Kill {$global:runtimeAlive=$false}
if($env:CAM_TEST_REUSE -eq 'ticks'){$global:runtime.StartTime=$global:runtime.StartTime.AddTicks(1)}
if($env:CAM_TEST_REUSE -eq 'path'){$global:runtime.Path='C:\cam-runtime-fixture\OpenAI\Codex\bin\other\codex.exe'}
function Get-Process {param($Id)
 if($global:guiAlive -and (!$Id -or $Id -eq 100)){$global:gui}
 if($global:runtimeAlive -and (!$Id -or $Id -eq 200)){$global:runtime}
}
function Get-CimInstance {
 [pscustomobject]@{ProcessId=100;ParentProcessId=1;ExecutablePath=$global:gui.Path}
 [pscustomobject]@{ProcessId=200;ParentProcessId=100;ExecutablePath=$global:runtime.Path}
}
& '${script.replaceAll("'","''")}' -Mode $Mode
$code=$LASTEXITCODE
[IO.File]::WriteAllText($env:CAM_TEST_STATE,([bool]$global:runtimeAlive).ToString())
exit $code
`);
  async function run(mode,gui,records=[],reuse='',root=store){
   try{return await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture,'-Mode',mode],{
    windowsHide:true,timeout:25000,env:{...process.env,CAM_DATA_ROOT:root,CAM_LAUNCH_INFO:'{}',CAM_OWNED_RUNTIMES:JSON.stringify(records),CAM_TEST_GUI:String(gui),CAM_TEST_REUSE:reuse,CAM_TEST_STATE:state,CAM_TEST_CLOSED:closed},
   });}catch(error){return error;}
  }
  const first=await run('stop',true);assert.equal(first.code,2,first.stderr);
  const records=JSON.parse(first.stdout).ownedRuntimes;
  assert.equal(records.length,1);assert.equal(records[0].startTicks,'639028224000000001');
  const snapshot=await fs.readFile(snapshotFile,'utf8');assert.deepEqual(JSON.parse(snapshot),records);
  const discovery=await run('discover',false);assert.equal(discovery.code,undefined,discovery.stderr);
  assert.deepEqual(JSON.parse(discovery.stdout).ownedRuntimes,records,'new manager can rediscover persisted ownership with no in-memory records');
  for(const reuse of ['ticks','path','']){
   await fs.writeFile(snapshotFile,snapshot);
   const retried=await run('force-stop',false,[],reuse);assert.equal(retried.code,undefined,retried.stderr);
   assert.equal(await fs.readFile(state,'utf8'),reuse?'True':'False',reuse||'original runtime must be stopped');
   await assert.rejects(fs.stat(snapshotFile),{code:'ENOENT'},'successful exit clears the process snapshot');
  }
  await fs.rm(closed);const blocked=path.join(dir,'blocked');await fs.writeFile(blocked,'not a directory');
  const refused=await run('stop',true,[],'',blocked);assert.equal(refused.code,1,refused.stderr);
  await assert.rejects(fs.stat(closed),{code:'ENOENT'},'snapshot write failure must stop before GUI shutdown');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('desktop-owned external runtimes are checked, while independent CLI and reused PIDs are excluded',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {execFile}=require('node:child_process'),{promisify}=require('node:util');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cam-runtime-exit-'));
 try{
  // Shorten only the synthetic fixture's wait; production retains its 15s budget.
  const script=path.join(dir,'adapter.ps1');
  await fs.writeFile(script,(await fs.readFile(path.resolve('src/windows-codex.ps1'),'utf8')).replaceAll('.AddSeconds(15)','.AddMilliseconds(50)'));
  for(const mode of ['stop','force-stop']){
   const fixture=path.join(dir,mode+'.ps1');
   await fs.writeFile(fixture,String.raw`$env:LOCALAPPDATA='C:\cam-runtime-fixture'
$global:alive=@{100=$true;200=$true;201=$true;300=$true;400=$true}
function Get-AppxPackage { [pscustomobject]@{InstallLocation='C:\cam-msix';Version='1'} }
function New-Target($id,$exe,$window=0) {
 $p=[pscustomobject]@{Id=$id;Path=$exe;ProcessName=[IO.Path]::GetFileNameWithoutExtension($exe);MainWindowHandle=$window;StartTime=[datetime]'2026-01-01';HasExited=$false}
 $p | Add-Member ScriptMethod Kill { $global:alive[$this.Id]=$false; 'ended-'+$this.Id | Write-Output }
 $p | Add-Member ScriptMethod CloseMainWindow { $global:alive[$this.Id]=$false; $global:targets[400].StartTime=[datetime]'2026-02-01'; return $true }
 return $p
}
$global:targets=@{
 100=(New-Target 100 'C:\cam-msix\app\ChatGPT.exe' 1)
 200=(New-Target 200 'C:\cam-runtime-fixture\OpenAI\Codex\bin\new\codex.exe')
 201=(New-Target 201 'C:\cam-runtime-fixture\OpenAI\Codex\bin\new\node.exe')
 300=(New-Target 300 'C:\cam-runtime-fixture\OpenAI\Codex\bin\new\codex.exe')
 400=(New-Target 400 'C:\cam-runtime-fixture\OpenAI\Codex\bin\new\node.exe')
}
function Get-Process { param($Id) if($Id){if($global:alive[[int]$Id]){$global:targets[[int]$Id]}}else{foreach($key in $global:targets.Keys){if($global:alive[$key]){$global:targets[$key]}}} }
function Get-CimInstance {
 foreach($pair in @(@(100,1),@(200,100),@(201,200),@(300,999),@(400,100))){[pscustomobject]@{ProcessId=$pair[0];ParentProcessId=$pair[1];ExecutablePath=$global:targets[$pair[0]].Path}}
}
& '${script.replaceAll("'","''")}' -Mode ${mode}
exit $LASTEXITCODE
`);
   let result;
   try{result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture],{windowsHide:true,timeout:25000,env:{...process.env,CAM_DATA_ROOT:path.join(dir,'store'),CAM_OWNED_RUNTIMES:'[]',CAM_LAUNCH_INFO:'{}'}});}
   catch(error){result=error;}
   if(mode==='stop'){
    assert.equal(result.code,2,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).count,2,'owned engines block switching after the GUI closes; a reused PID does not count');
   }else{
    assert.equal(result.code,undefined,result.stderr);assert.match(result.stdout,/ended-200/);assert.match(result.stdout,/ended-201/);assert.doesNotMatch(result.stdout,/ended-300/);
   }
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('PowerShell force mode only ends the selected installation, including a captured launcher after package registration changes',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cam-exit-test-'));
 const script=path.resolve('src/windows-codex.ps1').replaceAll("'","''");
 const wrapper=path.join(dir,'fixture.ps1');
 fs.writeFileSync(wrapper,'\uFEFF'+String.raw`$ErrorActionPreference = 'Stop'
$global:alive = $true
function Get-AppxPackage { if($env:CAM_TEST_PACKAGE -eq 'installed'){[pscustomobject]@{InstallLocation='C:\cam-test';Version='1'}} }
$global:target = [pscustomobject]@{Path='C:\cam-test\app\ChatGPT.exe';ProcessName='ChatGPT';MainWindowHandle=0;HasExited=$false}
$global:target | Add-Member ScriptMethod Kill { $global:alive=$false; 'target-ended' | Write-Output }
$global:helperAlive = $true
$global:helper = [pscustomobject]@{Path='C:\cam-test\resources\node.exe';ProcessName='node';MainWindowHandle=0;HasExited=$false}
$global:helper | Add-Member ScriptMethod Kill { $global:helperAlive=$false; 'helper-ended' | Write-Output }
$global:other = [pscustomobject]@{Path='C:\unrelated\ChatGPT.exe';ProcessName='ChatGPT';MainWindowHandle=0;HasExited=$false}
$global:other | Add-Member ScriptMethod Kill { throw 'Unrelated process was targeted' }
function Get-Process { if($global:alive){$global:target}; if($global:helperAlive){$global:helper}; $global:other }
& '${script}' -Mode force-stop
`);
 try{
  for(const packageState of ['installed','changed']){
   const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',wrapper],{
    windowsHide:true,timeout:25000,
    env:{...process.env,CAM_DATA_ROOT:path.join(dir,'store'),CAM_OWNED_RUNTIMES:'[]',CAM_TEST_PACKAGE:packageState,CAM_LAUNCH_INFO:JSON.stringify({executable:'C:\\cam-test\\app\\ChatGPT.exe',installRoot:'C:\\cam-test'})},
   });
   assert.match(stdout,/target-ended/,packageState);
   assert.match(stdout,/helper-ended/,packageState);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
