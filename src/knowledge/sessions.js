const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');
const path = require('node:path');
const crypto = require('node:crypto');
const {activeSessions,normalized}=require('./projects');
const BODY_WINDOW_BYTES = 8 * 1024 * 1024;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const signature = stat => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;

// Renderer paths are never accepted. Containment is checked even for cache hits.
function createSessionLibrary(home) {
  const refs = new Map(), transcripts = new Map(), pending = new Map();
  let snapshot, expiresAt = 0, listing, retainedChars = 0, fallbackFiles;
  async function checked(file) {
    const root = await fs.realpath(path.join(home, 'sessions'));
    const actual = await fs.realpath(file), rel = path.relative(root, actual);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('会话不在允许的目录中。');
    const stat = await fs.stat(actual);
    if (!stat.isFile()) throw Error('会话正文不是有效文件。');
    return { actual, stat };
  }
  async function localFiles(){
    const files=[];
    async function walk(dir){let entries;try{entries=await fs.readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e;}
      for(const entry of entries){if(entry.name.startsWith('.'))continue;const full=path.join(dir,entry.name);if(entry.isDirectory())await walk(full);else if(entry.isFile()&&entry.name.endsWith('.jsonl'))files.push(full);}
    }
    await walk(path.join(home,'sessions'));return files;
  }
  async function resolveFile(meta){
    if(meta.file)try{return await checked(meta.file)}catch{}
    // Only locate filenames for a thread already admitted by the archive/project index.
    // This never opens unknown or archived conversation bodies.
    if(!fallbackFiles)fallbackFiles=await localFiles();
    const matches=fallbackFiles.filter(file=>path.basename(file)===meta.sessionId+'.jsonl'||path.basename(file).endsWith('-'+meta.sessionId+'.jsonl'));
    if(matches.length===1)try{return await checked(matches[0])}catch{}
    throw Object.assign(Error('此会话在本机缺少可读取的正文，请确认原文件或重新读取。'),{code:'SESSION_NOT_LOCAL'});
  }
  async function scan() {
    const scope=await activeSessions(home),items=[],nextRefs=new Map();let missing=0;fallbackFiles=null;
    for(const meta of scope.items){
      const id=hash(meta.sessionId);let resolved;
      try{resolved=await resolveFile(meta)}catch{missing++;}
      nextRefs.set(id,{file:resolved?.actual||null,sessionId:meta.sessionId});
      items.push({id,title:meta.title,project:meta.project,projectId:meta.projectId,sessionId:meta.sessionId,readStatus:resolved?'ready':'not-local',updatedAt:new Date(meta.updatedAt||resolved?.stat.mtimeMs||0).toISOString()});
    }
    refs.clear();for(const [id,ref] of nextRefs)refs.set(id,ref);
    snapshot={items,skipped:0,missing,limited:false,projectCount:scope.projectCount};expiresAt=Date.now()+15000;return snapshot;
  }
  async function list({ force = false } = {}) {
    if (listing) return listing;
    if (!force && snapshot && Date.now() < expiresAt) return snapshot;
    listing = scan();
    try { return await listing; } finally { listing = null; }
  }
  async function parse(file,size) {
    const start=Math.max(0,size-BODY_WINDOW_BYTES);let skipPartial=start>0;
    if(size===0)return {messages:[],limited:false,invalidLines:0,windowed:false,readBytes:0};
    const response = [], legacy = []; let responseCount = 0, legacyCount = 0, invalidLines = 0;
    function message(role, text, index) {
      return { role, index, text: text.slice(0, 20000), fingerprint: hash(role + '\n' + text), truncated: text.length > 20000 };
    }
    const stream = createReadStream(file, { encoding: 'utf8',start,end:size-1 });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if(skipPartial){skipPartial=false;continue;}
        let e;
        try { e = JSON.parse(line); } catch { if (line.trim()) invalidLines++; continue; }
        if (!e || typeof e !== 'object') continue;
        const p = e.payload;
        if (e.type === 'response_item' && p?.type === 'message' && ['user', 'assistant'].includes(p.role) && (!p.channel || p.channel === 'final')) {
          const body = (Array.isArray(p.content) ? p.content : []).filter(c => c && ['input_text', 'output_text', 'text'].includes(c.type) && typeof c.text === 'string').map(c => c.text).join('\n');
          if (body.trim()) { response[responseCount % 500] = message(p.role, body, responseCount); responseCount++; }
        } else if (!responseCount && e.type === 'event_msg' && ['user_message', 'agent_message'].includes(p?.type) && typeof p.message === 'string') {
          legacy[legacyCount % 500] = message(p.type === 'user_message' ? 'user' : 'assistant', p.message, legacyCount); legacyCount++;
        }
      }
    } finally { lines.close(); stream.destroy(); }
    return { messages: (responseCount ? response : legacy).sort((a, b) => a.index - b.index), limited: start>0||(responseCount || legacyCount)>500,windowed:start>0,readBytes:size-start,invalidLines };
  }
  function unavailable(id) {
    retainedChars -= transcripts.get(id)?.chars || 0;
    transcripts.delete(id); refs.delete(id); snapshot = null; expiresAt = 0;
    return Object.assign(Error('该会话已归档或不属于启用的项目，请重新读取。'), {code:'SESSION_UNAVAILABLE'});
  }
  async function transcript(id) {
    const ref=refs.get(id);if(!ref)throw unavailable(id);
    const scope=await activeSessions(home,ref.sessionId),allowed=scope.items.find(s=>s.sessionId===ref.sessionId);
    if(!allowed)throw unavailable(id);
    const {actual,stat}=await resolveFile(allowed);
    const file=actual;
    const key=signature(stat);
    const hit = transcripts.get(id);
    if (hit?.key === key && hit.file === actual) {
      transcripts.delete(id); transcripts.set(id, hit); return hit.value;
    }
    const pendingKey = `${actual}:${key}`;
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    const work = (async () => {
      const value = await parse(actual,stat.size);
      const latest=await activeSessions(home,ref.sessionId);
      const latestMeta=latest.items.find(s=>s.sessionId===ref.sessionId);if(!latestMeta)throw unavailable(id);
      const verified=await resolveFile(latestMeta);if(normalized(verified.actual)!==normalized(actual))throw unavailable(id);
      const after = await checked(file);
      if (after.actual === actual && signature(after.stat) === key) {
        const chars = value.messages.reduce((n, m) => n + m.text.length, 0);
        if (chars <= 4000000) {
          retainedChars -= transcripts.get(id)?.chars || 0;
          transcripts.delete(id); transcripts.set(id, { key, file: actual, value, chars }); retainedChars += chars;
          while (retainedChars > 4000000 || transcripts.size > 6) {
            const oldest = transcripts.keys().next().value;
            retainedChars -= transcripts.get(oldest).chars; transcripts.delete(oldest);
          }
        }
      }
      return value;
    })();
    pending.set(pendingKey, work);
    try { return await work; } finally { pending.delete(pendingKey); }
  }
  return { list, transcript };
}
module.exports = { createSessionLibrary };
