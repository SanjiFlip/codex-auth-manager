// Compare event timestamps, not the time an old snapshot was read from disk.
const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const {selectWindow}=require('./select-window');
function displaySnapshot(official,local){
  if(!official&&!local)return null;
  const result={...(official||local)};
  let latest=0,source=official?.source||local?.source;
  for(const key of ['session','weekly']){
    const a=official?.[key],b=local?.[key];
    const at=time(a?.checkedAt||official?.checkedAt),bt=time(b?.checkedAt||local?.checkedAt);
    const window=bt>at||!a?selectWindow(a,b,official?.checkedAt,local?.checkedAt):a;
    const fromLocal=!!b&&window===b;
    result[key]=window?{...window}:null;
    if(window){
      // Local logs use Unix seconds; official snapshots already use ISO dates.
      if(typeof window.resetsAt==='number')result[key].resetsAt=new Date(window.resetsAt*1000).toISOString();
      const stamp=fromLocal?bt:at;
      if(stamp>=latest){latest=stamp;source=fromLocal?local.source:official.source;}
    }
  }
  const reset=local?.resetCredits;
  result.resetCredits=reset&&(!official||time(reset.checkedAt)>time(official.checkedAt))?reset.availableCount:official?.resetCredits??reset?.availableCount??null;
  result.source=source;
  result.checkedAt=latest?new Date(latest).toISOString():official?.checkedAt||local?.checkedAt;
  return result;
}
module.exports={displaySnapshot};
