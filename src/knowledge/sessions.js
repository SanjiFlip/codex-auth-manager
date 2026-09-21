const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');
const path = require('node:path');
const crypto = require('node:crypto');
const {activeSessions,normalized}=require('./projects');
const MAX_BYTES = 32 * 1024 * 1024;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const signature = stat => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;

// Renderer paths are never accepted. Containment is checked even for cache hits.
function createSessionLibrary(home) {
  const refs = new Map(), transcripts = new Map(), pending = new Map();
  let snapshot, expiresAt = 0, listing, retainedChars = 0;
  async function checked(file) {
    const root = await fs.realpath(path.join(home, 'sessions'));
    const actual = await fs.realpath(file), rel = path.relative(root, actual);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('会话不在允许的目录中。');
    const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('会话文件超过 32 MB，请使用较小的会话。');
    return { actual, stat };
  }
  async function scan() {
    const scope=await activeSessions(home), items=[], nextRefs=new Map();let skipped=0;
    for (const meta of scope.items) {
      if (items.length >= 300) break;
      try {
        const {actual:file,stat}=await checked(meta.file),id=hash(file);
        if (nextRefs.has(id)) continue;
        nextRefs.set(id,{file,sessionId:meta.sessionId});
        items.push({id,title:meta.title,project:meta.project,projectId:meta.projectId,sessionId:meta.sessionId,updatedAt:new Date(stat.mtimeMs).toISOString()});
      } catch { skipped++; }
    }
    refs.clear(); for (const [id,ref] of nextRefs) refs.set(id,ref);
    snapshot={items,skipped,limited:scope.items.length>300,projectCount:scope.projectCount};
    expiresAt=Date.now()+15000;
    return snapshot;
  }
  async function list({ force = false } = {}) {
    if (listing) return listing;
    if (!force && snapshot && Date.now() < expiresAt) return snapshot;
    listing = scan();
    try { return await listing; } finally { listing = null; }
  }
  async function parse(file) {
    const response = [], legacy = []; let responseCount = 0, legacyCount = 0, invalidLines = 0;
    function message(role, text, index) {
      return { role, index, text: text.slice(0, 20000), fingerprint: hash(role + '\n' + text), truncated: text.length > 20000 };
    }
    const stream = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
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
    return { messages: (responseCount ? response : legacy).sort((a, b) => a.index - b.index), limited: (responseCount || legacyCount) > 500, invalidLines };
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
    const file=allowed.file;
    let checkedFile;
    try { checkedFile=await checked(file); } catch(error) { if(error.code==='ENOENT')throw unavailable(id);throw error; }
    const {actual,stat}=checkedFile;
    if(normalized(actual)!==normalized(ref.file))throw unavailable(id);
    const key=signature(stat);
    const hit = transcripts.get(id);
    if (hit?.key === key && hit.file === actual) {
      transcripts.delete(id); transcripts.set(id, hit); return hit.value;
    }
    const pendingKey = `${actual}:${key}`;
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    const work = (async () => {
      const value = await parse(actual);
      const latest=await activeSessions(home,ref.sessionId);
      if(!latest.items.some(s=>s.sessionId===ref.sessionId&&normalized(s.file)===normalized(file)))throw unavailable(id);
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
