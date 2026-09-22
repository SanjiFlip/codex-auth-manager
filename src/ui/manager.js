'use strict';
const paths = {
  spark:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3M20 2v4m-2-2h4',
  layers:'m12 3 10 5-10 5L2 8l10-5M2 12l10 5 10-5M2 16l10 5 10-5',
  book:'M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
  chart:'M4 3v17h17M8 15v-4M13 15V7M18 15v-6', clock:'M12 8v4l3 2',
  shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3M8 12l3 3 5-6',
  settings:'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2 1-4',
  plus:'M12 5v14M5 12h14', download:'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
  refresh:'M20 7a8 8 0 1 0 0 10M20 3v5h-5', search:'M16 16l5 5',
  arrow:'M5 12h14m-5-5 5 5-5 5', check:'M5 12l4 4L19 6',
  swap:'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4',
  link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  info:'M12 11v6M12 7h.01', bolt:'M13 2 4 14h7l-1 8 10-12h-7l1-8',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.info}"/>${name==='users'?'<circle cx="9" cy="7" r="4"/>':name==='clock'||name==='info'?'<circle cx="12" cy="12" r="9"/>':name==='search'?'<circle cx="10" cy="10" r="6"/>':name==='settings'?'<circle cx="12" cy="12" r="3"/>':''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = selector => document.querySelector(selector);
