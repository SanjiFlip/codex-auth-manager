'use strict';
module.exports=async context=>{
  if(context.electronPlatformName==='win32')require('node:child_process').execFileSync('node',[require('node:path').join(__dirname,'build-native.js')],{stdio:'inherit',windowsHide:true});
};
