'use strict';
const crypto=require('node:crypto');
const PROVIDERS=[{id:'suapi',name:'速API',domain:'suapi.net'},{id:'qvqa',name:'简心API',domain:'api.qvqa.cn'},{id:'mymemory',name:'MyMemory',domain:'api.mymemory.translated.net'}];
// Public, keyless services only. No account credentials or arbitrary endpoints enter this module.
function createTranslator({fetcher=fetch,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),interval=650}={}){
  const cache=new Map(),health=new Map(),jobs=new Map(),lanes=new Map();let turn=0;
  function cancel({id}={}){jobs.get(id)?.abort();return {cancelled:true};}
  function waitFor(promise,signal){
    return new Promise((resolve,reject)=>{
      const aborted=()=>{signal.removeEventListener('abort',aborted);reject(signal.reason);};
      if(signal.aborted)return aborted();signal.addEventListener('abort',aborted,{once:true});
      Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',aborted);resolve(value);},error=>{signal.removeEventListener('abort',aborted);reject(error);});
    });
  }
  async function request(provider,text,signal){
    // Independent services can work together; each keeps one shared serial lane.
    let lane=lanes.get(provider.id);if(!lane){lane={queue:Promise.resolve(),lastRequest:-Infinity,pending:0};lanes.set(provider.id,lane);}
    lane.pending++;
    const previous=lane.queue;let release;lane.queue=new Promise(resolve=>{release=resolve});
    try{await waitFor(previous,signal);signal.throwIfAborted();if((health.get(provider.id)?.until||0)>now())return null;
      const delay=lane.lastRequest+interval-now();if(delay>0)await waitFor(wait(delay),signal);signal.throwIfAborted();lane.lastRequest=now();
      const url=new URL(provider.id==='suapi'?'https://suapi.net/api/text/translate':provider.id==='qvqa'?'https://api.qvqa.cn/api/fanyi':'https://api.mymemory.translated.net/get');
      if(provider.id==='suapi'){url.searchParams.set('from','en');url.searchParams.set('to','zh-Hans');url.searchParams.append('text[]',text);}
      else if(provider.id==='qvqa'){url.searchParams.set('source','en');url.searchParams.set('target','zh');url.searchParams.set('text',text);}
      else{url.searchParams.set('langpair','en|zh-CN');url.searchParams.set('q',text);}
      const response=await fetcher(url.href,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{Accept:'application/json'}});
      if(!response.ok){await response.body?.cancel();throw Object.assign(Error('服务暂不可用'),{retry:response.status===429?Math.max(60000,Math.min(86400000,Number(response.headers.get('retry-after'))*1000||60000)):0});}
      let length=0;const parts=[];for await(const part of response.body){length+=part.length;if(length>128000)throw Error('响应过大');parts.push(part);}
      const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(provider.id==='mymemory'&&(value.quotaFinished||Number(value.responseStatus)===429))throw Object.assign(Error('免费额度暂不可用'),{retry:86400000});
      const result=provider.id==='suapi'&&value.code===200?value.data?.[0]?.translations?.[0]?.text:provider.id==='qvqa'&&(value.code===undefined||Number(value.code)===200)?value.data?.targetText:provider.id==='mymemory'&&Number(value.responseStatus)===200&&!value.quotaFinished?value.responseData?.translatedText:null;
      if(typeof result!=='string'||!result.trim()||result.length>12000)throw Error('翻译响应无效');
      health.set(provider.id,{failures:0,until:0});return result;
    }catch(error){
      if(!signal.aborted){const failures=(health.get(provider.id)?.failures||0)+1;health.set(provider.id,{failures,until:now()+(error.retry||Math.min(300000,30000*2**Math.min(failures-1,4)))});}
      throw error;
    // A cancelled waiter can leave immediately, but cannot open the lane before
    // its predecessor finishes (another job may still own that connection).
    }finally{lane.pending--;previous.then(release,release);}
  }
  async function segment(text,selected,signal){
    const key=crypto.createHash('sha256').update(selected.join(',')+'\0'+text).digest('hex');
    if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return {...value,cached:true};}
    const start=turn++%selected.length;
    const ordered=selected.map((_,offset)=>selected[(start+offset)%selected.length]).sort((a,b)=>(lanes.get(a)?.pending||0)-(lanes.get(b)?.pending||0));
    for(const id of ordered){
      signal.throwIfAborted();const provider=PROVIDERS.find(p=>p.id===id),state=health.get(id)||{failures:0,until:0};
      if(state.until>now())continue;
      try{const translated=await request(provider,text,signal);signal.throwIfAborted();if(translated===null)continue;const value={text:translated.trim(),provider:id};if(cache.size>=1000)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
      catch(error){if(signal.aborted)throw error;}
    }
    return null;
  }
  async function translate(input={},onProgress){
    const {id,text,providers}=input;
    if(typeof id!=='string'||!/^[\w-]{1,80}$/.test(id)||typeof text!=='string'||!text.trim()||text.length>60000)throw Error('请选择有效文本；单次翻译最多 60000 字符。');
    if(!Array.isArray(providers)||!providers.length||providers.length>PROVIDERS.length||providers.some(id=>!PROVIDERS.some(p=>p.id===id)))throw Error('请选择可用的翻译服务。');
    if(jobs.has(id)||jobs.size>=4)throw Error('已有翻译任务，请等待或取消后重试。');
    const controller=new AbortController();jobs.set(id,controller);const selected=[...new Set(providers)],used=new Set();let failed=0,cached=0;
    try{const pieces=translationPieces(text),output=pieces.map(piece=>piece.text),groups=new Map();let total=0,completed=0,lastProgress=-Infinity;
      for(let index=0;index<pieces.length;index++){const piece=pieces[index];if(!piece.translate)continue;total++;const key=piece.text.trim();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(index);}
      const work=[...groups];let cursor=0;
      const progress=()=>{if(typeof onProgress!=='function'||controller.signal.aborted)return;const time=now();if(completed!==total&&time-lastProgress<150)return;lastProgress=time;
        try{onProgress({id,text:output.join(''),complete:false,completedSegments:completed,totalSegments:total,failedSegments:failed,cachedSegments:cached,providers:[...used]});}catch{/* A detached view must not invalidate successful translation. */}
      };
      // De-duplicate within a body before scheduling. At most one worker per
      // selected service, capped at three per body, keeps large documents bounded.
      const worker=async()=>{while(cursor<work.length){controller.signal.throwIfAborted();const [source,indices]=work[cursor++];const result=await segment(source,selected,controller.signal);controller.signal.throwIfAborted();
        for(const index of indices){if(result){const original=pieces[index].text;output[index]=original.match(/^\s*/)[0]+result.text+original.match(/\s*$/)[0];} }
        if(result){used.add(result.provider);if(result.cached)cached+=indices.length;}else failed+=indices.length;
        completed+=indices.length;progress();
      }};
      const workers=Array.from({length:Math.min(3,selected.length,work.length)},()=>worker());
      const settled=await Promise.allSettled(workers);const rejected=settled.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
      return {text:output.join(''),complete:failed===0,failedSegments:failed,providers:[...used],cachedSegments:cached};
    }catch(error){if(controller.signal.aborted)throw Error('翻译已取消。');throw Error('翻译未完成，原文已保留。');}
    finally{jobs.delete(id);}
  }
  return {translate,cancel};
}
// Keep Markdown structure and code intact. MyMemory accepts at most 500 UTF-8 bytes per query.
function translationPieces(text){
  const pieces=[];let fenced=null,frontmatter=text.startsWith('---\n')||text.startsWith('---\r\n'),lineNumber=0;
  for(const line of text.split(/(\r?\n)/)){
    if(/^\r?\n$/.test(line)){pieces.push({text:line});continue;}
    if(frontmatter){pieces.push({text:line});if(lineNumber++>0&&/^---\s*$/.test(line))frontmatter=false;continue;}
    const fence=line.match(/^\s*(`{3,}|~{3,})/);if(fence){if(!fenced)fenced=fence[1][0];else if(fence[1][0]===fenced)fenced=null;pieces.push({text:line});continue;}
    if(fenced||/^ {4}|^\t/.test(line)||!/[A-Za-z]{3}/.test(line)){pieces.push({text:line});continue;}
    // Literal code, URLs and link destinations stay verbatim; labels and prose are translated.
    for(const part of line.split(/(`+[^`]+`+|https?:\/\/[^\s<>]+|\]\([^)]*\))/g)){
      if(!part)continue;if(/^`|^https?:\/\/|^\]\(/.test(part)){pieces.push({text:part});continue;}
      let buffer='';for(const word of part.split(/(\s+)/)){if(Buffer.byteLength(buffer+word)<=450){buffer+=word;continue;}if(buffer){pieces.push({text:buffer,translate:/[A-Za-z]{3}/.test(buffer)});buffer='';}for(const char of word){if(Buffer.byteLength(buffer+char)>450){pieces.push({text:buffer,translate:/[A-Za-z]{3}/.test(buffer)});buffer='';}buffer+=char;}}
      if(buffer)pieces.push({text:buffer,translate:/[A-Za-z]{3}/.test(buffer)});
    }
  }
  return pieces;
}
module.exports={createTranslator,translationPieces,PROVIDERS};
