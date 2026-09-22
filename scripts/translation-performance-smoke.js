'use strict';
// Synthetic network latency only; no skill files or external services are read.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const baseline=process.argv.includes('--baseline');
const {createTranslator}=require(path.resolve(baseline?'output/translation-baseline.cjs':'src/skills/translation.js'));
const body=Array.from({length:20},(_,i)=>'Research paragraph number '+i).concat(Array.from({length:5},(_,i)=>'  Research paragraph number '+i+'  ')).join('\n');
let active=0,peak=0,calls=0,firstVisible=null;const activeByHost=new Map();
const translator=createTranslator({interval:40,fetcher:async url=>{
  const parsed=new URL(url),host=parsed.hostname;calls++;active++;peak=Math.max(peak,active);
  activeByHost.set(host,(activeByHost.get(host)||0)+1);assert.equal(activeByHost.get(host),1,'each provider remains serial');
  await new Promise(resolve=>setTimeout(resolve,80));active--;activeByHost.set(host,activeByHost.get(host)-1);
  const text='译文 '+(parsed.searchParams.get('text[]')||parsed.searchParams.get('q'));
  return new Response(JSON.stringify(host==='suapi.net'?{code:200,data:[{translations:[{text}]}]}:{responseStatus:200,responseData:{translatedText:text}}));
}});
(async()=>{
  const started=performance.now();const result=await translator.translate({id:'performance',text:body,providers:['suapi','mymemory']},()=>{firstVisible??=performance.now()-started;});
  const elapsedMs=performance.now()-started;assert.equal(result.complete,true);assert.equal(result.text.split('\n').length,25);
  const initialCalls=calls;await translator.translate({id:'cached',text:body,providers:['suapi','mymemory']});assert.equal(calls,initialCalls);
  if(!baseline){assert.equal(peak,2);assert.equal(calls,20);assert.ok(firstVisible<elapsedMs);}
  const metrics={synthetic:true,paragraphs:25,uniqueParagraphs:20,requestDelayMs:80,providerIntervalMs:40,requests:calls,peakRequests:peak,firstVisibleMs:Math.round(firstVisible??elapsedMs),elapsedMs:Math.round(elapsedMs),cachedRepeatRequests:calls-initialCalls};
  fs.mkdirSync('output/translation-performance',{recursive:true});fs.writeFileSync(`output/translation-performance/${baseline?'before':'after'}.json`,JSON.stringify(metrics,null,2));console.log('TRANSLATION PERFORMANCE PASS '+JSON.stringify(metrics));
})().catch(error=>{console.error(error);process.exitCode=1});
