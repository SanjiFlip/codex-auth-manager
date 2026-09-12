(function(root){
  const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function summarize(usage,now=new Date()){
    if(!usage)return {loaded:false,daily:[],todayTokens:null,todaySessions:null,weekTokens:null,models:[],sessions:null};
    const daily=[];
    for(let offset=6;offset>=0;offset--){const date=new Date(now);date.setDate(date.getDate()-offset);const key=dayKey(date);const raw=(usage.daily||[]).find(row=>row.day===key);daily.push({day:key,label:offset===0?'今天':`${date.getMonth()+1}/${date.getDate()}`,tokens:raw?.tokenUsage?.totalTokens||0,sessions:raw?.sessions||0})}
    return {loaded:true,daily,todayTokens:daily[6].tokens,todaySessions:daily[6].sessions,weekTokens:daily.reduce((sum,d)=>sum+d.tokens,0),models:usage.models||[],sessions:usage.sessionsAnalyzed??0,scannedFiles:usage.scannedFiles??null,failedFiles:usage.failedFiles??null};
  }
  function compact(value){if(typeof value!=='number'||!Number.isFinite(value))return '—';return value>=1e8?`${(value/1e8).toFixed(2)}亿`:value>=1e4?`${(value/1e4).toFixed(1)}万`:value.toLocaleString('zh-CN')}
  function remaining(window){return typeof window?.usedPercent==='number'&&Number.isFinite(window.usedPercent)?Math.round(Math.max(0,Math.min(100,100-window.usedPercent))):null}
  function resetTime(value){if(!value)return '恢复时间待获取';const ms=new Date(value).getTime()-Date.now();if(!Number.isFinite(ms))return '恢复时间待获取';if(ms<=0)return '窗口已到期 · 等待刷新';const mins=Math.ceil(ms/60000),hours=Math.floor(mins/60);return hours>=24?`${Math.floor(hours/24)} 天 ${hours%24} 小时后恢复`:`${hours} 小时 ${mins%60} 分钟后恢复`}
  const api={summarize,compact,remaining,resetTime,dayKey};if(typeof module!=='undefined')module.exports=api;else root.UsageStatistics=api;
})(typeof window!=='undefined'?window:globalThis);
