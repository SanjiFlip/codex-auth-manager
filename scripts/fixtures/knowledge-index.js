const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
// Synthetic desktop index. Callers supply their isolated temp home and files.
function writeKnowledgeIndex(home,rows,{root='/sample/project',name='示例项目'}={}) {
  const db=new DatabaseSync(path.join(home,'state_5.sqlite'));
  try {
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,metadata TEXT,position INTEGER); CREATE TABLE project_roots(project_id TEXT,path TEXT,position INTEGER); CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,cwd TEXT,title TEXT,source TEXT,archived INTEGER,project_id TEXT,updated_at INTEGER);');
    db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run('fixture-project',name,'{}',0);
    db.prepare('INSERT INTO project_roots VALUES (?,?,?)').run('fixture-project',root,0);
    const insert=db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)');
    for(const row of rows)insert.run(row.id,row.file,row.cwd||root,row.title||row.id,row.source||'cli',row.archived?1:0,row.projectId===undefined?'fixture-project':row.projectId,row.updatedAt||Date.now());
  }finally{db.close()}
}
module.exports={writeKnowledgeIndex};
