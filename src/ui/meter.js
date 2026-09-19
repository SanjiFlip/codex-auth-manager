'use strict';
const demo=!window.codexAuth&&new URLSearchParams(location.search).get('demo')==='1';
const api=window.codexAuth,$=s=>document.querySelector(s),stats=window.UsageStatistics;
let state={accounts:[]},usage=null,busy=false,loading=false,loadEpoch=0,selectedId=null,pendingTargetId=null,loadPending=false,messageTimer;
const demoData={settings:{},accounts:[{id:'a',displayName:'日常工作',planType:'pro',isActive:true,quotaSnapshot:{session:{usedPercent:21,resetsAt:new Date(Date.now()+16860000).toISOString()},weekly:{usedPercent:3,resetsAt:new Date(Date.now()+600000000).toISOString()},resetCredits:1,checkedAt:new Date().toISOString()}},{id:'b',displayName:'研究与探索',planType:'prolite',isActive:false,quotaSnapshot:{weekly:{usedPercent:32,resetsAt:new Date(Date.now()+380000000).toISOString()},resetCredits:0,checkedAt:new Date().toISOString()}},{id:'c',displayName:'创作空间',planType:'plus',isActive:false,quotaSnapshot:{session:{usedPercent:38,resetsAt:new Date(Date.now()+7200000).toISOString()},weekly:{usedPercent:48,resetsAt:new Date(Date.now()+250000000).toISOString()},checkedAt:new Date().toISOString()}}]};
function notify(message){clearTimeout(messageTimer);$('#message').textContent=message;$('#message').hidden=!message;if(message)messageTimer=setTimeout(()=>{$('#message').hidden=true},6500)}
function currentAccount(){return state.accounts.find(a=>a.isActive)}
function setBusy(value){if(value)loadEpoch++;busy=value;$('#account-trigger').disabled=value||!state.accounts.length;$('#refresh-btn').disabled=value;updateSelection()}
function updateSelection(){
  const account=state.accounts.find(a=>a.id===selectedId);
  $('#selected-name').textContent=account?.displayName||'暂无账号';$('#selected-name').title=account?.displayName||'';
  $('#selected-plan').textContent=account?window.planLabel(account.planType):'在主界面添加账号';
  $('#selected-avatar').textContent=(account?.displayName||'C').slice(0,1);
  $('#selection-state').textContent=account?.isActive?'当前账号':account?'待切换':'尚未添加';
  $('#switch-btn').disabled=busy||!account||account.isActive;
  $('#switch-btn').textContent=busy?'正在处理…':account?.isActive?'正在使用此账号':'切换并重启 Codex';
  $('#account-trigger').disabled=busy||!account;
}
function closeMenu(focus=false){$('#account-menu').hidden=true;$('#account-trigger').setAttribute('aria-expanded','false');if(focus)$('#account-trigger').focus()}
function renderOptions(){
  const list=$('#account-options');list.replaceChildren();
  for(const account of state.accounts){
    const option=document.createElement('button');option.type='button';option.className='account-option';option.setAttribute('role','option');option.setAttribute('aria-selected',String(account.id===selectedId));option.dataset.id=account.id;option.tabIndex=-1;
    const avatar=document.createElement('span');avatar.className='account-avatar';avatar.textContent=(account.displayName||'C').slice(0,1);
    const copy=document.createElement('span');copy.className='option-copy';const name=document.createElement('span');name.className='option-name';name.textContent=account.displayName;name.title=account.displayName;
    const detail=document.createElement('span');detail.className='option-detail';detail.textContent=window.planLabel(account.planType)+(account.isActive?' · 当前使用':' · 已保存');copy.append(name,detail);
    const check=document.createElement('span');check.className='option-check';check.setAttribute('aria-hidden','true');check.textContent=account.id===selectedId?'✓':'';
    option.append(avatar,copy,check);option.onclick=()=>{selectedId=account.id;updateSelection();closeMenu(true)};list.append(option);
  }
}
function openMenu(direction=0){if(busy||!state.accounts.length)return;renderOptions();$('#account-menu').hidden=false;$('#account-trigger').setAttribute('aria-expanded','true');const options=[...$('#account-options').children];const selected=options.findIndex(el=>el.dataset.id===selectedId);options[direction<0?options.length-1:Math.max(0,selected)]?.focus()}
function render(){
  if(state.platform==='darwin'){$('#exit-title').textContent='Codex 仍在后台运行';$('#exit-help').textContent='请在 Codex / ChatGPT 应用菜单中选择退出（⌘Q）。凭据尚未改写。';$('#retry-exit').textContent='已退出应用，重试';}
  const account=currentAccount(),q=account?.quotaSnapshot,showSession=window.showFiveHour(account?.planType,state.settings);
  const primary=showSession?q?.session:q?.weekly,p=stats.remaining(primary),w=stats.remaining(q?.weekly);
  document.body.classList.toggle('week-only',!showSession);$('#weekly-section').hidden=!showSession;
  $('#quota-title').textContent=showSession?'5 小时额度':'每周额度';$('#plan').textContent=window.planLabel(account?.planType);$('#plan').title=$('#plan').textContent;
  $('#session').textContent=p===null?'—':p+'%';$('#weekly').textContent=w===null?'—':w+'%';
  $('#ring-progress').style.strokeDashoffset=String(251.327*(1-(p??0)/100));$('#weekly-bar').style.width=(w??0)+'%';
  $('#health').textContent=p===null?'额度待获取':p>=50?'状态良好':p>=15?'继续创作':'留意额度';
  $('#session-reset').textContent=stats.resetTime(primary?.resetsAt);$('#weekly-reset').textContent=stats.resetTime(q?.weekly?.resetsAt);
  const summary=stats.summarize(usage);$('#tokens').textContent=stats.compact(summary.todayTokens).replace('.0万','万');$('#sessions').textContent=stats.compact(summary.todaySessions);$('#resets').textContent=stats.compact(q?.resetCredits);
  // Preserve the pending choice across state/usage refreshes until it is removed or switched.
  if(!state.accounts.some(a=>a.id===selectedId))selectedId=account?.id||state.accounts[0]?.id||null;
  updateSelection();if(!$('#account-menu').hidden){const focused=document.activeElement?.dataset?.id;renderOptions();if(focused)[...$('#account-options').children].find(el=>el.dataset.id===focused)?.focus({preventScroll:true})}
  $('#freshness').textContent=(demo?'演示数据':q?.source==='official-app-server'?'官方快照':'本地快照')+' · '+(q?.checkedAt?new Date(q.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'待更新');
}
async function load(){
  if(busy||loading){loadPending=true;return}loading=true;const epoch=loadEpoch;
  try{
    if(demo)demoData.settings.proFiveHourEnabled=localStorage.getItem('demo-pro-five-hour')==='1';
    const [next,nextUsage]=demo?[demoData,{daily:[{day:stats.dayKey(new Date()),tokenUsage:{totalTokens:13390000},sessions:9}]}]:await Promise.all([api.getState(),api.getStatistics()]);
    if(busy||epoch!==loadEpoch){loadPending=true;return}
    state=next;usage=nextUsage;render();
  }catch(e){notify(e.message)}finally{loading=false;if(loadPending&&!busy){loadPending=false;load()}}
}
function finishBusy(){setBusy(false);if(loadPending){loadPending=false;load()}}
$('#account-trigger').onclick=()=>$('#account-menu').hidden?openMenu():closeMenu(true);
$('#account-trigger').onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();openMenu(e.key==='ArrowUp'?-1:1)}};
$('#account-options').onkeydown=e=>{const options=[...$('#account-options').children],i=options.indexOf(document.activeElement);let next;if(e.key==='ArrowDown')next=(i+1)%options.length;else if(e.key==='ArrowUp')next=(i+options.length-1)%options.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=options.length-1;if(next!==undefined){e.preventDefault();options[next]?.focus()}if(e.key==='Tab')closeMenu()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#account-menu').hidden){e.preventDefault();closeMenu(true)}});
document.addEventListener('click',e=>{if(!e.target.closest('.account-area'))closeMenu()});
$('#close-btn').onclick=()=>demo?window.close():api.hideWidget();
$('#main-btn').onclick=$('#open-main').onclick=()=>demo?window.open('manager.html?demo=1','manager'):api.showMainWindow();
$('#theme-btn').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('meter-dark',document.body.classList.contains('dark')?'1':'0')};
$('#pin-btn').onclick=async()=>{const next=$('#pin-btn').getAttribute('aria-pressed')!=='true';try{if(!demo)await api.setWidgetTopmost(next);$('#pin-btn').setAttribute('aria-pressed',String(next));$('#pin-btn').classList.toggle('active',next)}catch(e){notify(e.message)}};
$('#refresh-btn').onclick=async()=>{
  if(busy)return;setBusy(true);notify('正在更新本地额度与用量…');
  try{
    if(!demo)await api.refreshLocalData();
    const results=await Promise.allSettled([demo?state:api.getState(),demo?usage:api.getStatistics()]);
    if(results[0].status==='fulfilled')state=results[0].value;
    if(results[1].status==='fulfilled')usage=results[1].value;
    render();const failed=results.find(r=>r.status==='rejected');
    notify(failed?'部分更新失败：'+failed.reason.message:demo?'演示模式不查询真实账号':'已更新');
  }catch(e){notify('本地更新失败：'+e.message)}finally{finishBusy()}
};
let pendingForce=false;
function confirmSwitch(id,force=false){
  pendingTargetId=id;pendingForce=force;
  const target=state.accounts.find(a=>a.id===id);if(!target)return;
  $('#confirm-name').textContent='切换到「'+target.displayName+'」';
  $('#confirm-warning').textContent=force?'将强制结束 Codex 及后台任务，未保存的内容可能丢失。请先保存工作。':'将关闭并重启 Codex，请先保存当前任务。';
  $('#confirm-switch').textContent=force?'确认结束并切换':'确认切换';
  $('#switch-confirm').showModal();$('#cancel-switch').focus();
}
$('#switch-btn').onclick=()=>{const target=state.accounts.find(a=>a.id===selectedId);if(busy||!target||target.isActive)return;closeMenu();confirmSwitch(target.id)};
$('#cancel-switch').onclick=()=>{$('#switch-confirm').close();pendingTargetId=null;pendingForce=false;$('#switch-btn').focus()};
$('#switch-confirm').addEventListener('cancel',()=>{pendingTargetId=null;pendingForce=false});
$('#cancel-exit').onclick=()=>{$('#exit-blocked').close();pendingTargetId=null};
$('#exit-blocked').addEventListener('cancel',()=>{pendingTargetId=null});
$('#force-exit').onclick=()=>{const id=pendingTargetId;$('#exit-blocked').close();if(id)confirmSwitch(id,true)};
$('#retry-exit').onclick=()=>{const id=pendingTargetId;$('#exit-blocked').close();if(id)performSwitch(id,false)};
async function performSwitch(id,forceClose){
  pendingTargetId=null;pendingForce=false;
  const target=state.accounts.find(a=>a.id===id);if(!target||target.isActive){notify('账号状态已变化，请重新选择');return}
  if(busy)return;setBusy(true);
  try{if(demo){for(const a of state.accounts)a.isActive=a.id===id;notify('演示切换完成，未操作真实 Codex')}else{state=await api.switchAccount(id,{restartCodex:true,forceClose});notify('Codex 已重启，请核对身份')}selectedId=state.accounts.find(a=>a.isActive)?.id||id;render()}
  catch(e){if(e.message?.includes('CODEX_STILL_RUNNING')){pendingTargetId=id;$('#exit-blocked').showModal();$('#cancel-exit').focus()}else notify(e.message)}finally{finishBusy()}
}
$('#confirm-switch').onclick=()=>{if(busy||!pendingTargetId)return;const id=pendingTargetId,force=pendingForce;$('#switch-confirm').close();performSwitch(id,force)};
document.body.classList.toggle('dark',localStorage.getItem('meter-dark')==='1');
if(demo)window.addEventListener('storage',()=>load());
function refreshLive(){
  load();
  api?.refreshLocalData?.().catch(()=>{$('#freshness').title='本地读取失败，保留上次快照；稍后重试。'});
}
if(api){setInterval(()=>{if(!document.hidden)refreshLive()},10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive()});window.addEventListener('focus',refreshLive)}
if(api||demo){refreshLive();api?.onStateChanged?.(event=>{load();if(event.scope==='accounts')api.refreshLocalData?.().catch(()=>{})});if(api)api.getWidgetTopmost().then(s=>{$('#pin-btn').setAttribute('aria-pressed',String(s.pinned));$('#pin-btn').classList.toggle('active',s.pinned)}).catch(()=>{})}else notify('请从桌面工具打开悬浮窗');
