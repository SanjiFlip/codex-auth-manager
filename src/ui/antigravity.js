'use strict';
window.createAntigravityUI=({api,demo,toast})=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root,data=null,busy=false,query='',error='',status=null;
  const demoData={supported:true,installed:true,version:'2.18.1',current:'work@example.com',accounts:[{id:'demo-work',name:'日常工作',email:'work@example.com',current:true},{id:'demo-research',name:'研究项目',email:'research@example.com',current:false}],backups:[],pending:false};
  const button=(label,action,extra='')=>`<button class="btn" data-ag="${action}" ${busy?'disabled':''} ${extra}>${label}</button>`;
  async function execute(request){
    if(busy)return;busy=true;error='';let stillRunning=false;
    if(request.action!=='state')status={phase:'checking',message:'正在执行，请稍候…'};
    paint();
    try{if(demo){if(request.action!=='state')toast('演示模式不会操作真实账号。');data=demoData}else data=await api.antigravity(request);status=data.switchStatus||null;if(data.message&&request.action!=='state')toast(data.message)}
    catch(e){
      error=e.message;toast(error);stillRunning=request.action==='switch'&&error.includes('ANTIGRAVITY_STILL_RUNNING');
      // A failed write may have created a recovery journal; cached state is no longer safe.
      try{data=request.action==='state'?null:await api.antigravity({action:'state'});status=data?.switchStatus||null}
      catch{data=null;status=null;error+=' 当前状态读取失败，请刷新后再操作。'}
    }finally{busy=false;paint()}
    if(stillRunning&&data&&!data.pending)showStillRunning(request.id);
  }
  function paint(){
    if(!root||!document.querySelector('[data-page="antigravity"].active'))return;
    root.innerHTML=`<section class="ag-page"><div class="ag-heading"><div><span class="ag-eyebrow">账号工作空间 / GOOGLE</span><h1>Antigravity</h1><p>保存常用身份，让工作与个人账号切换更清楚。</p></div><div class="actions">${button('添加账号','add',!data?.installed||data.pending?'disabled':'')}${button('刷新','state')}${button('安装位置','configure')}</div></div>
      ${status?.message?`<div role="status" class="ag-flow">${esc(status.message)}</div>`:''}
      ${error?`<div role="alert" class="ag-notice">${esc(error)}</div>`:''}
      ${!data?`<div class="panel ag-empty">${busy?'正在读取本机账号…':'读取失败，请点击刷新重试。'}</div>`:data.supported===false?`<div class="panel ag-empty"><h2>暂不支持当前系统</h2><p>${esc(data.warning)}</p></div>`:body()}
      </section>`;
    root.querySelector('.ag-page').onclick=click;
    const search=root.querySelector('#ag-search');if(search)search.oninput=e=>{query=e.target.value;cards()};cards();
  }
  function body(){return `<div class="ag-hero"><div><span class="ag-eyebrow">当前本机凭据</span><h2 class="ag-email">${esc(data.current||'尚未识别登录账号')}</h2><p>${data.accounts.some(a=>a.current)?'已保存到账号库':data.current?'尚未保存 · 点击右侧保存当前账号':'先打开 Antigravity，完成 Google 登录后刷新'}</p><span class="tag">${data.installed?'桌面版 '+esc(data.version):'未找到兼容安装'}</span></div><div class="ag-hero-actions">${button('保存当前账号','save',`${!data.current||data.pending?'disabled':''}`)}${button('打开 Antigravity','open',!data.installed||data.pending?'disabled':'')}</div></div>
      ${data.pending?'<div class="ag-notice" role="alert"><strong>上次切换未完成</strong><p>请完全退出 Antigravity 和相关 CLI，再恢复原登录。</p>'+button('恢复中断前的登录','recover')+'</div>':''}
      ${data.warning?`<div class="ag-notice">${esc(data.warning)}</div>`:''}
      <div class="ag-toolbar"><div><h2>已保存账号 <span class="tag">${data.accounts.length}</span></h2><p>账号在本机加密保存，与 Codex 账号分别管理。</p></div><input id="ag-search" aria-label="搜索 Antigravity 账号" placeholder="搜索名称或邮箱" value="${esc(query)}"></div><div class="ag-cards" id="ag-cards"></div>
      <div class="ag-bottom"><section class="panel"><h2>备份与恢复</h2><p class="help-text">每次替换登录前自动备份。恢复前请完全退出 Antigravity 与共享登录的 CLI。</p><div class="ag-backups">${data.backups.length?data.backups.map(b=>`<div class="ag-backup"><div><strong>${esc(b.reason)}</strong><small>${esc(new Date(b.createdAt).toLocaleString())}</small></div>${button('恢复','restore',`data-id="${esc(b.id)}" ${data.pending?'disabled':''}`)}</div>`).join(''):'<p class="help-text">暂无备份，首次切换时自动创建。</p>'}</div></section><section class="panel ag-guide"><h2>第一次使用</h2><ol><li>在 Antigravity 中登录第一个账号，点击保存。</li><li>手动登录其他账号，依次保存到这里。</li><li>保存正在进行的工作，再选择账号切换。</li></ol><p class="help-text">切换会尝试正常关闭应用；仍有后台进程时会停止。登录是否有效，请在 Antigravity 中确认。</p></section></div>`}
  function cards(){const container=root?.querySelector('#ag-cards');if(!container||!data)return;
    const matches=data.accounts.filter(a=>(a.name+' '+a.email).toLowerCase().includes(query.trim().toLowerCase()));
    container.innerHTML=matches.map(a=>`<article class="panel ag-card ${a.current?'ag-current':''}"><div class="ag-card-top"><span class="ag-avatar">${esc(a.name.slice(0,1))}</span><span class="tag ${a.current?'green':''}">${a.current?'当前凭据':'已保存'}</span></div><h3>${esc(a.name)}</h3><p class="ag-email">${esc(a.email)}</p><div class="ag-card-actions">${button(a.current?'当前凭据':'切换并重启','switch',`data-id="${esc(a.id)}" ${a.current||data.pending||!data.installed?'disabled':''}`)}${button('重命名','rename',`data-id="${esc(a.id)}" ${data.pending?'disabled':''}`)}${button('移除','remove',`data-id="${esc(a.id)}" ${data.pending?'disabled':''}`)}</div></article>`).join('')||`<div class="panel ag-empty"><h2>${query?'没有匹配的账号':'保存你的第一个账号'}</h2><p>${query?'试试其他名称或邮箱。':'先在 Antigravity 登录，再点击上方“保存当前账号”。'}</p></div>`;
  }
  function modal(title,content,submit,onSubmit,extra=''){
    if(document.querySelector('#ag-dialog'))return;
    const el=document.createElement('dialog');el.id='ag-dialog';el.className='ag-dialog';el.setAttribute('aria-label',title);
    el.innerHTML=`<form><h2>${esc(title)}</h2>${content}<p role="alert" class="ag-form-error"></p><div class="actions"><button type="button" class="btn" data-cancel>取消</button>${extra}<button class="btn primary" type="submit">${esc(submit)}</button></div></form>`;
    document.body.append(el);el.onclose=()=>el.remove();el.querySelector('[data-cancel]').onclick=()=>el.close();
    el.querySelector('form').onsubmit=e=>{e.preventDefault();if(busy)return;const request=onSubmit(el);if(!request)return;el.close();el.remove();execute(request)};el.showModal();return el;
  }
  function showStillRunning(id){
    const el=modal('Antigravity 仍在后台运行','<p>请先保存工作，从托盘彻底退出 Antigravity，并关闭共享登录的 CLI 后重试。此步骤尚未替换凭据。</p>','已退出，重试',()=>({action:'switch',id}),'<button type="button" class="btn" data-force-prompt>结束后台并切换</button>');
    if(el)el.querySelector('[data-force-prompt]').onclick=()=>{el.close();el.remove();modal('结束后台并切换？','<p>这会强制结束 Antigravity 及其后台进程，未保存的任务可能丢失。请确认已保存工作；共享登录的 CLI 仍需自行退出。</p>','确认结束并切换',()=>({action:'switch',id,forceClose:true}))};
  }
  function click(e){const target=e.target.closest('[data-ag]');if(!target||target.disabled||busy)return;const action=target.dataset.ag,id=target.dataset.id;const account=data?.accounts.find(a=>a.id===id);
    if(['state','open'].includes(action))return execute({action});
    if(action==='add')return modal('添加 Antigravity 账号','<p>打开 Antigravity，在应用内通过官方 Google 登录选择账号。完成后回到这里，点击“保存当前账号”。</p><p class="help-text">登录会改变 Antigravity 当前使用的账号；添加前请先保存已有账号和正在进行的工作。</p>','打开 Antigravity 登录',()=>({action:'open'}));
    if(action==='save'||action==='rename')return modal(action==='save'?'保存当前账号':'重命名账号',`<label>账号名称<input name="name" required maxlength="48" value="${esc(account?.name||'')}" placeholder="例如：日常工作" autofocus></label>`,'保存',el=>{const name=el.querySelector('input').value.trim();if(!name){el.querySelector('[role=alert]').textContent='请输入账号名称。';return null}return {action,id,name}});
    if(action==='configure')return modal('Antigravity 安装位置',`<label>Antigravity.exe 完整路径<input name="executable" required value="${esc(data?.executable||'')}" placeholder="C:\\…\\Antigravity.exe"></label><p class="help-text">默认自动检测标准安装位置；自定义安装可在此指定。</p>`,'保存位置',el=>({action,executable:el.querySelector('input').value.trim()}));
    const restore=action==='restore'||action==='recover';
    modal(restore?'恢复登录备份':action==='remove'?'移除已保存账号':'切换 Antigravity 账号',`<p>${restore?'恢复前请完全退出 Antigravity 和相关 CLI。'+(action==='recover'?'将使用已有加密备份恢复上次切换前的登录。':'此操作会替换当前登录，并备份当前状态。'):action==='remove'?`将从列表移除「${esc(account?.name)}」，保留加密归档，不会退出当前登录。`:`切换至「${esc(account?.name)}」。请先保存工作；程序会尝试正常关闭 Antigravity，备份当前登录后再切换并打开。`}</p>`,restore?'恢复登录':action==='remove'?'移除':'确认切换',()=>({action:restore?'restore':action,id}));
  }
  return {render(element){root=element;paint();if(!data&&!busy)execute({action:'state'})},refresh(){if(root&&document.querySelector('[data-page="antigravity"].active')&&!busy&&!document.querySelector('#ag-dialog'))return execute({action:'state'})},update(event){status=event;paint()}};
};
