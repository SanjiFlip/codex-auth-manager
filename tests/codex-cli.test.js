const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {resolveCli}=require('../src/official-login');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cam-cli-resolution-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
async function file(name,text='fixture'){await fs.mkdir(path.dirname(name),{recursive:true});await fs.writeFile(name,text)}
test('npm wrapper resolves directly to its native executable without a shell or Node wrapper',async t=>{
  const root=await fixture(t);
  await file(path.join(root,'codex.cmd'));
  const pkg=path.join(root,'node_modules','@openai','codex');
  await file(path.join(pkg,'package.json'),'{"name":"@openai/codex"}');
  await file(path.join(pkg,'bin','codex.js'),'throw Error("wrapper must not execute")');
  const platform=path.join(pkg,'node_modules','@openai','codex-win32-x64');
  await file(path.join(platform,'package.json'),'{"name":"@openai/codex-win32-x64"}');
  const exe=path.join(platform,'vendor','x86_64-pc-windows-msvc','bin','codex.exe');await file(exe);
  assert.deepEqual(await resolveCli({env:{Path:root},arch:'x64'}),{command:await fs.realpath(exe),args:[]});
});
test('direct executable and bundled vendor layout work from paths containing spaces',async t=>{
  const root=await fixture(t),direct=path.join(root,'native folder','codex.exe');await file(direct);
  assert.deepEqual(await resolveCli({env:{PATH:path.dirname(direct)}}),{command:direct,args:[]});
  const npm=path.join(root,'npm folder');await file(path.join(npm,'codex.ps1'));
  const exe=path.join(npm,'node_modules','@openai','codex','vendor','aarch64-pc-windows-msvc','bin','codex.exe');await file(exe);
  assert.deepEqual(await resolveCli({env:{Path:npm},arch:'arm64'}),{command:await fs.realpath(exe),args:[]});
});
test('missing native package fails instead of falling back to a window-opening shim',async t=>{
  const root=await fixture(t);await file(path.join(root,'codex.cmd'));await file(path.join(root,'node_modules','@openai','codex','bin','codex.js'));
  await assert.rejects(resolveCli({env:{Path:root},arch:'x64'}),/原生|native/i);
});
