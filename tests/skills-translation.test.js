const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTranslator,translationPieces}=require('../src/skills/translation');
const success=text=>new Response(JSON.stringify({code:200,data:[{translations:[{text}]}]}));
test('keyless rotation, cached reuse and failure cooldown preserve original on total outage',async()=>{
  const calls=[];let offline=false;
  const translator=createTranslator({interval:0,fetcher:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);if(offline)return new Response('{}',{status:429});return url.includes('suapi')?success('中文结果'):new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:'中文备用'}}));}});
  assert.equal((await translator.translate({id:'one',text:'Research methods',providers:['suapi','mymemory']})).text,'中文结果');
  assert.equal((await translator.translate({id:'two',text:'Literature review',providers:['suapi','mymemory']})).text,'中文备用');
  await translator.translate({id:'three',text:'Research methods',providers:['suapi','mymemory']});assert.equal(calls.length,2);
  offline=true;const value=await translator.translate({id:'four',text:'New description\nAnother description',providers:['suapi','mymemory']});assert.equal(value.complete,false);assert.equal(value.text,'New description\nAnother description');assert.equal(calls.length,4,'each failed provider is cooled down');
});
test('failed primary automatically selects backup; HTML or invalid JSON never counts as translation',async()=>{
  const translator=createTranslator({interval:0,fetcher:async url=>url.includes('suapi')?new Response('<html>error</html>'):new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:'备用译文'}}))});
  const result=await translator.translate({id:'fallback',text:'Research',providers:['suapi','mymemory']});assert.equal(result.text,'备用译文');assert.deepEqual(result.providers,['mymemory']);
});
test('Markdown code and URLs remain untouched, Unicode segments fit service byte limits',()=>{
  const text='---\nname: test\n---\n# Research\n```js\nconst secret = "unchanged";\n```\nUse `run()` and https://example.com/path\n'+'Long text 文😀 '.repeat(150);
  const pieces=translationPieces(text);assert.equal(pieces.map(p=>p.text).join(''),text);assert.ok(pieces.filter(p=>p.translate).every(p=>Buffer.byteLength(p.text)<=450));assert.ok(!pieces.filter(p=>p.translate).some(p=>p.text.includes('secret')||p.text.includes('https://')||p.text.includes('run()')||p.text.includes('name:')));
});
test('cancellation aborts network without retrying another service',async()=>{
  let started,abortSeen=false;const ready=new Promise(resolve=>started=resolve);
  const translator=createTranslator({interval:0,fetcher:async(url,options)=>new Promise((resolve,reject)=>{started();options.signal.addEventListener('abort',()=>{abortSeen=true;reject(Error('aborted'))})})});
  const job=translator.translate({id:'cancel',text:'Research methods',providers:['suapi','mymemory']});await ready;translator.cancel({id:'cancel'});await assert.rejects(job,/取消/);assert.equal(abortSeen,true);
});
test('invalid requests are rejected before any network call',async()=>{
  const translator=createTranslator({fetcher:async()=>{throw Error('must not call')}});
  await assert.rejects(translator.translate({id:'x',text:'Research',providers:['arbitrary']}),/服务/);
  await assert.rejects(translator.translate({id:'x',text:'x'.repeat(60001),providers:['suapi']}),/60000/);
});
