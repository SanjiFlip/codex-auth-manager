const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createTranslator}=require('../src/skills/translation');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(providers=['suapi']){
  const requests=[],jobs=[],inputs=[],cancelled=[],messages=[],subscribers=new Set(),handlers=[],deliveries=[],status={textContent:''},stop={hidden:true};let saved=JSON.stringify({enabled:true,providers}),settingsDialog,holdNextDelivery=false;
  const targets=['Market alpha','Market beta'].map(text=>{const result={innerHTML:''},button={};return {dataset:{tText:text},result,querySelector:selector=>selector==='.s-t-result'?result:button};});
  const translator=createTranslator({interval:0,fetcher:(_url,{signal})=>new Promise((resolve,reject)=>{requests.push({signal,finish:response=>resolve(response||new Response(JSON.stringify({code:200,data:[{translations:[{text:'中文译文'}]}]})))});signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});})});
  const api={skillsTranslate:input=>{inputs.push(input);let promise=translator.translate(input);if(holdNextDelivery){holdNextDelivery=false;promise=promise.then(value=>new Promise(resolve=>deliveries.push(()=>resolve(value))));}jobs.push(promise);return promise;},skillsCancelTranslation:input=>{cancelled.push(input.id);return Promise.resolve(translator.cancel(input));},onSkillsTranslationProgress:handler=>{subscribers.add(handler);handlers.push(handler);return ()=>subscribers.delete(handler);}};
  const document={body:{append:el=>settingsDialog=el},querySelectorAll:selector=>selector==='.s-t-status'?[status]:selector==='.s-t-stop'?[stop]:selector==='.s-translation-target'?targets:[],createElement:tag=>{
    if(tag==='dialog'){const el={...JSON.parse(saved),showModal(){},close(){this.onclose?.();},remove(){},querySelectorAll:()=>el.providers.map(value=>({value})),querySelector:()=>({checked:el.enabled})};return el;}
    const result={hidden:true},intro={hidden:true,innerHTML:''},pre={},attribution={};return {isConnected:true,dataset:{},querySelector:selector=>selector==='.s-t-intro-result'?intro:selector==='.s-t-detail-result'?result:selector==='.s-t-detail-result pre'?pre:selector==='.s-t-attribution'?attribution:null};}};
  const context={window:{},document,crypto,localStorage:{getItem:()=>saved,setItem:(_key,value)=>saved=value}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui/skill-translation.js'),'utf8'),context);
  const ui=context.window.createSkillTranslation({api,demo:false,toast:value=>messages.push(value),esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),onChange:()=>{}});
  function detail(text){let tools,close;const dialog={querySelector:()=>({after:value=>tools=value}),addEventListener:(_name,fn)=>close=fn};ui.attachDetail(dialog,text);return {start:()=>tools.onclick({target:{closest:selector=>selector==='[data-t-detail]'?{}:null}}),toggle:()=>tools.onclick({target:{closest:selector=>selector==='[data-t-original]'?{}:null}}),close:()=>{tools.isConnected=false;close();},get tools(){return tools;}};}
  function intro(text){let tools,close;const dialog={querySelector:()=>({after:value=>tools=value}),addEventListener:(_name,fn)=>close=fn};ui.attachIntro(dialog,text);return {start:()=>tools.onclick({target:{closest:selector=>selector==='[data-t-intro]'?{}:null}}),close:()=>{tools.isConnected=false;close();},get tools(){return tools;}};}
  const batch=()=>ui.handle({target:{closest:()=>({dataset:{tAction:'batch'}})}},{querySelectorAll:()=>targets});
  const cancel=()=>ui.handle({target:{closest:()=>({dataset:{tAction:'stop'}})}},{});
  const progress=(index=0,changes={})=>({id:inputs[index].id,text:'首段中文\nRemaining original',completedSegments:1,totalSegments:2,failedSegments:0,cachedSegments:0,providers:['suapi'],complete:false,...changes});
  const emit=value=>{for(const handler of subscribers)handler(value);};
  function settings(providers,enabled=true){ui.handle({target:{closest:()=>({dataset:{tAction:'settings'}})}},{});settingsDialog.providers=providers;settingsDialog.enabled=enabled;settingsDialog.onclick({target:{closest:selector=>selector==='[data-t-save]'?{}:null}});}
  return {requests,jobs,inputs,cancelled,messages,status,targets,detail,intro,batch,cancel,subscribers,handlers,progress,emit,settings,deliveries,holdDelivery:()=>holdNextDelivery=true};
}

