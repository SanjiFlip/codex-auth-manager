const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function normalized(value) {
  if (typeof value !== 'string') return '';
  const source=value.replace(/^\\\\\?\\UNC\\/i,'//').replace(/^\\\\\?\\/,'');
  const windows=/^[a-z]:/i.test(source)||source.startsWith('\\\\')||source.startsWith('//');
  const result=windows?path.win32.normalize(source).replace(/\\/g,'/').toLowerCase():path.posix.normalize(source.replace(/\\/g,'/'));
  return result.replace(/\/+$/,'');
}
function projectName(root) { return String(root || '').replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || 'Codex 项目'; }
function isLocalRoot(root) { return typeof root === 'string' && root.length > 0 && !/\/\.chatgpt-projects(?:\/|$)/.test(normalized(root)); }

// Read the desktop's project/thread index before opening any transcript body.
// Unknown archive state is not treated as active.
async function activeSessions(home, sessionId) {
  const files = (await fs.readdir(home)).filter(n => /^state_\d+\.sqlite$/.test(n)).sort((a,b) => Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
  if (!files.length) throw Error('未找到 Codex 项目索引。请先打开 Codex 加载启用的项目，再重新读取。');
  let global = {};
  try { global = JSON.parse(await fs.readFile(path.join(home, '.codex-global-state.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('无法读取 Codex 项目设置，请稍后重新读取。'); }
  let db;
  try {
    db = new DatabaseSync(path.join(home, files[0]), { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(x=>x.name));
    if (!['id','cwd','rollout_path','archived','source'].every(c=>columns.has(c))) throw Error('unsupported');
    const projects = new Map();
    if (tables.has('projects') && tables.has('project_roots')) {
      for (const row of db.prepare('SELECT p.id,p.name,p.metadata,r.path FROM projects p JOIN project_roots r ON r.project_id=p.id ORDER BY p.position,r.position').all()) {
        let meta={}; try { meta=JSON.parse(row.metadata||'{}'); } catch { continue; }
        if (!meta || typeof meta!=='object' || meta.archived || meta.archivedAt || meta.archived_at || meta.enabled === false || !isLocalRoot(row.path)) continue;
        if (!projects.has(row.id)) projects.set(row.id,{id:row.id,name:row.name||projectName(row.path),roots:[]});
        projects.get(row.id).roots.push(normalized(row.path));
      }
    } else {
      // Older desktop versions keep the saved (not just foreground) projects here.
      for (const [id,p] of Object.entries(global['local-projects']||{})) {
        if (!p || id.startsWith('g-') || p.archived || p.archivedAt || p.archived_at || p.enabled === false) continue;
        const roots=(Array.isArray(p.rootPaths)?p.rootPaths:[]).filter(isLocalRoot).map(normalized);
        if (roots.length) projects.set(id,{id,name:p.name||projectName(roots[0]),roots});
      }
      if (!Object.hasOwn(global,'local-projects')) for (const root of global['electron-saved-workspace-roots']||[]) {
        if (isLocalRoot(root)) projects.set(normalized(root),{id:normalized(root),name:projectName(root),roots:[normalized(root)]});
      }
    }
    const roots=[...projects.values()].flatMap(p=>p.roots.map(root=>({root,project:p}))).sort((a,b)=>b.root.length-a.root.length);
    const matches=cwd=>roots.find(({root})=>cwd===root||cwd.startsWith(root+'/'))?.project;
    const projection=['id','rollout_path','cwd','source',...['title','project_id','updated_at'].filter(c=>columns.has(c))].join(',');
    const rows=db.prepare(`SELECT ${projection} FROM threads WHERE archived=0 AND source IN ('cli','vscode','exec','app-server')${sessionId?' AND id=?':''}${columns.has('updated_at')?' ORDER BY updated_at DESC':''}`).all(...(sessionId?[sessionId]:[]));
    const items=[];
    for (const row of rows) {
      let project;
      // An explicit removed project assignment must not fall back to a matching parent path.
      if (row.project_id) project=projects.get(row.project_id);
      else {
        const assignment=global['thread-project-assignments']?.[row.id];
        if (assignment) {
          if (assignment.projectKind !== 'local') continue;
          project=projects.get(assignment.projectId);
          if (!project) {
            const legacy=global['local-projects']?.[assignment.projectId];
            if (legacy && !legacy.archived && !legacy.archivedAt && !legacy.archived_at && legacy.enabled !== false)
              project=(legacy.rootPaths||[]).map(normalized).map(root=>roots.find(r=>r.root===root)?.project).find(Boolean);
          }
        } else project=matches(normalized(row.cwd));
      }
      if (!project || typeof row.rollout_path !== 'string') continue;
      items.push({sessionId:row.id,file:row.rollout_path,projectId:project.id,project:project.name,title:typeof row.title==='string'&&row.title.trim()?row.title.trim().slice(0,160):project.name});
    }
    return {items,projectCount:projects.size};
  } catch { throw Error('无法读取 Codex 启用项目或归档状态。本次不读取会话正文，请稍后重试。'); }
  finally { db?.close(); }
}

module.exports={activeSessions,normalized,projectName};
