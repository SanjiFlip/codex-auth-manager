'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {pipeline}=require('node:stream'),asar=require('@electron/asar'),yauzl=require('yauzl');
const root=path.resolve(process.argv[2]||'output/publish-release'),version=require('../package.json').version;
const source=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=cp.execFileSync('git',['ls-files','-z','src'],{encoding:'utf8'}).split('\0').filter(Boolean).concat(['package.json','docs/THIRD_PARTY.md','docs/ANTIGRAVITY.md']);
function compare(archive,workingTree){
  for(const file of files){
    const expected=workingTree?fs.readFileSync(file):cp.execFileSync('git',['show',source+':'+file]);
    assert.ok(asar.extractFile(archive,file.split('/').join(path.sep)).equals(expected),file+' differs in '+archive);
  }
  assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,version);
  return files.length;
}
function extractMac(archive,destination){
  const wanted=new Map([
    ['Contents/Resources/app.asar','app.asar'],
    ['Contents/Resources/app.asar.unpacked/src/windows-codex.ps1','app.asar.unpacked/src/windows-codex.ps1'],
    ['Contents/Info.plist','Info.plist'],
  ]);
  return new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);
    zip.on('error',reject);
    zip.on('entry',entry=>{
      const suffix=[...wanted.keys()].find(key=>entry.fileName.endsWith('/'+key));
      if(!suffix){zip.readEntry();return}
      if(entry.uncompressedSize>128*1024*1024){zip.close();reject(Error('Unexpected embedded file size'));return}
      const target=path.join(destination,wanted.get(suffix));wanted.delete(suffix);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      zip.openReadStream(entry,(err,stream)=>{
        if(err){zip.close();reject(err);return}
        pipeline(stream,fs.createWriteStream(target),failure=>{if(failure){zip.close();reject(failure)}else zip.readEntry()});
      });
    });
    zip.on('end',()=>{try{assert.equal(wanted.size,0,'Missing embedded app metadata');resolve()}catch(err){reject(err)}});
    zip.readEntry();
  }));
}
(async()=>{
  const expected=[`Codex-Auth-Manager-Setup-${version}-x64.exe`,...['arm64','x64'].flatMap(arch=>['dmg','zip'].map(ext=>`Codex-Auth-Manager-${version}-${arch}.${ext}`))];
  assert.deepEqual(fs.readdirSync(path.join(root,'assets')).sort(),expected.sort(),'Release must contain exactly five platform packages');
  for(const name of expected)assert.ok(fs.statSync(path.join(root,'assets',name)).size>0,'Empty package: '+name);
  console.log('Windows: '+compare(path.resolve('release/win-unpacked/resources/app.asar'),true)+' source and metadata files match the working tree.');
  for(const arch of ['arm64','x64']){
    const destination=path.join(root,'verified-'+arch);
    await extractMac(path.join(root,'assets',`Codex-Auth-Manager-${version}-${arch}.zip`),destination);
    const plist=fs.readFileSync(path.join(destination,'Info.plist'),'utf8');
    assert.equal(plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1],version,'Mac app version mismatch');
    console.log('macOS '+arch+': '+compare(path.join(destination,'app.asar'),false)+' source and metadata files match the checked commit; version '+version+'.');
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
