const {test}=require('node:test'),assert=require('node:assert/strict');
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

test('PowerShell force mode only ends matching installation processes',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
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
 try{const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',wrapper],{encoding:'utf8',windowsHide:true,timeout:25000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/target-ended/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