const isDemo = !window.codexAuth && new URLSearchParams(location.search).get('demo') === '1';
let state = {accounts:[], settings:{}, current:null}, page='accounts', filter='all', search='', busy=false, loginActive=false;
let appVersion=null;
let statistics=null, statisticsLoading=false,liveReading=false,livePending=false,liveEpoch=0;
const usageStats=window.UsageStatistics;
let loginState={phase:'idle'}, dashboard=null, toastTimer;
const events=[];
function log(message) { events.unshift({time:new Date().toLocaleTimeString('zh-CN'),message}); if(events.length>100)events.pop(); }
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),6500); }
function relative(value) { if(!value)return '尚未切换'; const m=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000)); return m<1?'刚刚':m<60?`${m} 分钟前`:m<1440?`${Math.floor(m/60)} 小时前`:`${Math.floor(m/1440)} 天前`; }
function shortDate(value) { return value ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '暂无快照'; }
function number(value) { return typeof value==='number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'; }
function button(label, action, type='', ic='', extra='') { return `<button class="btn ${type}" data-action="${action}" ${extra}>${ic?icon(ic):''}${label}</button>`; }
function demoApi() {
  const now=Date.now();
  const accounts=[['a','日常工作','epoch.work@example.com','pro',22,48,false],['b','创作空间','studio@example.com','plus',8,25,false],['c','研究与探索','research@example.com','prolite',63,81,false],['d','备用账号','hello@example.com','plus',null,null,true]].map((a,i)=>({id:a[0],displayName:a[1],email:a[2],planType:a[3],isActive:i===0,needsReauth:a[6],lastSwitchedAt:new Date(now-i*86400000).toISOString(),quotaSnapshot:a[4]===null?null:{source:'official-app-server',resetCredits:i===0?1:0,session:{usedPercent:a[4],resetsAt:new Date(now+16860000).toISOString()},weekly:{usedPercent:a[5],resetsAt:new Date(now+600000000).toISOString()},checkedAt:new Date(now-120000).toISOString()},quotaSnapshotUpdatedAt:new Date(now-120000).toISOString()}));
  const data={accounts,credentialMode:'file',settings:{launchAtLogin:false,proFiveHourEnabled:localStorage.getItem("demo-pro-five-hour")==="1"},current:{exists:true,email:accounts[0].email},codexDir:'C:\\Users\\Demo\\.codex',storeRoot:'本机演示账户库',switchStatus:{phase:'idle'},loginStatus:{phase:'idle'}};
  const clone=()=>structuredClone(data);
  return {getStatistics:async()=>demoStatistics(),getState:async()=>clone(),refreshOfficial:async()=>clone(),importCurrent:async name=>{accounts[0].displayName=name||accounts[0].displayName;return clone()},updateAccount:async(id,patch)=>{Object.assign(accounts.find(a=>a.id===id),patch);return clone()},deleteAccount:async id=>{data.accounts=data.accounts.filter(a=>a.id!==id);return clone()},switchAccount:async id=>{for(const a of data.accounts)a.isActive=a.id===id;data.current.email=data.accounts.find(a=>a.id===id).email;data.switchStatus={phase:'restarted',message:'演示：Codex 已重启，请核对账号身份'};return clone()},enableFileStore:async()=>clone(),updateSettings:async patch=>{Object.assign(data.settings,patch);if("proFiveHourEnabled" in patch)localStorage.setItem("demo-pro-five-hour",patch.proFiveHourEnabled?"1":"0");return clone()},getDashboard:async()=>({usage:{tokenUsage:{totalTokens:1284600},sessionsAnalyzed:24,models:[{model:'示例模型',tokenUsage:{totalTokens:1284600}}]},scope:{since:new Date(now-86400000).toISOString()}}),startLogin:async()=>({phase:'waiting'}),cancelLogin:async()=>({phase:'cancelled'}),getLoginState:async()=>({phase:'waiting'}),openLogin:async()=>toast('演示模式不会打开真实授权页面。'),openPath:async()=>toast('演示模式不会读取真实目录。'),toggleWidget:async()=>window.open('meter.html?demo=1','codex-meter','width=360,height=560'),importPortable:async()=>toast('演示模式不导入凭据。'),exportPortable:async()=>toast('演示模式不导出凭据。')};
}
const api=isDemo?demoApi():window.codexAuth;
if(isDemo){api.getVersion=async()=>document.querySelector('.version small').textContent.match(/v([\d.]+)/)?.[1]||'演示';api.checkForUpdates=async()=>({currentVersion:appVersion,latestVersion:appVersion,comparison:0,prerelease:true,installer:null});api.openUpdate=async()=>toast('演示模式不会打开外部页面。');api.exportStatistics=async()=>{toast('演示模式不导出本机数据。');return false;};}
const knowledge=window.createKnowledgeUI({api,demo:isDemo,toast});
const skillsUI=window.createSkillsUI({api,demo:isDemo,toast});
if(window.codexAuth)document.body.classList.add('desktop');
let renderedPage=null,lastRenderedKey='';
// Compare only what the dashboard displays, not scanner bookkeeping timestamps.
function viewKey(next,usage){return JSON.stringify([page,next.accounts.map(a=>[a.id,a.displayName,a.email,a.planType,a.isActive,a.needsReauth,a.quotaSnapshot?.session,a.quotaSnapshot?.weekly,a.quotaSnapshot?.resetCredits,shortDate(a.quotaSnapshotUpdatedAt||a.quotaSnapshot?.checkedAt)]),next.current,next.credentialMode,next.switchStatus,next.settings,usage?.daily,usage?.tokenUsage,usage?.models,usage?.sessionsAnalyzed,usage?.scannedFiles,usage?.failedFiles,page==='quotas'?Math.floor(Date.now()/60000):usageStats.dayKey(new Date())]);}
function syncWindowTheme(){api?.setWindowTheme?.(document.body.classList.contains('dark')).catch(e=>toast(e.message))}
if(isDemo)$('#demo-badge').hidden=false;
function heading(title, subtitle, actions='') { return `<div class="page-heading"><div><div class="eyebrow">CODEX / WORKSPACE</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`; }
function meter(label, window, detail=false, checkedAt=null) {
  const used=window?.usedPercent;
  const remaining=typeof used==='number'&&Number.isFinite(used)?Math.round(Math.max(0,Math.min(100,100-used))):null;
  return `<div class="meter"><div class="meter-label"><span>${label}</span><strong>${remaining===null?'—':`${remaining}<small>%</small>`}</strong></div><div class="meter-track"><div class="meter-fill ${remaining!==null&&remaining<25?'warn':''}" style="width:${remaining??0}%"></div></div>${detail?`<div class="meter-foot">${checkedAt?'快照时间 · '+escape(shortDate(checkedAt)):'尚无本地额度记录'}</div>`:''}</div>`;
}
function sessionMeter(account,detail=false){
  if(!window.showFiveHour(account?.planType,state.settings))return '';
  return meter('5 小时剩余额度',account?.quotaSnapshot?.session,detail,account?.quotaSnapshotUpdatedAt);
}
function identity(account,i=0,large=false) { return `<div class="identity"><div class="avatar ${['forest','lilac','blue','sand'][i%4]}">${escape((account.displayName||account.email||'C').slice(0,1).toUpperCase())}</div><div><h2>${escape(account.displayName||'当前登录')}${large?`<span class="badge">${escape(window.planLabel(account.planType))}</span>`:''}</h2><p class="email">${escape(account.email||'未提供邮箱')}</p></div></div>`; }
function summary(label,value,unit,ic,note='') { return `<div class="summary-card"><div class="summary-icon">${icon(ic)}</div><div><div class="summary-label">${label}</div><div class="summary-value">${value}<small>${unit}</small></div></div><span class="summary-trailing">${note}</span></div>`; }
function accountCard(account,i) {
  const quota=account.quotaSnapshot;
  return `<article class="account-card ${account.isActive?'selected':''}" data-account="${escape(account.id)}"><div class="card-top">${identity(account,i)}<button class="more" data-action="edit" data-id="${escape(account.id)}" aria-label="管理 ${escape(account.displayName)}">···</button></div><div class="tag-row"><span class="tag">${escape(window.planLabel(account.planType))}</span><span class="tag ${account.needsReauth?'amber':'green'}">${account.needsReauth?'需要重新授权':account.isActive?'● 当前凭据':'已保存'}</span><span>本地加密</span></div><div class="card-meters">${sessionMeter(account)}${meter('周剩余额度',quota?.weekly)}</div><div class="card-footer"><span class="card-time">${icon('clock')}${quota?'快照 · '+escape(shortDate(account.quotaSnapshotUpdatedAt||quota.checkedAt)):'额度待更新'}</span><button class="switch-btn ${account.isActive?'current':''}" data-action="${account.isActive?'active-info':'switch'}" data-id="${escape(account.id)}" ${busy?'disabled':''}>${account.isActive?icon('check')+'当前凭据':icon('swap')+'切换并重启'}</button></div></article>`;
}
function renderCards() {
  const items=state.accounts.filter(a=>(filter==='all'||(filter==='ready'?!a.needsReauth:a.needsReauth))&&`${a.displayName} ${a.email}`.toLowerCase().includes(search.toLowerCase()));
  $('#cards').innerHTML=items.length?items.map((a,i)=>accountCard(a,i)).join(''):`<div class="empty">${icon('users')}<h2>${state.accounts.length?'没有匹配的账号':'从添加第一个账号开始'}</h2><p>${state.accounts.length?'试试其他名称、邮箱或筛选条件。':'登录一个新账号，或保存当前 Codex 登录。'}</p>${state.accounts.length?'':button('添加账号','add','primary','plus')}</div>`;
}
function renderAccounts() {
  const current=state.accounts.find(a=>a.isActive)|| (state.current?.email?{email:state.current.email,displayName:'当前登录 · 尚未保存'}:null);
  const q=current?.quotaSnapshot;
  const overview=renderRichOverview(current),overviewAt=overview.indexOf('<div class="overview-row">');
  $('#content').innerHTML=heading('账号管理','每个身份，各就其位。轻松管理你的 Codex 账号。',button('悬浮窗','widget','','chart')+button('保存当前账号','save','','download')+button('添加账号','add','primary','plus'))+
    (state.credentialMode!=='file'?`<div class="notice"><span>当前存储模式：${escape(state.credentialMode||'未知')}。切换功能需要文件凭据管理；启用后需重新登录或保存当前登录。</span>${button('前往设置','settings')}</div>`:'')+
    (state.switchStatus?.phase!=='idle'&&state.switchStatus?.message?`<div class="flow">${icon('info')}<span>${escape(state.switchStatus.message)}</span></div>`:'')+
    `<section class="active-panel"><div><div class="section-label">● &nbsp; 当前凭据账号 <span style="opacity:.6">/ CURRENT ACCOUNT</span></div>${current?identity(current,0,true):'<div class="identity"><div class="avatar forest">C</div><div><h2>尚未连接账号</h2><p>添加账号，让工作准备就绪</p></div></div>'}<div class="active-note">${icon('shield')} ${current?'以本机凭据为准 · 应用内身份请在 Codex 核对':'支持官方浏览器授权 · 无需输入密码到本工具'}</div></div><div class="active-meters">${sessionMeter(current,true)}${meter('周剩余额度',q?.weekly,true,current?.quotaSnapshotUpdatedAt)}</div></section>`+
    overview.slice(0,overviewAt)+
    `<div class="list-toolbar"><div class="list-title">我的账号<span>${state.accounts.length}</span></div><div class="actions"><div class="list-filters"><button class="filter ${filter==='all'?'active':''}" data-filter="all">全部</button><button class="filter ${filter==='ready'?'active':''}" data-filter="ready">已保存</button><button class="filter ${filter==='reauth'?'active':''}" data-filter="reauth">待授权</button></div><label class="search">${icon('search')}<input id="search" aria-label="搜索账号" placeholder="搜索账号或邮箱…" value="${escape(search)}"></label><button class="btn" data-action="refresh" aria-label="刷新账号">${icon('refresh')}</button></div></div><div class="cards" id="cards"></div><div class="hint-line">${icon('info')}切换会关闭并重新启动 Codex，请先保存当前任务。额度来自官方查询或本地快照，缺失数据以「—」表示。</div>`+overview.slice(overviewAt);
  renderCards(); $('#search').addEventListener('input',e=>{search=e.target.value;renderCards()});
}
function renderUsage() {
  const data=usageStats.summarize(statistics),usage=statistics||{},total=usage.tokenUsage?.totalTokens||0;
  $('#content').innerHTML=heading('用量概览','从每日趋势到模型分布，了解你的本机 Codex 使用情况。',button('导出 CSV','statistics-export','','download')+button('刷新本机统计','statistics-refresh','primary','refresh'))+
    '<div class="summary-grid">'+summary('本机今日 Tokens',usageStats.compact(data.todayTokens),'','bolt')+summary('本机今日会话',usageStats.compact(data.todaySessions),'次','chart')+summary('近 7 天 Tokens',usageStats.compact(data.weekTokens),'','clock')+summary('近 7 天会话',usageStats.compact(data.sessions),'次','users')+'</div>'+
    '<div class="overview-row">'+renderTrend()+'<div class="panel"><div class="panel-heading"><h2>模型用量分布</h2><span>最近 7 天 · 本机</span></div>'+((usage.models||[]).slice(0,5).map(m=>'<div class="model-row"><span>'+escape(m.model||'未知模型')+'</span><div class="model-track"><i style="width:'+Math.max(0,Math.min(100,(m.tokenUsage?.totalTokens||0)/Math.max(total,1)*100))+'%"></i></div><small>'+usageStats.compact(m.tokenUsage?.totalTokens)+'</small></div>').join('')||'<div class="empty-chart">尚无模型用量数据</div>')+'</div></div>'+
    '<div class="panel"><h2>Token 构成</h2><div class="summary-grid">'+summary('输入 Tokens',usageStats.compact(usage.tokenUsage?.inputTokens),'','download')+summary('缓存输入',usageStats.compact(usage.tokenUsage?.cachedInputTokens),'','refresh')+summary('输出 Tokens',usageStats.compact(usage.tokenUsage?.outputTokens),'','arrow')+summary('推理输出',usageStats.compact(usage.tokenUsage?.reasoningOutputTokens),'','bolt')+'</div><p class="help-text">缓存输入与推理输出属于相应 Token 子项，不能再次相加计入总量。</p></div>'+
    '<div class="panel"><h2>每日明细</h2>'+data.daily.map(d=>'<div class="setting-row"><strong>'+d.day+'</strong><span class="help-text">'+number(d.tokens)+' tokens · '+d.sessions+' 个会话</span></div>').join('')+'<p class="help-text">已扫描 '+number(data.scannedFiles)+' 个文件；读取失败 '+number(data.failedFiles)+' 个。这里只反映本机可读取的记录，不代表其他设备或订阅总用量。CSV 对未记录完整的 Token 子项留空，不作为零用量。</p></div>';
}
function row(title,desc,control) { return `<div class="setting-row"><div><strong>${title}</strong><p>${desc}</p></div>${control}</div>`; }
function demoStatistics(){
  const values=[2540000,4120000,3100000,5980000,2890000,7540000,13390000];
  const daily=values.map((tokens,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return {day:usageStats.dayKey(d),tokenUsage:{totalTokens:tokens},sessions:[4,7,5,8,4,11,9][i]}});
  return {daily,tokenUsage:{totalTokens:39560000,inputTokens:27300000,cachedInputTokens:18240000,outputTokens:12260000,reasoningOutputTokens:9380000},sessionsAnalyzed:48,scannedFiles:82,failedFiles:0,models:[{model:'GPT-6 Astra',tokenUsage:{totalTokens:21300000}},{model:'GPT-5.6 Sol',tokenUsage:{totalTokens:10200000}},{model:'GPT-5.6 Terra',tokenUsage:{totalTokens:8060000}}]};
}
function renderTrend(){
  const data=usageStats.summarize(statistics),max=Math.max(1,...data.daily.map(d=>d.tokens));
  return `<div class="panel"><div class="panel-heading"><h2>最近 7 天 · Token 趋势</h2><span>本机记录 · ${data.loaded?'已加载':'待加载'}</span></div>${data.loaded?`<div class="chart-bars">${data.daily.map(d=>`<div class="chart-column"><em>${usageStats.compact(d.tokens)}</em><div class="bar" title="${d.day} · ${number(d.tokens)} tokens" style="--bar-height:${Math.max(2,d.tokens/max*92)}px"></div><small>${d.label}</small></div>`).join('')}</div><div class="chart-legend"><span>● 原始 total_tokens · 缓存输入不重复相加</span><span>累计 ${usageStats.compact(data.weekTokens)}</span></div>`:`<div class="empty-chart">${statisticsLoading?'正在读取本机会话记录…':'尚未读取统计数据'}</div>`}</div>`;
}
function renderRichOverview(current){
  const data=usageStats.summarize(statistics),q=current?.quotaSnapshot;
  return `<div class="summary-grid">${summary('本机今日 Tokens',usageStats.compact(data.todayTokens),'','bolt')}${summary('本机今日会话',usageStats.compact(data.todaySessions),'次','chart')}${summary('近 7 天 Tokens',usageStats.compact(data.weekTokens),'','clock')}${summary('当前账号可用重置',usageStats.compact(q?.resetCredits),'次','refresh')}</div><div class="overview-row">${renderTrend()}<div class="panel"><div class="panel-heading"><h2>快捷工作台</h2><span>${state.accounts.length} 个已保存账号</span></div><div class="quick-grid"><button class="quick-tile" data-action="widget">${icon('chart')}<span>桌面悬浮窗<small>额度始终一眼可见</small></span></button><button class="quick-tile" data-action="current-quota">${icon('refresh')}<span>同步官方额度<small>更新套餐与恢复时间</small></span></button><button class="quick-tile" data-action="statistics-refresh">${icon('bolt')}<span>刷新用量统计<small>读取本机最近 7 天</small></span></button><button class="quick-tile" data-action="diagnostics">${icon('shield')}<span>环境体检<small>配置与凭据状态</small></span></button></div></div></div>`;
}
async function loadStatistics(){if(statisticsLoading)return;statisticsLoading=true;try{statistics=await api.getStatistics();if(['accounts','usage'].includes(page))render()}catch(e){toast('统计读取失败：'+e.message)}finally{statisticsLoading=false}}
function renderQuotas(){
  $('#content').innerHTML=heading('订阅额度','独立账号，独立额度。区分 Pro 5x / Pro 20x 与官方恢复窗口。',button('刷新全部账号','quota-all','primary','refresh'))+`<div class="summary-grid">${summary('账户库',state.accounts.length,'个','users')}${summary('Pro 20x',state.accounts.filter(a=>a.planType==='pro').length,'个','bolt')}${summary('Pro 5x',state.accounts.filter(a=>a.planType==='prolite').length,'个','chart')}${summary('Plus',state.accounts.filter(a=>a.planType==='plus').length,'个','shield')}</div><div class="cards">${state.accounts.map((a,i)=>`<div class="panel">${identity(a,i,true)}<div style="margin-top:23px">${sessionMeter(a,true)}${window.showFiveHour(a.planType,state.settings)?`<p class="help-text">${usageStats.resetTime(a.quotaSnapshot?.session?.resetsAt)}</p>`:''}${meter('每周剩余额度',a.quotaSnapshot?.weekly)}<p class="help-text">${usageStats.resetTime(a.quotaSnapshot?.weekly?.resetsAt)}</p></div><div class="card-footer"><span class="help-text">可用重置 ${usageStats.compact(a.quotaSnapshot?.resetCredits)} 次</span>${button('官方刷新','official-refresh','','refresh',`data-id="${escape(a.id)}"`)}</div></div>`).join('')||'<div class="empty">添加账号后即可查询官方额度。</div>'}</div><p class="help-text">查询失败会保留上一次快照。Pro 档位来自官方 planType，不能据此推算实际可发送的消息数量。</p>`;
}
async function refreshAllQuotas(){return run(async()=>{let done=0,failed=0;for(const a of state.accounts){toast(`正在刷新官方额度 ${++done}/${state.accounts.length}`);try{state=await api.refreshOfficial(a.id)}catch{failed++}}render();log(`批量额度刷新：${done-failed} 成功，${failed} 失败`);toast(`刷新完成：${done-failed} 成功，${failed} 失败`)})}
function renderDiagnostics(){
  const d=state.diagnostics||{},value=v=>v===true?'<span class="tag green">正常</span>':v===false?'<span class="tag amber">待处理</span>':'<span class="tag">未知</span>';
  $('#content').innerHTML=heading('环境体检','只读取本机状态，帮助定位登录与切换问题。',button('重新检查','refresh','','refresh'))+`<div class="panel"><h2>Codex 与凭据</h2>${row('Codex 桌面版本',escape(d.codexVersion||'演示环境 / 未识别'),value(!!d.codexVersion))}${row('文件凭据管理',escape(state.credentialMode),value(state.credentialMode==='file'))}${row('当前凭据可识别','检查本机 auth.json 格式和账号身份，不验证在线会话。',value(d.authRecognized))}${row('当前快照同步','当前凭据与本工具保存的快照是否一致。',value(d.authSynchronized))}${row('本地日志数据库','只读检查额度日志结构。',value(d.dbReadable))}${row('会话文件',number(d.sessionFiles)+' 个可发现文件','')}${row('账户库',escape(state.storeRoot),button('打开目录','open-store'))}</div><div class="panel"><h2>排障建议</h2><p class="help-text">无法打开浏览器：先确认 codex --version 可执行，再重新添加账号。<br>无法切换：确认文件管理已启用，保存任务并完全退出 Codex 后再试。<br>额度为空：点击账号的「官方刷新」，或等待 Codex 产生本地记录。<br>仅 access token 到期不代表账号失效，官方服务可继续刷新。</p></div>`;
}
function renderSettings() {
  $('#content').innerHTML=heading('应用设置','让账户管理融入你的工作方式。')+`<div class="panel"><h2>登录与切换</h2>${row('文件凭据管理',`当前：${escape(state.credentialMode||'未知')}。启用会备份并修改 config.toml 的凭据存储设置；系统凭据不会自动迁移。`,button(state.credentialMode==='file'?'已启用':'启用文件管理','enable-file','', '',state.credentialMode==='file'?'disabled':''))}${row('切换后重启 Codex','先正常关闭并确认退出，再替换凭据。退出超时会停止切换，不强行终止任务。','<span class="tag green">始终启用</span>')}</div><div class="panel"><h2>外观与工作方式</h2>${row('Pro 5 小时额度','默认关闭，适用于 Pro 5x 和 Pro 20x。开启后显示官方 5 小时快照；周额度始终显示。仅控制展示，不改变官方限制。',`<input type="checkbox" id="pro-five-hour" aria-label="Pro 显示 5 小时额度" ${state.settings.proFiveHourEnabled?'checked':''}>`)}${row('主题与悬浮窗','系统蓝与中性灰，浅色和深色主题均保持清晰对比。',`<div class="actions">${button('切换明暗','theme')}${button('打开悬浮窗','widget')}</div>`)}${row('隐私显示','模糊隐藏邮箱，悬停时查看。',`<input type="checkbox" id="privacy" aria-label="隐藏邮箱" ${document.body.classList.contains('privacy')?'checked':''}>`)}${row('开机启动','登录系统时启动本工具。',`<input type="checkbox" id="autostart" aria-label="开机启动" ${state.settings.launchAtLogin?'checked':''}>`)}</div><div class="panel"><h2>本地数据</h2>${row('Codex 目录',escape(state.codexDir),button('打开目录','open-codex'))}${row('账户库',escape(state.storeRoot),button('打开目录','open-store'))}${row('加密凭据迁移','使用迁移密码导入或导出 .codexauth 文件。导入只保存，不切换。',`<div class="actions">${button('导入','import')}${button('导出当前','export')}</div>`)}</div><div class="panel"><h2>版本与更新</h2>${row('当前版本',appVersion?'v'+escape(appVersion)+' · 预览版':'正在读取版本…',button('检查更新','check-updates','','refresh'))}<p class="help-text">手动检查本项目的 GitHub 发布版本（含预览版）；选择后在浏览器打开下载，不会自动安装。</p></div><div class="panel"><h2>关于</h2><p class="help-text">Codex Auth Manager ${appVersion?'v'+escape(appVersion):''} · ${escape(state.platformName||'Windows')} 预览版<br>基于 GboyCode/CodexAuth（MIT）开发，参考 Mintimate/codex-auth-switch 的登录体验。<br>浏览器登录由本机官方 Codex CLI 发起。本工具与 OpenAI 无官方关联。</p></div>`;
  $('#pro-five-hour').onchange=e=>run(async()=>{try{state=await api.updateSettings({proFiveHourEnabled:e.target.checked})}finally{render()}});
  $('#privacy').onchange=e=>{document.body.classList.toggle('privacy',e.target.checked);localStorage.setItem('privacy',e.target.checked?'1':'0')};
  $('#autostart').onchange=e=>run(async()=>{state=await api.updateSettings({launchAtLogin:e.target.checked});render()});
}
function render() {
  document.body.classList.toggle('mac',state.platform==='darwin');
  $('#protection-label').textContent='● 本地加密 · '+(state.credentialProtection||'Windows DPAPI');
  const focused=document.activeElement?.matches('#content input')?document.activeElement:null;
  const focus=focused?{id:focused.id,start:focused.selectionStart,end:focused.selectionEnd}:null;
  if(renderedPage!==page){$('.page-scroll').scrollTop=0;renderedPage=page}
  $('#nav-count').textContent=state.accounts.length;
  document.querySelectorAll('[data-page]').forEach(el=>{el.classList.toggle('active',el.dataset.page===page);if(el.dataset.page===page)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')});
  $('#breadcrumb').textContent={accounts:'账号管理',usage:'用量概览',quotas:'订阅额度',diagnostics:'环境体检',activity:'操作记录',settings:'应用设置',distill:'蒸馏工作台',memory:'记忆库',skills:'Skills 管理'}[page];
  if(page==='skills')skillsUI.render($('#content')); else if(page==='distill'||page==='memory')knowledge.render(page,$('#content')); else if(page==='accounts')renderAccounts(); else if(page==='usage')renderUsage(); else if(page==='settings')renderSettings(); else if(page==='quotas')renderQuotas(); else if(page==='diagnostics')renderDiagnostics();
  else $('#content').innerHTML=heading('操作记录','查看本次启动以来的操作结果与问题记录。密码和令牌不会出现在这里。')+`<div class="panel"><h2>本次会话</h2>${events.length?events.map(e=>`<div class="log-entry"><time>${escape(e.time)}</time><span>${escape(e.message)}</span></div>`).join(''):'<div class="k-empty"><span class="k-empty-symbol">✓</span><strong>工作空间已就绪</strong><p>账号切换、额度刷新与管理结果会记录在这里。<br>记录仅保留在本次工具会话中。</p></div>'}</div>`;
  lastRenderedKey=viewKey(state,statistics);
  if(focus){const input=document.getElementById(focus.id);if(input){input.focus({preventScroll:true});if(focus.start!==null)input.setSelectionRange(focus.start,focus.end)}}
}
async function refresh() { state=await api.getState(); render(); }
async function refreshLive(){
  if(busy||loginActive||liveReading){livePending=true;return}
  liveReading=true;const epoch=liveEpoch;
  try{
    const [next,nextUsage]=await Promise.all([api.getState(),api.getStatistics()]);
    if(busy||loginActive||epoch!==liveEpoch){livePending=true;return}
    state=next;statistics=nextUsage;
    if(['accounts','usage','quotas'].includes(page)&&viewKey(next,nextUsage)!==lastRenderedKey)render();
  }catch(e){toast('自动刷新失败：'+e.message)}
  finally{liveReading=false;if(livePending&&!busy&&!loginActive){livePending=false;refreshLive()}}
}
function refreshLocalInBackground(){
  api.refreshLocalData?.().catch(()=>{const status=$('.status-pill');status.title='本地读取失败，保留上次快照；稍后重试。'});
}
function liveTick(){refreshLive();refreshLocalInBackground()}
async function run(task) { if(busy)return; busy=true;liveEpoch++; try{await task()}catch(e){toast(e.message||'操作失败');log('操作失败：'+(e.message||'未知错误'))}finally{busy=false;if(page==='accounts'&&$('#cards'))renderCards();if(livePending){livePending=false;refreshLive()}} }
function modal(title,body,actions) { const el=$('#modal'); el.innerHTML=`<div class="modal-header"><h2 id="modal-title">${title}</h2><button class="close-btn" data-action="close" aria-label="关闭">×</button></div>${body}<div class="modal-actions">${actions}</div>`; if(!el.open)el.showModal(); }
async function closeModal() { if(loginActive){await api.cancelLogin();loginActive=false;} $('#modal').close(); }
function loginView(status) {
  loginState=status;
  const el=$('#login-status'); if(!el)return;
  const messages={starting:'正在启动官方 Codex 登录…',waiting:'请在浏览器中选择要添加的账号并完成授权。',saving:'授权完成，正在读取官方账号与额度并加密保存…',complete:status.message||'账号已添加，套餐与额度已读取。你可以稍后切换使用。',cancelled:'本次登录已取消。',error:status.message||'登录未完成，请重试。'};
  el.textContent=status.browserError||(status.phase==='waiting'&&status.method==='device'?'本地回调端口不可用，已切换设备码登录。请在官方页面输入下方验证码。':status.phase==='waiting'&&!status.url&&!isDemo?'正在准备官方授权链接…':messages[status.phase]||'');
  const device=$('#login-device');if(device){device.hidden=status.method!=='device'||status.phase!=='waiting';$('#login-device-code').textContent=status.deviceCode||'正在获取验证码…';}
  const open=$('#open-login'); if(open)open.disabled=status.phase!=='waiting'||(!status.url&&!isDemo);
  if(['complete','cancelled','error'].includes(status.phase)) { loginActive=false; $('#login-cancel').textContent='完成'; if(status.phase==='complete'){log('已完成官方登录并保存账号');refresh().catch(e=>toast(e.message))} }
}
async function act(action,id) {
  const account=state.accounts.find(a=>a.id===id);
  if(action==='close')return closeModal();
  if(action==='widget')return api.toggleWidget();
  if(action==='statistics-refresh')return run(async()=>{toast('正在读取本机统计…');await api.refreshLocalData?.();await loadStatistics();});
  if(action==='theme'){document.body.classList.toggle('dark');localStorage.setItem('theme',document.body.classList.contains('dark')?'dark':'light');syncWindowTheme();return}
  if(action==='quota-all')return refreshAllQuotas();
  if(action==='diagnostics'){page='diagnostics';render();return}
  if(action==='current-quota'){const a=state.accounts.find(a=>a.isActive);if(!a)return toast('请先保存当前账号');return act('official-refresh',a.id)}
  if(action==='settings'){page='settings';render();return}
  if(action==='add')return modal('添加一个新账号',`<p>通过官方 Codex 登录，在浏览器中完成授权。登录成功后加密保存，不影响当前使用的账号。</p><label for="account-name">账号名称</label><input type="text" id="account-name" maxlength="80" placeholder="例如：工作账号、个人创作"><div class="modal-info">使用本机 Codex CLI 发起登录。浏览器若自动选择了已有账号，请在授权页核对身份。</div>`,button('取消','close')+button('通过浏览器登录','login','primary','arrow'));
  if(action==='login') {
    const name=$('#account-name').value.trim();
    modal('连接你的 Codex 账号',`<p>请保留此窗口，完成浏览器中的官方授权。</p><div class="login-step"><span class="step-number">1</span>打开官方登录页面</div><div class="login-step"><span class="step-number">2</span>选择账号并完成授权</div><div class="login-step"><span class="step-number">3</span>自动加密保存到本机</div><div id="login-status" role="status"></div><div id="login-device" class="modal-info" hidden><p>在本次打开的官方页面输入：</p><strong id="login-device-code" style="display:block;font-size:28px;letter-spacing:3px;user-select:text"></strong><p>若页面提示，请在 ChatGPT 安全设置中允许设备码登录，然后重试。</p></div>`,button('取消登录','close','','','id="login-cancel"')+button('重新打开浏览器','open-login','primary','link','id="open-login" disabled'));
    loginActive=true;
    try{loginView(await api.startLogin(name))}catch(e){loginActive=false;loginView({phase:'error',message:e.message})}
    return;
  }
  if(action==='open-login')return api.openLogin();
  if(action==='save')return modal('保存当前账号','<p>将当前 Codex 登录状态加密保存到账户库。</p><label for="account-name">本机名称</label><input type="text" id="account-name" maxlength="80" placeholder="为这个账号起个名字">',button('取消','close')+button('保存账号','save-confirm','primary'));
  if(action==='save-confirm')return run(async()=>{state=await api.importCurrent($('#account-name').value);$('#modal').close();render();log('已保存当前登录');toast('当前账号已保存')});
  if(action==='switch'&&account)return modal('切换到 '+escape(account.displayName),`<p>将关闭 Codex，保存当前账号的最新登录状态，并在替换凭据后重新启动。</p><div class="modal-info">正在运行的任务可能被中断，请先保存工作。重启后请在 Codex 账号菜单核对身份。</div>`,button('取消','close')+button('切换并重启','switch-confirm','primary','swap',`data-id="${escape(id)}"`));
  if(action==='switch-force-prompt')return modal('结束后台并切换？','<p>这会强制结束 Codex 及其后台任务，未保存的内容可能丢失。请先保存工作。</p>',button('取消','close')+button('确认结束并切换','switch-force-confirm','primary','swap',`data-id="${escape(id)}"`));
  if(action==='switch-confirm'||action==='switch-force-confirm')return run(async()=>{
    $('#modal').close();log('开始切换账号');
    try{state=await api.switchAccount(id,{restartCodex:true,forceClose:action==='switch-force-confirm'});render();log('已替换凭据并重启 Codex，身份待核对');toast(isDemo?'演示切换完成，未操作真实 Codex':'Codex 已重启，请核对账号身份')}
    catch(e){if(!e.message?.includes('CODEX_STILL_RUNNING'))throw e;
      modal('Codex 仍在后台运行','<p>'+(state.platform==='darwin'?'请在 Codex / ChatGPT 应用菜单中选择退出（⌘Q），然后重试。':'关闭窗口后，Codex 仍可能驻留在右下角托盘。请右键托盘图标并选择退出，然后重试。')+'</p><div class="modal-info">凭据尚未改写。若无法从托盘退出，可在保存任务后选择结束后台。</div>',button('取消','close')+button('结束后台并切换','switch-force-prompt','','',`data-id="${escape(id)}"`)+button(state.platform==='darwin'?'已退出应用，重试':'已从托盘退出，重试','switch-confirm','primary','',`data-id="${escape(id)}"`));
    }
  });
  if(action==='active-info')return toast('这是本机凭据对应的账号。Codex 内实际身份请在其账号菜单核对。');
  if(action==='edit'&&account)return modal('管理账号',`<label for="account-name">账号名称</label><input type="text" id="account-name" maxlength="80" value="${escape(account.displayName)}"><p class="email">${escape(account.email)}</p><div class="modal-info">移除只删除本工具中的账号快照，不会退出当前 Codex 登录。</div>`,button('刷新套餐与额度','official-refresh','','refresh',`data-id="${escape(id)}"`)+button('移除账号','delete','danger','',`data-id="${escape(id)}"`)+button('保存名称','rename','primary','',`data-id="${escape(id)}"`));
  if(action==='official-refresh')return run(async()=>{toast('正在读取官方套餐与额度…');state=await api.refreshOfficial(id);$('#modal').close();render();log('已刷新官方套餐与额度');toast('官方套餐与额度已更新')});
  if(action==='rename')return run(async()=>{state=await api.updateAccount(id,{displayName:$('#account-name').value});$('#modal').close();render();log('已更新账号名称')});
  if(action==='delete')return run(async()=>{state=await api.deleteAccount(id);$('#modal').close();render();log('已移除账户库记录');toast('账号已从账户库移除')});
  if(action==='statistics-export')return run(async()=>{if(await api.exportStatistics()){toast('用量 CSV 已导出');log('已导出本机近 7 天用量汇总')}});
  if(action==='check-updates')return run(async()=>{
    toast('正在检查 GitHub 发布版本…');const result=await api.checkForUpdates();
    const title=result.comparison>0?'发现新版本':result.comparison===0?'当前已是最新版本':'当前版本高于已发布版本';
    modal(title,'<p>当前 v'+escape(result.currentVersion)+' · GitHub v'+escape(result.latestVersion)+(result.prerelease?'（预览版）':'')+'</p><p class="help-text">打开浏览器后可查看发布说明和校验文件。下载后请退出旧版管理工具，再手动安装。</p>',button('关闭','close')+button('发布说明','update-release','','link')+(result.comparison>0&&result.installer?button('下载当前平台版本','update-installer','primary','download'):''));
  });
  if(action==='update-release'||action==='update-installer')return run(async()=>{await api.openUpdate(action==='update-release'?'release':'installer')});
  if(action==='refresh')return run(async()=>{toast('正在读取本地状态…');await api.refreshLocalData?.();await refresh();toast('本地账号状态已刷新')});
  if(action==='usage-refresh')return run(async()=>{dashboard=await api.getDashboard();render();log('已读取本机用量统计')});
  if(action==='enable-file')return modal('启用文件凭据管理','<p>将备份 Codex 配置，并将登录凭据存储设为 file。此操作不会把系统凭据自动复制到文件；你可能需要重新登录。</p>',button('取消','close')+button('启用并备份配置','enable-file-confirm','primary'));
  if(action==='enable-file-confirm')return run(async()=>{state=await api.enableFileStore();$('#modal').close();render();log('已启用文件凭据管理');toast('已备份并更新配置')});
  if(action==='open-codex'||action==='open-store')return api.openPath(action==='open-codex'?state.codexDir:state.storeRoot);
  if(action==='import'||action==='export')return modal(action==='import'?'导入加密凭据':'导出当前账号',`<p>${action==='import'?'输入迁移密码，再选择 .codexauth 文件。导入只保存，不切换。':'设置至少 10 个字符的密码来保护迁移文件，请自行妥善保管。'}</p><label for="password">迁移密码</label><input type="password" id="password" autocomplete="new-password">`,button('取消','close')+button('选择文件','portable-'+action,'primary'));
  if(action.startsWith('portable-'))return run(async()=>{const password=$('#password').value;await api[action==='portable-import'?'importPortable':'exportPortable'](password);$('#password').value='';$('#modal').close();await refresh()});
}
document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-page]'); if(nav){e.preventDefault();page=nav.dataset.page;render();return}
  const f=e.target.closest('[data-filter]');if(f){filter=f.dataset.filter;render();return}
  const action=e.target.closest('[data-action]');if(action&&!action.disabled)act(action.dataset.action,action.dataset.id).catch(e=>toast(e.message));
});
$('#modal').addEventListener('cancel',e=>{e.preventDefault();closeModal().catch(e=>toast(e.message))});
document.body.classList.toggle('privacy',localStorage.getItem('privacy')==='1');
document.body.classList.toggle('dark',localStorage.getItem('theme')==='dark');
syncWindowTheme();
if(api){
  api.getVersion?.().then(version=>{appVersion=version;$('.version small').textContent='v'+version+' · 非官方工具';if(page==='settings')renderSettings()}).catch(()=>{});
  api.onStateChanged?.(event=>{
    if(event.scope==='knowledge')knowledge.update(event);
    else if(event.scope==='login')loginView(event);
    else if(event.scope==='switch'){state.switchStatus=event;if(page==='accounts')renderAccounts()}
    else {refreshLive();if(event.scope==='accounts')refreshLocalInBackground()}
  });
  refresh().then(()=>{loadStatistics();refreshLocalInBackground()}).catch(e=>{render();toast('无法加载账号：'+e.message)});
  if(!isDemo){setInterval(()=>{if(!document.hidden)liveTick()},10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)liveTick()});window.addEventListener('focus',liveTick)}
}else{
  render();toast('请通过桌面程序打开，或使用 ?demo=1 查看演示。');
}
