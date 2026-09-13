// Main-process gate shared by both windows. Failures also receive a cooldown.
function createOfficialRefresh({refresh,now=Date.now,interval=60000}){
  const pending=new Map(),attempts=new Map();
  function request(id,{automatic=false,checkedAt=null}={}){
    if(pending.has(id))return pending.get(id);
    const last=Math.max(attempts.get(id)??-Infinity,Date.parse(checkedAt)||-Infinity);
    if(automatic&&now()-last<interval)return Promise.resolve(null);
    attempts.set(id,now());
    const job=Promise.resolve().then(()=>refresh(id)).finally(()=>pending.delete(id));
    pending.set(id,job);return job;
  }
  return {request};
}
module.exports={createOfficialRefresh};