test('introduction translation sends only its description, escapes progress and reuses explicit complete cache',async()=>{
  const f=fixture(),intro=f.intro('Read the skill introduction.');assert.equal(f.inputs.length,0);intro.start();await tick();assert.equal(f.inputs[0].text,'Read the skill introduction.');
  f.emit(f.progress(0,{text:'<img src=x onerror=alert(1)>'}));const view=intro.tools.querySelector('.s-t-intro-result');assert.equal(view.hidden,false);assert.ok(view.innerHTML.includes('&lt;img'));assert.ok(!view.innerHTML.includes('<img'));
  f.requests[0].finish();await f.jobs[0];await tick();assert.match(view.innerHTML,/中文译文/);assert.equal(f.subscribers.size,0);
  const reopened=f.intro('Read the skill introduction.');assert.equal(reopened.tools.querySelector('.s-t-intro-result').hidden,true);reopened.start();await tick();assert.equal(f.inputs.length,1);assert.match(reopened.tools.querySelector('.s-t-intro-result').innerHTML,/中文译文/);
});

test('introduction controls honor disabled and empty states; closing an intro only cancels its own task',async()=>{
  const f=fixture();assert.equal(f.intro(' ').tools,undefined);f.settings(['suapi'],false);assert.equal(f.intro('Private description').tools,undefined);assert.equal(f.inputs.length,0);f.settings(['suapi'],true);
  const old=f.intro('Old introduction');old.start();await tick();f.requests[0].finish();await f.jobs[0];await tick();
  const body=f.detail('Current body');body.start();await tick();old.close();assert.equal(f.requests[1].signal.aborted,false);f.requests[1].finish();await f.jobs[1];await tick();
  const current=f.intro('Current introduction');current.start();await tick();current.close();await assert.rejects(f.jobs[2],/取消/);await tick();assert.equal(f.cancelled.length,1);assert.equal(f.subscribers.size,0);
});

test('a delayed close event from an untranslated detail cannot cancel a newer list translation',async()=>{
  const f=fixture(),oldDetail=f.detail('Old detail body');
  f.batch();await tick();assert.equal(f.requests.length,1);
  oldDetail.close();
  assert.equal(f.requests[0].signal.aborted,false,'a detail without an owned job must not cancel market translation');
  f.requests[0].finish();await f.jobs[0];await tick();assert.equal(f.requests.length,2);
  f.requests[1].finish();await f.jobs[1];await tick();
  assert.equal(f.cancelled.length,0);assert.ok(f.targets.every(target=>target.result.innerHTML.includes('中文译文')));assert.match(f.status.textContent,/已翻译 2 项/);
});

test('closing an older detail leaves the current detail running; closing its owner cancels it',async()=>{
  const f=fixture(),oldDetail=f.detail('First detail body');oldDetail.start();await tick();f.requests[0].finish();await f.jobs[0];await tick();
  const current=f.detail('Second detail body');current.start();await tick();assert.equal(f.requests.length,2);
  oldDetail.close();assert.equal(f.requests[1].signal.aborted,false,'completed detail must not own the new request');
  current.close();await assert.rejects(f.jobs[1],/翻译已取消/);await tick();
  assert.equal(f.cancelled.length,1);assert.equal(f.status.textContent,'已停止');assert.equal(f.messages.length,0);
});

test('body progress is visible before the final invoke resolves and unsubscribes afterward',async()=>{
  const f=fixture(),detail=f.detail('Long detail body');detail.start();await tick();
  assert.equal(f.subscribers.size,1);f.emit(f.progress());
  assert.equal(detail.tools.querySelector('.s-t-detail-result').hidden,false);
  assert.equal(detail.tools.querySelector('.s-t-detail-result pre').textContent,'首段中文\nRemaining original');
  assert.match(f.status.textContent,/1\s*\/\s*2\s*段/);assert.match(detail.tools.querySelector('.s-t-attribution').textContent,/翻译中|正在翻译/);assert.match(detail.tools.querySelector('.s-t-attribution').textContent,/原文/);
  f.requests[0].finish();await f.jobs[0];await tick();assert.equal(f.subscribers.size,0);assert.match(detail.tools.querySelector('.s-t-attribution').textContent,/仅供阅读/);
});

