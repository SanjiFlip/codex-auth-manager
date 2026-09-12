(function(root){
  function planLabel(value) {
    const plan=String(value||'').toLowerCase();
    return ({pro:'Pro 20x',prolite:'Pro 5x',plus:'Plus',free:'Free',go:'Go',team:'Team',business:'Business',enterprise:'Enterprise',edu:'Edu',self_serve_business_prolite:'Business Pro Lite',self_serve_business_usage_based:'Business Usage Based'})[plan] || (plan ? '套餐待识别' : '套餐未知');
  }
  function showFiveHour(plan,settings){return !['pro','prolite'].includes(String(plan||'').toLowerCase())||settings?.proFiveHourEnabled===true}
  if(typeof module!=='undefined')module.exports={planLabel,showFiveHour};
  else {root.planLabel=planLabel;root.showFiveHour=showFiveHour;}
})(typeof window!=='undefined'?window:globalThis);
