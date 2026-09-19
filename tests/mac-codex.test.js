const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMacCodex,processesInBundle}=require('../src/mac-codex');
const appPath='/Applications/Codex.app',executable=appPath+'/Contents/MacOS/Codex';
const launcher={appPath,executable};
test('mac process matching includes helpers and excludes same-name unrelated apps',()=>{
 const rows=`12 ${executable}\n13 ${appPath}/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper\n14 /other/Codex.app/Contents/MacOS/Codex\n15 /Applications/Codex.app.other/Contents/MacOS/Codex`;
 assert.deepEqual(processesInBundle(rows,appPath).map(p=>p.pid),[12,13]);
});
test('mac graceful exit uses argv and confirms helpers have exited; timeout never force kills',async()=>{
 let rows=`12 ${executable}`,quit=false;const calls=[];
 const api=createMacCodex({timeoutMs:0,wait:async()=>{},signal:()=>{throw Error('Unexpected force')},execute:async(cmd,args)=>{
  calls.push([cmd,args]);if(cmd.endsWith('osascript')){quit=true;return {stdout:''}}return {stdout:rows};
 }});
 await assert.rejects(api.stop({launcher}),/CODEX_STILL_RUNNING/);assert.equal(quit,true);
 assert.equal(calls.find(c=>c[0].endsWith('osascript'))[1].at(-1),'12');
 rows='';await api.stop({launcher});
});
test('mac explicit force targets only the selected app and confirms restart main process',async()=>{
 let rows=`12 ${executable}\n99 /unrelated/Codex`,signals=[];
 const api=createMacCodex({timeoutMs:0,wait:async()=>{},signal:(pid,sig)=>{signals.push([pid,sig]);rows='99 /unrelated/Codex'},execute:async(cmd)=>{
  if(cmd.endsWith('/open'))rows=`22 ${executable}`;return {stdout:rows};
 }});
 await api.stop({launcher,force:true});assert.deepEqual(signals,[[12,'SIGKILL']]);await api.launch(launcher);
});
test('mac discovery validates bundle metadata and detects running application',async()=>{
 const api=createMacCodex({home:'/fixture',realpath:async p=>{if(p!==appPath)throw Error('missing');return p},execute:async(cmd)=>({stdout:cmd.endsWith('plutil')?JSON.stringify({CFBundleIdentifier:'com.openai.codex',CFBundleExecutable:'Codex',CFBundleShortVersionString:'1.2'}):`12 ${executable}`})});
 assert.deepEqual(await api.discover(),{...launcher,version:'1.2'});
 const invalid=createMacCodex({realpath:async p=>p,execute:async()=>({stdout:JSON.stringify({CFBundleIdentifier:'unrelated.vendor',CFBundleExecutable:'Codex'})})});
 await assert.rejects(invalid.discover(),/未找到/);
});
test('mac launch rejects helper-only startup and process inspection failures propagate',async()=>{
 const api=createMacCodex({timeoutMs:0,wait:async()=>{},execute:async()=>({stdout:`12 ${appPath}/Contents/Helpers/worker`})});
 await assert.rejects(api.launch(launcher),/启动/);
 const broken=createMacCodex({execute:async()=>{throw Error('ps failed')}});
 await assert.rejects(broken.stop({launcher,force:true}),/ps failed/);
});
test('mac CLI cleanup signals only its owned child',async()=>{
 const {stopChild}=require('../src/child-process-cleanup');const signals=[];
 await stopChild({pid:23,exitCode:null,signalCode:null,kill:sig=>signals.push(sig)},{platform:'darwin'});
 await stopChild({pid:24,exitCode:0,kill:()=>{throw Error('already exited')}},{platform:'darwin'});
 assert.deepEqual(signals,['SIGKILL']);
});
