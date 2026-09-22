// Real installed Codex CLI config editor, isolated CODEX_HOME, no model or account calls.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {writeSkillConfig,readConfig}=require('../src/skills/config');
(async()=>{const home=await fs.mkdtemp(path.join(os.tmpdir(),'cam-skills-native-'));try{
  await fs.writeFile(path.join(home,'config.toml'),'# Preserve comments\nmodel = "fixture"\n[features]\nmemories = false\n');
  const file=path.join(home,'skills','sample','SKILL.md');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'---\nname: sample\ndescription: fixture\n---\n');
  await writeSkillConfig(home,[{path:file,enabled:false}]);assert.equal((await readConfig(home)).skills.config[0].enabled,false);
  await writeSkillConfig(home,[{path:file,enabled:true}]);const config=await readConfig(home);assert.equal(config.skills.config.length,1);assert.equal(config.skills.config[0].enabled,true);assert.equal(config.model,'fixture');assert.equal(config.features.memories,false);assert.match(await fs.readFile(path.join(home,'config.toml'),'utf8'),/# Preserve comments/);
  console.log('SKILLS CONFIG PASS: real native CLI versioned config writes, enable/disable, unrelated settings and comments preserved. No auth or model calls.');
}finally{await fs.rm(home,{recursive:true,force:true,maxRetries:10,retryDelay:200})}})().catch(e=>{console.error(e);process.exitCode=1});
