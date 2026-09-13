// Explicit requests from both windows share the same in-flight query.
function createOfficialRefresh({refresh}){
  const pending=new Map();
  function request(id){
    if(pending.has(id))return pending.get(id);
    const job=Promise.resolve().then(()=>refresh(id)).finally(()=>pending.delete(id));
    pending.set(id,job);return job;
  }
  return {request};
}
module.exports={createOfficialRefresh};
