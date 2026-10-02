(function(root){
  function planLabel(value) {
    const plan=String(value||'').toLowerCase();
    return ({pro:'Pro',prolite:'Pro Lite',promax:'Pro Max',plus:'Plus',free:'Free',go:'Go',team:'Team',business:'Business',enterprise:'Enterprise',ent26:'Enterprise',enterprise_cbp_automation:'Enterprise Automation',enterprise_cbp_usage_based:'Enterprise Usage Based',edu:'Edu',edu_plus:'Edu Plus',edu_pro:'Edu Pro',self_serve_business_prolite:'Business Pro Lite',self_serve_business_usage_based:'Business Usage Based'})[plan] || (plan ? '套餐待识别' : '套餐未知');
  }
  function showFiveHour(plan,settings){return !['pro','prolite','promax'].includes(String(plan||'').toLowerCase())||settings?.proFiveHourEnabled===true}
  if(typeof module!=='undefined')module.exports={planLabel,showFiveHour};
  else {root.planLabel=planLabel;root.showFiveHour=showFiveHour;}
})(typeof window!=='undefined'?window:globalThis);
