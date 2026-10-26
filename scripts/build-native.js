'use strict';
if(process.platform==='win32')require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',require('node:path').join(__dirname,'build-antigravity.ps1')],{stdio:'inherit',windowsHide:true});
