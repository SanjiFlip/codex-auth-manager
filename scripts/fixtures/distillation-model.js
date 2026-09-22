// Synthetic model response for offline lifecycle tests, never used by the app.
module.exports=function response({prompt,outputSchema}){
  const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
  if(outputSchema.properties.facts)return JSON.stringify({facts:input.slice(0,2).map(row=>({text:'保留素材中的项目约定，核对适用条件。',category:'uncertain',evidence:[{source:row.source,quote:row.text.slice(0,120)}]}))});
  return JSON.stringify({sections:[{heading:'项目约定与验证',text:'根据会话整理项目约定；应用前检查当前条件，并验证主窗口与悬浮窗。',factIds:input.map(f=>f.id)}]});
};
