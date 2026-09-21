// Compare the current implementation against a checked-in baseline, using synthetic data only.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const Module = require('node:module'), { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const baseline = process.argv[2] || '55e95f0';
function old(relative) {
  const file = path.resolve(relative), mod = new Module(file, module);
  mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod._compile(execFileSync('git', ['show', `${baseline}:${relative}`], { encoding: 'utf8' }), file);
  return mod.exports;
}
async function measure(fn) { const start = performance.now(); await fn(); return +(performance.now() - start).toFixed(2); }
async function run() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(),'cam-benchmark-'));
  try {
    await fs.mkdir(path.join(home,'sessions'));
    const row = n => JSON.stringify({type:'response_item',payload:{type:'message',role:n%2?'assistant':'user',content:[{type:'input_text',text:'Synthetic message '+n+' '+ 'x'.repeat(400)}]}});
    const small = Array.from({length:100},(_,i)=>row(i)).join('\n');
    for(let i=0;i<200;i++)await fs.writeFile(path.join(home,'sessions',`sample-${String(i).padStart(3,'0')}.jsonl`),small);
    await fs.writeFile(path.join(home,'sessions','large.jsonl'),Array.from({length:4000},(_,i)=>row(i)).join('\n'));
    require('./fixtures/knowledge-index').writeKnowledgeIndex(home,(await fs.readdir(path.join(home,'sessions'))).map(file=>({id:file,title:path.basename(file,'.jsonl'),file:path.join(home,'sessions',file)})));
    const report = {baseline,fixture:{files:201,largeFileMessages:4000,parallelRequests:12},results:{}};
    for(const [name,libModule,cacheModule] of [['before',old('src/knowledge/sessions.js'),old('src/quota/local-data-cache.js')],['after',require('../src/knowledge/sessions'),require('../src/quota/local-data-cache')]]){
      const lib = libModule.createSessionLibrary(home);let list;
      const coldListMs = await measure(async()=>{list=await lib.list()});
      const warmListFiveReadsMs = await measure(async()=>{for(let i=0;i<5;i++)await lib.list()});
      const id = list.items.find(x=>x.title==='large').id;
      const coldTranscriptMs = await measure(()=>lib.transcript(id));
      const warmTranscriptFiveReadsMs = await measure(async()=>{for(let i=0;i<5;i++)await lib.transcript(id)});
      let loaderCalls=0;const cache=cacheModule.createLocalDataCache();
      await Promise.all(Array.from({length:12},()=>cache.cached('same-dashboard',async()=>{loaderCalls++;await new Promise(r=>setTimeout(r,5));return {value:1}})));
      report.results[name]={coldListMs,warmListFiveReadsMs,coldTranscriptMs,warmTranscriptFiveReadsMs,loaderCalls};
    }
    await fs.mkdir('output/design',{recursive:true});await fs.writeFile('output/design/performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await fs.rm(home,{recursive:true,force:true})}
}
run().catch(e=>{console.error(e);process.exitCode=1});
