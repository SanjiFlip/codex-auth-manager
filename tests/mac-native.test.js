const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
test('native mac fixture discovers, quits, relaunches and explicitly force quits',{skip:process.platform!=='darwin',timeout:90000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-mac-native-'));
 const bundle=path.join(root,'Codex.app'),contents=path.join(bundle,'Contents');
 await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});
 await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openai.cam-fixture</string><key>CFBundleName</key><string>Codex</string><key>CFBundleExecutable</key><string>Codex</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
 const source=path.join(root,'fixture.m');
 await fs.writeFile(source,'#import <Cocoa/Cocoa.h>\nint main(){ @autoreleasepool { NSApplication *app=[NSApplication sharedApplication]; [app setActivationPolicy:NSApplicationActivationPolicyAccessory]; [app run]; } return 0; }');
 await execute('/usr/bin/clang',['-framework','Cocoa',source,'-o',path.join(contents,'MacOS','Codex')]);
 const {createMacCodex}=require('../src/mac-codex');
 const api=createMacCodex({realpath:async candidate=>{if(candidate!=='/Applications/Codex.app')throw Error('fixture only');return bundle}});
 let launcher;
 try{launcher=await api.discover();assert.equal(launcher.appPath,bundle);await api.launch(launcher);await api.stop({launcher});await api.launch(launcher);await api.stop({launcher,force:true});}
 finally{if(launcher)await api.stop({launcher,force:true});await fs.rm(root,{recursive:true,force:true});}
});
