// Two separate Electron processes share only an isolated encrypted data directory.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cam-restart-smoke-')),electron=require('electron');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
try{
  for(const phase of ['interrupt','resume'])execFileSync(electron,[path.resolve('scripts/fixtures/resume-app.js'),'--fixture-root='+temp,'--phase='+phase,...(process.argv.includes('--packaged')?['--packaged']:[])],{env,windowsHide:true,timeout:50000,stdio:'inherit'});
  console.log('RESUME PASS: two real app processes, encrypted durable checkpoints, >240000 characters, original model, UI resume, no repeat of committed calls, one draft, full evidence export. Synthetic inputs and model only.');
}finally{const actual=fs.realpathSync(temp),base=fs.realpathSync(os.tmpdir());if(path.dirname(actual)===base&&path.basename(actual).startsWith('cam-restart-smoke-'))fs.rmSync(actual,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