test('explicit body clicks reuse complete renderer results without another invoke',async()=>{
  const f=fixture(),first=f.detail('Cached detail body');first.start();await tick();f.requests[0].finish();await f.jobs[0];await tick();
  const reopened=f.detail('Cached detail body');assert.equal(reopened.tools.querySelector('.s-t-detail-result').hidden,true,'cached body stays opt-in');reopened.start();await tick();
  assert.equal(f.jobs.length,1,'complete body cache must avoid an IPC call');assert.equal(reopened.tools.querySelector('.s-t-detail-result').hidden,false);assert.equal(reopened.tools.querySelector('.s-t-detail-result pre').textContent,'中文译文');assert.equal(f.subscribers.size,0);
});

test('late progress cannot change a cancelled, detached or replacement detail',async()=>{
  const f=fixture(),first=f.detail('Cancelled detail body');first.start();await tick();f.emit(f.progress());const oldHandler=f.handlers[0],before=first.tools.querySelector('.s-t-detail-result pre').textContent;
  first.close();f.emit(f.progress(0,{text:'late after cancel'}));assert.equal(first.tools.querySelector('.s-t-detail-result pre').textContent,before);await assert.rejects(f.jobs[0],/翻译已取消/);await tick();assert.equal(f.subscribers.size,0);
  const next=f.detail('Replacement detail body');next.start();await tick();oldHandler(f.progress(0,{text:'old queued callback'}));f.emit(f.progress(0,{text:'old request ID'}));assert.equal(next.tools.querySelector('.s-t-detail-result').hidden,true);
  f.emit(f.progress(1,{text:'current request'}));assert.equal(next.tools.querySelector('.s-t-detail-result pre').textContent,'current request');
  next.tools.isConnected=false;f.emit(f.progress(1,{text:'detached callback'}));assert.equal(next.tools.querySelector('.s-t-detail-result pre').textContent,'current request');next.close();await assert.rejects(f.jobs[1],/翻译已取消/);await tick();assert.equal(f.subscribers.size,0);
});

test('a partial final result is retried rather than treated as complete renderer cache',async()=>{
  const f=fixture(),first=f.detail('Unavailable detail body');first.start();await tick();f.requests[0].finish(new Response('{}',{status:503}));const partial=await f.jobs[0];await tick();assert.equal(partial.complete,false);
  const retry=f.detail('Unavailable detail body');retry.start();await tick();assert.equal(f.jobs.length,2);await f.jobs[1];await tick();assert.equal(f.subscribers.size,0);
});

test('manual stop preserves partial body, marks it stopped and ignores late progress',async()=>{
  const f=fixture(),detail=f.detail('Stopped detail body');detail.start();await tick();f.emit(f.progress());f.cancel();f.emit(f.progress(0,{text:'late progress'}));await assert.rejects(f.jobs[0],/翻译已取消/);await tick();
  assert.equal(detail.tools.querySelector('.s-t-detail-result pre').textContent,'首段中文\nRemaining original');assert.match(detail.tools.querySelector('.s-t-attribution').textContent,/已停止.*原文/);assert.equal(f.subscribers.size,0);
});

test('rejected translation unsubscribes from progress too',async()=>{
  const f=fixture(),detail=f.detail('x'.repeat(60001));detail.start();await tick();assert.equal(f.subscribers.size,0);assert.equal(f.requests.length,0);assert.match(f.messages[0],/60000/);
});

test('manual hide remains in effect through progress and completion until explicitly shown',async()=>{
  const f=fixture(),detail=f.detail('Hidden detail body');detail.start();await tick();f.emit(f.progress());detail.toggle();assert.equal(detail.tools.querySelector('.s-t-detail-result').hidden,true);
  f.emit(f.progress(0,{text:'next partial'}));assert.equal(detail.tools.querySelector('.s-t-detail-result').hidden,true);assert.equal(detail.tools.querySelector('.s-t-detail-result pre').textContent,'next partial');
  f.requests[0].finish();await f.jobs[0];await tick();assert.equal(detail.tools.querySelector('.s-t-detail-result').hidden,true);detail.start();await tick();assert.equal(detail.tools.querySelector('.s-t-detail-result').hidden,false);assert.equal(f.jobs.length,1);
});

test('adding a provider does not silently expand the saved selection',async()=>{
  const f=fixture(['suapi','mymemory']),detail=f.detail('Existing preference body');detail.start();await tick();assert.deepEqual(Array.from(f.inputs[0].providers),['suapi','mymemory']);f.requests[0].finish();await f.jobs[0];await tick();
});

