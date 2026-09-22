'use strict';
window.createSkillTranslation=({api,demo,toast,esc,onChange})=>{
  const names={suapi:'速API',qvqa:'简心API',mymemory:'MyMemory'},results=new Map();let running=false,stopped=false,requestId=null,activeDetail=null;
  let config={enabled:false,providers:['suapi','qvqa','mymemory']};
  try{const saved=JSON.parse(localStorage.getItem('cam-skills-translation')||'null');if(saved&&typeof saved.enabled==='boolean'&&Array.isArray(saved.providers)){const providers=saved.providers.filter(id=>names[id]);if(providers.length)config={enabled:saved.enabled,providers};}}catch{}
  const content=text=>{const r=results.get(text);return r?`<p class="s-translated-text">${esc(r.text)}</p><small>${esc(r.providers.map(id=>names[id]).join(' / ')||(r.complete?'原文无需翻译':'暂不可用'))}${r.complete?' · 机器翻译':' · 部分失败，保留原文'}</small>`:'';};
  function controls(){return `<div class="s-translation-toolbar"><button class="btn" data-t-action="settings">${config.enabled?'中文翻译已开启':'翻译设置'}</button>${config.enabled?'<button class="btn" data-t-action="batch">翻译当前列表</button>':''}<button class="btn s-t-stop" data-t-action="stop" ${running?'':'hidden'}>停止翻译</button><span class="s-t-status" role="status">${running?'翻译中…':''}</span></div>`;}
  function card(text){return config.enabled?`<div class="s-translation-target" data-t-text="${esc(text)}"><div class="s-t-result">${content(text)}</div><button class="btn" data-t-action="one">${results.get(text)?.complete?'已翻译':results.has(text)?'重试翻译':'译成中文'}</button></div>`:'';}
  function status(message=''){document.querySelectorAll('.s-t-status').forEach(el=>{el.textContent=message});document.querySelectorAll('.s-t-stop').forEach(el=>{el.hidden=!running});}
  function refresh(){for(const el of document.querySelectorAll('.s-translation-target')){el.querySelector('.s-t-result').innerHTML=content(el.dataset.tText);const result=results.get(el.dataset.tText),button=el.querySelector('[data-t-action=one]');button.textContent=result?.complete?'已翻译':result?'重试翻译':'译成中文';button.disabled=!!result?.complete;}}
  function stop(){stopped=true;if(requestId)api.skillsCancelTranslation({id:requestId}).catch(()=>{});status('正在停止…');}
  function showDetail(detail,result,phase='complete'){
    if(!detail?.isConnected)return;
    detail.querySelector('.s-t-detail-result pre').textContent=result.text;const view=detail.querySelector('.s-t-detail-result');view.hidden=detail.dataset.tHidden==='true';const toggle=detail.querySelector('[data-t-original]');if(toggle)toggle.textContent=view.hidden?'显示译文':'隐藏译文';
    const source=result.providers.map(id=>names[id]).join(' / ')||(phase!=='complete'?'中文辅助阅读':result.complete?'原文无需翻译':'暂不可用');
    detail.querySelector('.s-t-attribution').textContent=source+(phase==='stopped'?' · 翻译已停止，未完成段落保留原文':phase==='pending'?' · 正在翻译，未完成段落保留原文':result.complete?' · 机器翻译，仅供阅读':' · 部分失败，相应段落保留原文');
  }
  function settings(){
    const el=document.createElement('dialog');el.className='s-dialog';el.id='skill-translation-settings';
    el.innerHTML=`<div class="modal-header"><h2>中文辅助阅读</h2><button class="close-btn" data-t-close aria-label="关闭">×</button></div><p class="help-text">无需 Key，默认关闭。开启后，点击单个技能或“翻译当前列表”才发送文本。译文用于阅读，实际技能文件保持原文。</p><label class="s-translation-option"><input type="checkbox" name="translation-enabled" ${config.enabled?'checked':''}>开启可选翻译</label><h3>免费公共服务</h3><p class="help-text">优先使用空闲服务，最多 3 路；故障自动切换，并暂时避开超时或限流的服务。</p>${[['suapi','速API','suapi.net · 国内公共接口'],['qvqa','简心API','api.qvqa.cn · 国内公共接口，额度未公布'],['mymemory','MyMemory','api.mymemory.translated.net · 国际备用，匿名额度有限']].map(([id,name,detail])=>`<label class="s-translation-option"><input type="checkbox" name="translation-provider" value="${id}" ${config.providers.includes(id)?'checked':''}><span><strong>${name}</strong><small>${detail}</small></span></label>`).join('')}<p class="s-notice">所选名称、说明或详情正文会发送给勾选的第三方服务；本地和私有技能也一样。敏感内容请保持原文。公共接口可能失效或限流，不承诺始终可用；结果仅缓存在本次应用内存中。</p><div class="modal-actions"><button class="btn" data-t-close>取消</button><button class="btn primary" data-t-save>保存设置</button></div>`;
    el.onclick=e=>{if(e.target.closest('[data-t-close]'))return el.close();if(!e.target.closest('[data-t-save]'))return;const providers=[...el.querySelectorAll('[name=translation-provider]:checked')].map(n=>n.value);if(!providers.length)return toast('至少选择一个翻译服务。');if(running)stop();if(providers.length!==config.providers.length||providers.some(id=>!config.providers.includes(id)))results.clear();config={enabled:el.querySelector('[name=translation-enabled]').checked,providers};localStorage.setItem('cam-skills-translation',JSON.stringify(config));el.close();onChange();};el.onclose=()=>el.remove();document.body.append(el);el.showModal();
  }
  async function run(texts,detail){
    if(!config.enabled)return toast('请先在“翻译设置”中开启可选翻译。');if(demo)return toast('演示模式不调用在线翻译。');if(running)return toast('已有翻译任务，可停止后重试。');
    running=true;stopped=false;activeDetail=detail||null;let completed=0,partial=0,unsubscribe,lastProgress;
    try{
      unsubscribe=api.onSkillsTranslationProgress?.(progress=>{
        if(!running||stopped||progress?.id!==requestId||detail&&(activeDetail!==detail||!detail.isConnected))return;
        lastProgress=progress;status(`翻译 ${progress.completedSegments} / ${progress.totalSegments} 段…`);if(detail)showDetail(detail,progress,'pending');
      });
      for(const text of texts){if(stopped)break;requestId=crypto.randomUUID();status(`翻译 ${completed+1} / ${texts.length}…`);
        const cached=detail&&results.get(text),result=cached?.complete?cached:await api.skillsTranslate({id:requestId,text,providers:[...config.providers]});if(stopped)break;
        if(results.size>=100)results.delete(results.keys().next().value);results.set(text,result);if(!result.complete)partial++;completed++;refresh();
        showDetail(detail,result);
        if(!result.complete&&!result.providers.length)break;
      }}catch(e){if(!stopped)toast(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}
    finally{unsubscribe?.();if(stopped&&lastProgress)showDetail(detail,lastProgress,'stopped');running=false;requestId=null;activeDetail=null;status(stopped?'已停止':partial?'服务暂不可用，未翻译部分保留原文':completed?`已翻译 ${completed} 项`:'');}
  }
  function handle(event,root){const button=event.target.closest('[data-t-action]');if(!button)return false;const action=button.dataset.tAction;
    if(action==='settings')settings();if(action==='stop')stop();
    if(action==='one'){const text=button.closest('[data-t-text]').dataset.tText;void run([text]);}
    if(action==='batch'){const texts=[...new Set([...root.querySelectorAll('.s-translation-target')].map(el=>el.dataset.tText))].filter(text=>!results.get(text)?.complete);if(texts.length)void run(texts);else toast('当前列表已翻译。');}
    return true;
  }
  function attachDetail(el,text){
    const tools=document.createElement('div');tools.className='s-translation-detail';tools.innerHTML=`<div class="s-translation-toolbar"><button class="btn" data-t-detail>翻译正文</button><button class="btn" data-t-original>隐藏译文</button><button class="btn s-t-stop" data-t-action="stop" hidden>停止翻译</button><span class="s-t-status" role="status"></span></div><p class="help-text">原文保留在上方。仅翻译当前正文，代码块、行内代码和链接保留；单次最多 60000 字符。</p><div class="s-t-detail-result" hidden><small class="s-t-attribution"></small><div class="s-preview"><pre></pre></div></div>`;
    el.querySelector('.s-preview').after(tools);tools.onclick=e=>{if(e.target.closest('[data-t-detail]')){delete tools.dataset.tHidden;void run([text],tools);}else if(e.target.closest('[data-t-original]')){const view=tools.querySelector('.s-t-detail-result');view.hidden=!view.hidden;tools.dataset.tHidden=String(view.hidden);e.target.closest('[data-t-original]').textContent=view.hidden?'显示译文':'隐藏译文';}else handle(e,tools);};el.addEventListener('close',()=>{if(running&&activeDetail===tools)stop()},{once:true});
  }
  return {controls,card,handle,attachDetail};
};
