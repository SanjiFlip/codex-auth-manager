const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTranslator}=require('../src/skills/translation');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(url,text)=>new Response(JSON.stringify(url.includes('suapi.net')?{code:200,data:[{translations:[{text}]}]}:{responseStatus:200,responseData:{translatedText:text}}));
function gated(){
  const requests=[];
  const translator=createTranslator({interval:0,fetcher:(url,{signal})=>new Promise((resolve,reject)=>{
    const source=new URL(url).searchParams.get('text[]')||new URL(url).searchParams.get('q');
    requests.push({url,source,signal,finish:()=>resolve(response(url,'译文 '+source))});
    signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
  })});
  return {translator,requests};
}

test('body translation uses both services concurrently and displays progress before the whole body completes',async()=>{
  const {translator,requests}=gated(),progress=[];
  const job=translator.translate({id:'body',text:'First paragraph\nSecond paragraph\nThird paragraph',providers:['suapi','mymemory']},value=>progress.push(value));
  try{
    await tick();assert.equal(requests.length,2,'independent services must not wait for each other');
    requests[1].finish();await tick();
    assert.ok(progress.some(p=>p.completedSegments===1&&p.totalSegments===3&&p.text.includes('译文 Second paragraph')),'completed paragraphs must arrive before the last request');
    requests[0].finish();await tick();
    for(const request of requests.slice(2))request.finish();
    const result=await job;assert.equal(result.text,'译文 First paragraph\n译文 Second paragraph\n译文 Third paragraph');
  }finally{translator.cancel({id:'body'});await job.catch(()=>{});}
});

test('a selected service remains serial across simultaneous jobs and cancellation aborts all active body requests',async()=>{
  const {translator,requests}=gated();
  const first=translator.translate({id:'first',text:'First paragraph\nSecond paragraph',providers:['suapi']});
  const second=translator.translate({id:'second',text:'Other paragraph',providers:['suapi']});
  try{
    await tick();assert.equal(requests.length,1);requests[0].finish();await tick();assert.equal(requests.length,2);
    translator.cancel({id:'first'});translator.cancel({id:'second'});
    await assert.rejects(first,/取消/);await assert.rejects(second,/取消/);
    assert.ok(requests.slice(1).every(r=>r.signal.aborted));
  }finally{translator.cancel({id:'first'});translator.cancel({id:'second'});await Promise.allSettled([first,second]);}
});

test('repeated paragraphs share one request, preserve whitespace and reuse completed segments after cancellation',async()=>{
  const {translator,requests}=gated(),text='Repeated paragraph\nRepeated paragraph\n  Repeated paragraph  \nOther paragraph';
  const job=translator.translate({id:'repeat',text,providers:['suapi','mymemory']});
  try{
    await tick();assert.equal(requests.length,2,'two unique paragraphs should run, without duplicate requests');assert.equal(requests.filter(r=>r.source==='Repeated paragraph').length,1);
    requests[0].finish();await tick();assert.equal(requests.length,2);
    translator.cancel({id:'repeat'});await assert.rejects(job,/取消/);
    const retry=translator.translate({id:'retry',text,providers:['suapi','mymemory']});
    await tick();assert.equal(requests.length,3,'only the unfinished paragraph is requested again');requests[2].finish();
    const result=await retry;assert.equal(result.text,'译文 Repeated paragraph\n译文 Repeated paragraph\n  译文 Repeated paragraph  \n译文 Other paragraph');assert.equal(result.cachedSegments,3);
  }finally{translator.cancel({id:'repeat'});translator.cancel({id:'retry'});await job.catch(()=>{});}
});

test('provider failure cools queued work before it sends and uses the healthy lane',async()=>{
  let primary=0,backup=0;
  const translator=createTranslator({interval:0,fetcher:async url=>{
    if(url.includes('suapi.net')){primary++;return new Response('{}',{status:429});}
    backup++;return response(url,'可用译文');
  }});
  const result=await translator.translate({id:'failover',text:'One paragraph\nTwo paragraphs\nThree paragraphs\nFour paragraphs',providers:['suapi','mymemory']});
  assert.equal(primary,1);assert.equal(backup,4);assert.equal(result.complete,true);
});