test('saving a different provider selection invalidates completed body cache',async()=>{
  const f=fixture(),first=f.detail('Provider selection body');first.start();await tick();f.requests[0].finish();await f.jobs[0];await tick();
  f.settings(['qvqa']);const next=f.detail('Provider selection body');next.start();await tick();assert.equal(f.jobs.length,2,'newly selected provider must get a fresh invoke');assert.deepEqual(Array.from(f.inputs[1].providers),['qvqa']);
  f.requests[1].finish(new Response(JSON.stringify({data:{targetText:'新服务译文'}})));await f.jobs[1];await tick();assert.equal(next.tools.querySelector('.s-t-detail-result pre').textContent,'新服务译文');assert.match(next.tools.querySelector('.s-t-attribution').textContent,/简心API/);
});

test('saving only the enabled toggle preserves complete body cache',async()=>{
  const f=fixture(),first=f.detail('Toggle preference body');first.start();await tick();f.requests[0].finish();await f.jobs[0];await tick();f.settings(['suapi'],false);f.settings(['suapi'],true);
  const next=f.detail('Toggle preference body');next.start();await tick();assert.equal(f.jobs.length,1);assert.equal(next.tools.querySelector('.s-t-detail-result pre').textContent,'中文译文');
});

test('a completed old-provider reply arriving after settings change cannot refill renderer cache',async()=>{
  const f=fixture(),first=f.detail('Delayed old service body');f.holdDelivery();first.start();await tick();f.requests[0].finish();await tick();assert.equal(f.deliveries.length,1,'backend completed while invoke delivery is held');
  f.settings(['qvqa']);f.deliveries[0]();await f.jobs[0];await tick();assert.equal(f.cancelled.length,1);
  const next=f.detail('Delayed old service body');next.start();await tick();assert.equal(f.jobs.length,2);assert.deepEqual(Array.from(f.inputs[1].providers),['qvqa']);
  f.requests[1].finish(new Response(JSON.stringify({data:{targetText:'当前服务译文'}})));await f.jobs[1];await tick();assert.equal(next.tools.querySelector('.s-t-detail-result pre').textContent,'当前服务译文');
});

test('translation IPC accepts only the originating main frame and never forwards to another window',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),start=source.indexOf("ipcMain.handle('skills:translate'"),end=source.indexOf('\n  });',start);
  assert.ok(start>=0&&end>start,'translation requires its own guarded progress handler');
  const sent=[],sender={mainFrame:{},isDestroyed:()=>false,send:(...args)=>sent.push(args)};let handler,progress,calls=0;
  const context={ipcMain:{handle:(_channel,value)=>handler=value},mainWindow:{webContents:sender},skillsManager:{translate:(_input,callback)=>{calls++;progress=callback;return Promise.resolve({text:'done'});}}};
  vm.runInNewContext(source.slice(start,end+'\n  });'.length),context);
  const invoke=event=>Promise.resolve().then(()=>handler(event,{id:'request'}));
  await assert.rejects(invoke({sender:{mainFrame:{}},senderFrame:{}}),/不允许/);await assert.rejects(invoke({sender,senderFrame:{}}),/不允许/);assert.equal(calls,0);
  await invoke({sender,senderFrame:sender.mainFrame});progress({id:'request',text:'partial'});assert.deepEqual(sent,[['skills:translation-progress',{id:'request',text:'partial'}]]);
  const frame=sender.mainFrame;sender.mainFrame={};progress({id:'request',text:'new frame'});assert.equal(sent.length,1);sender.mainFrame=frame;
  context.mainWindow={webContents:{}};progress({id:'request',text:'old window'});assert.equal(sent.length,1);
  context.mainWindow={webContents:sender};sender.isDestroyed=()=>true;progress({id:'request',text:'destroyed'});assert.equal(sent.length,1);
});

test('preload progress subscription strips the Electron event and removes its listener',()=>{
  const listeners=new Map();let api;
  const electron={contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer:{on:(name,handler)=>listeners.set(name,handler),removeListener:(name,handler)=>{assert.equal(listeners.get(name),handler);listeners.delete(name);}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.js'),'utf8'),{require:()=>electron});
  assert.equal(typeof api.onSkillsTranslationProgress,'function');const received=[],unsubscribe=api.onSkillsTranslationProgress(value=>received.push(value)),payload={id:'request',text:'partial'};
  listeners.get('skills:translation-progress')({sender:'private event'},payload);assert.deepEqual(received,[payload]);unsubscribe();assert.equal(listeners.size,0);
});
