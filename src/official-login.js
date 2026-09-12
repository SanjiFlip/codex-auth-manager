const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function resolveCli() {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Command codex -ErrorAction Stop).Source'], { windowsHide: true, timeout: 10000 });
  const entry = stdout.trim();
  if (entry.toLowerCase().endsWith('.exe')) return { command: entry, args: [] };
  const js = path.join(path.dirname(entry), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  await fs.access(js);
  return { command: process.execPath, args: [js], node: true };
}

// Only the official authorization URL is exposed, never arbitrary CLI output.
function loginUrl(text) {
  for (const match of text.matchAll(/https:\/\/[^\s<>"\x1b]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.origin === 'https://auth.openai.com' && url.pathname === '/oauth/authorize') return url.href;
    } catch {}
  }
  return null;
}

function createLogin({ root, save, report = () => {}, resolve = resolveCli, spawnProcess = spawn, stopProcess, query } = {}) {
  let active = null;
  let publicState = { phase: 'idle' };
  const publish = state => { publicState = state; report(state); };
  async function start(name) {
    if (active) throw new Error('已有登录正在进行，请完成或取消后再添加。');
    const session = { cancelled: false, child: null, timer: null, phase: 'starting' };
    active = session;
    publish({ phase: 'starting' });
    session.done = (async () => {
      let directory;
      try {
        const cli = await resolve();
        if (session.cancelled) return;
        await fs.mkdir(root, { recursive: true });
        directory = await fs.mkdtemp(path.join(root, 'login-'));
        if (session.cancelled) return;
        const env = { ...process.env, CODEX_HOME: directory };
        delete env.OPENAI_API_KEY;
        delete env.CODEX_ACCESS_TOKEN;
        if (cli.node) env.ELECTRON_RUN_AS_NODE = '1';
        const child = spawnProcess(cli.command, [...cli.args, 'login', '-c', 'cli_auth_credentials_store="file"'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        session.child = child;
        session.phase = 'waiting';
        publish({ phase: 'waiting' });
        let buffer = '';
        const onOutput = chunk => {
          buffer = (buffer + chunk.toString()).slice(-16000);
          const url = loginUrl(buffer);
          if (url && !session.cancelled) publish({ phase: 'waiting', url });
        };
        child.stdout.on('data', onOutput);
        child.stderr.on('data', onOutput);
        session.timer = setTimeout(() => { cancel().catch(() => {}); }, 5 * 60 * 1000);
        const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
        session.child = null;
        if (session.cancelled) return;
        if (code !== 0) throw new Error('login failed');
        if (session.cancelled) return;
        // Once saving starts cancellation is no longer presented as successful.
        session.phase = 'saving';
        publish({ phase: 'saving' });
        let details=null,queryError=null;
        if(query){try{details=await query(directory)}catch{queryError='账号已保存，但官方额度读取失败，可稍后重试。'}}
        // The official service may refresh tokens. Save the latest file, never the pre-query copy.
        const content = await fs.readFile(path.join(directory, 'auth.json'), 'utf8');
        await save(content, String(name || '').slice(0, 80), details);
        publish({ phase: 'complete', message:queryError });
      } catch {
        if (!session.cancelled) publish({ phase: 'error', message: '登录未完成。请确认已安装 Codex CLI、浏览器授权成功且网络可用，然后重试。' });
      } finally {
        clearTimeout(session.timer);
        if (directory) {
          try { await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
          catch { publish({ phase: 'error', message: '登录临时目录未能清理。请退出工具后检查账户库下的 pending-logins 目录。' }); }
        }
        if (session.cancelled && publicState.phase !== 'error') publish({ phase: 'cancelled' });
        active = null;
      }
    })();
    return publicState;
  }
  async function cancel() {
    const session = active;
    if (!session) return publicState;
    if (session.phase === 'saving') { await session.done; return publicState; }
    session.cancelled = true;
    if (session.child?.pid) {
      if (stopProcess) await stopProcess(session.child);
      else await execute('taskkill.exe', ['/PID', String(session.child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => {});
    }
    await session.done;
    return publicState;
  }
  return { start, cancel, state: () => publicState, busy: () => !!active };
}
module.exports = { createLogin, loginUrl, resolveCli };
