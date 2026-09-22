const {dayKey}=require('./ui/statistics');

// Export aggregates only. Do not serialize account, file, session or prompt metadata.
function csvCell(value){
  let text=String(value??'');
  if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
function count(value){return Number.isSafeInteger(value)&&value>=0?value:''}
function usageCsv(usage,now=new Date()){
  if(!usage||typeof usage!=='object')throw Error('尚无可导出的统计数据。');
  const rows=[['范围','日期','模型','会话数','输入 Tokens','缓存输入 Tokens（输入子项）','输出 Tokens','推理输出 Tokens（输出子项）','总 Tokens']];
  const add=(scope,date,model,sessions,tokens={},available)=>{
    const value=key=>available&&available[key]!==true?'':count(tokens?.[key]);
    rows.push([scope,date,model,count(sessions),value('inputTokens'),value('cachedInputTokens'),value('outputTokens'),value('reasoningOutputTokens'),value('totalTokens')]);
  };
  for(let offset=6;offset>=0;offset--){
    const date=new Date(now);date.setDate(date.getDate()-offset);const key=dayKey(date);
    const row=(usage.daily||[]).find(item=>item.day===key);
    add('本机每日',key,'',row?.sessions??0,row?row.tokenUsage:{inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningOutputTokens:0,totalTokens:0},row?.tokenAvailability);
  }
  for(const model of usage.models||[])add('本机近7天模型','',model.model??'未知模型',model.sessions,model.tokenUsage,model.tokenAvailability);
  add('本机近7天总计','','',usage.sessionsAnalyzed,usage.tokenUsage,usage.tokenAvailability);
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
module.exports={usageCsv};