test('a slow provider does not make the next paragraph queue behind it when another provider is free',async()=>{
  const {translator,requests}=gated();
  const job=translator.translate({id:'slow',text:'Slow first paragraph\nFast second paragraph\nFast third paragraph',providers:['suapi','mymemory']});
  try{
    await tick();assert.equal(requests.length,2);requests[1].finish();await tick();
    assert.equal(requests.length,3,'the free service should immediately take more work');assert.ok(requests[2].url.includes('mymemory'));
    requests[2].finish();requests[0].finish();assert.equal((await job).complete,true);
  }finally{translator.cancel({id:'slow'});await job.catch(()=>{});}
});

test('cancelling only a queued job releases its id without opening the busy provider lane',async()=>{
  const {translator,requests}=gated();
  const first=translator.translate({id:'owner',text:'First owner paragraph',providers:['suapi']});
  let cancelled=false;const queued=translator.translate({id:'queued',text:'Queued paragraph',providers:['suapi']}).catch(error=>{assert.match(error.message,/取消/);cancelled=true;});
  let retry;
  try{
    await tick();translator.cancel({id:'queued'});await tick();assert.equal(cancelled,true,'cancellation must not wait for unrelated network work');
    retry=translator.translate({id:'queued',text:'Retry paragraph',providers:['suapi']});await tick();assert.equal(requests.length,1,'cancellation must not let the retry overlap the owner');
    requests[0].finish();await tick();assert.equal(requests.length,2);requests[1].finish();await Promise.all([first,queued,retry]);
  }finally{translator.cancel({id:'owner'});translator.cancel({id:'queued'});await Promise.allSettled([first,queued,retry]);}
});

test('the added keyless provider accepts the current documented payload and remains opt-in',async()=>{
  const calls=[];
  const translator=createTranslator({interval:0,fetcher:async(url,options)=>{calls.push(url);const parsed=new URL(url);assert.equal(parsed.origin,'https://api.qvqa.cn');assert.equal(parsed.pathname,'/api/fanyi');assert.equal(parsed.searchParams.get('source'),'en');assert.equal(parsed.searchParams.get('target'),'zh');assert.equal(parsed.searchParams.get('text'),'Research methods');assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');return new Response(JSON.stringify({meta:{version:'2.1.5'},data:{sourceText:'Research methods',targetText:'研究方法'}}));}});
  assert.equal((await translator.translate({id:'added',text:'Research methods',providers:['qvqa']})).text,'研究方法');assert.equal(calls.length,1);
  const old=[];await createTranslator({interval:0,fetcher:async url=>{old.push(url);return response(url,'译文');}}).translate({id:'original',text:'First paragraph\nSecond paragraph\nThird paragraph',providers:['suapi','mymemory']});assert.ok(old.every(url=>!url.includes('qvqa')));
});

test('keyless third-provider error responses fall back without being displayed as successful translations',async()=>{
  const translator=createTranslator({interval:0,fetcher:async url=>url.includes('qvqa')?new Response(JSON.stringify({code:429,data:{targetText:'error page'}})):response(url,'备用中文')});
  const result=await translator.translate({id:'third-error',text:'Research methods',providers:['qvqa','mymemory']});assert.equal(result.text,'备用中文');assert.deepEqual(result.providers,['mymemory']);
});

test('rate-limit waits remain cancellable and each provider retains its request-start interval',async()=>{
  let time=1000;const starts=[];
  const translator=createTranslator({now:()=>time,interval:650,wait:async delay=>{time+=delay;},fetcher:async url=>{starts.push(time);return response(url,'中文');}});
  await translator.translate({id:'paced',text:'First paragraph\nSecond paragraph\nThird paragraph',providers:['suapi']});assert.deepEqual(starts,[1000,1650,2300]);
  let waiting=false,calls=0;
  const stopped=createTranslator({now:()=>1000,interval:650,wait:()=>{waiting=true;return new Promise(()=>{});},fetcher:async url=>{calls++;return response(url,'中文');}});
  const job=stopped.translate({id:'throttle',text:'First paragraph\nSecond paragraph',providers:['suapi']});await tick();assert.equal(waiting,true);stopped.cancel({id:'throttle'});await assert.rejects(job,/取消/);assert.equal(calls,1);
});
