const crypto=require('node:crypto');
const commit='a'.repeat(40);
const files={
  'skills/daily-notes/SKILL.md':'---\nname: daily-notes\ndescription: 整理日常工作笔记与待办事项。\n---\n\n# Daily notes\n\n记录已决定事项与待确认问题。',
  'skills/daily-notes/references/example.md':'Synthetic skill reference.',
  'skills/research-review/SKILL.md':'---\nname: research-review\ndescription: 组织科研问题、证据与验证计划。\n---\n\n# Research review\n\n区分事实、假设和待核实结论。',
  'LICENSE':'MIT License\nSynthetic fixture only.',
};
const blob=text=>crypto.createHash('sha1').update(Buffer.from(`blob ${Buffer.byteLength(text)}\0`)).update(text).digest('hex');
function createRepositoryFixture(){const requests=[];let failure=false,corrupt=false,extra=[];
  const fetcher=async url=>{requests.push(url);if(failure)throw Error('Offline fixture');let value;
    if(url.includes('/commits/'))value={sha:commit};
    else if(url.includes('/git/trees/'))value={truncated:false,tree:[...Object.entries(files).map(([path,text])=>({path,type:'blob',mode:'100644',size:Buffer.byteLength(text),sha:blob(text)})),...extra]};
    else if(url.startsWith('https://raw.githubusercontent.com/')){const file=decodeURIComponent(url.split('/'+commit+'/')[1]);return new Response(corrupt?'changed':files[file],{status:files[file]?200:404});}
    else return new Response('',{status:404});return new Response(JSON.stringify(value));};
  return {fetcher,requests,files,commit,setFailure:v=>failure=v,setCorrupt:v=>corrupt=v,setExtra:v=>extra=v};
}
module.exports={createRepositoryFixture};
