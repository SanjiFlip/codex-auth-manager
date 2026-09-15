const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createInterface } = require('node:readline');
const execute = promisify(execFile);

const {createRequire}=require('node:module');
async function isFile(file){try{return (await fs.stat(file)).isFile()}catch{return false}}
async function nativeFromPackage(root,arch){
  const target=arch==='arm64'?'aarch64-pc-windows-msvc':arch==='x64'?'x86_64-pc-windows-msvc':null;
  if(!target)throw new Error('不支持当前 Codex CLI 架构。');
  const roots=[];
  try{
    const requirePackage=createRequire(path.join(root,'package.json'));
    roots.push(path.join(path.dirname(requirePackage.resolve('@openai/codex-win32-'+arch+'/package.json')),'vendor'));
  }catch{}
  roots.push(path.join(root,'vendor'));
  for(const vendor of roots)for(const folder of ['bin','codex']){
    const executable=path.join(vendor,target,folder,'codex.exe');
    if(await isFile(executable))return {command:executable,args:[]};
  }
  throw new Error('未找到 Codex 原生程序，请重新安装完整的 Codex CLI 后重试。');
}
async function resolveCli({env=process.env,arch=process.arch}={}) {
  const value=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]||'';
  for(const raw of value.split(path.delimiter)){
    const directory=raw.trim().replace(/^"|"$/g,'');if(!directory||!path.isAbsolute(directory))continue;
    const executable=path.join(directory,'codex.exe');
    if(await isFile(executable))return {command:executable,args:[]};
    for(const extension of ['cmd','ps1','bat']){
      if(!await isFile(path.join(directory,'codex.'+extension)))continue;
      const root=path.join(directory,'node_modules','@openai','codex');
      return nativeFromPackage(await fs.realpath(root).catch(()=>root),arch);
    }
  }
  throw new Error('未找到 Codex 原生 CLI，请安装后重新打开管理工具。');
}

// Only the official authorization URL is exposed, never arbitrary CLI output.
function loginUrl(text) {
  for (const match of text.matchAll(/https:\/\/[^\s<>"\x1b]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.origin === 'https://auth.openai.com' && ['/oauth/authorize','/codex/device'].includes(url.pathname)) return url.href;
    } catch {}
  }
  return null;
}

function createLogin({ root, save, report = () => {}, resolve = resolveCli, spawnProcess = spawn, stopProcess, query, openBrowser } = {}) {
  let active = null;
  let publicState = { phase: 'idle' };
  const publish = state => { publicState = state; report(state); };
  const waiting = session => ({phase:'waiting',url:session.url,method:session.device?'device':'browser',deviceCode:session.deviceCode||null});
  async function open() {
    const session=active;
    if(!session||session.cancelled||session.phase!=='waiting'||!session.url)throw new Error('登录链接尚未准备好或已失效，请重新发起登录。');
    if(session.opening)return session.opening;
    session.opening=(async()=>{
      try{
        if(!openBrowser)throw new Error('Browser opener unavailable');
        await openBrowser(session.url);
        if(active===session&&!session.cancelled&&session.phase==='waiting')publish({...waiting(session),browserError:null});
      }catch{
        const message='无法打开默认浏览器。请检查 Windows 默认浏览器设置，再点击“重新打开浏览器”。';
        if(active===session&&!session.cancelled&&session.phase==='waiting')publish({...waiting(session),browserError:message});
        throw new Error(message);
      }
    })();
    try{return await session.opening}finally{session.opening=null}
  }
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
        session.timer = setTimeout(() => { cancel().catch(() => {}); }, 5 * 60 * 1000);
        async function attempt(device){
          session.device=device;session.url=null;session.deviceCode=null;
          const child=spawnProcess(cli.command,[...cli.args,'login',...(device?['--device-auth']:[]),'-c','cli_auth_credentials_store="file"'],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
          session.child=child;session.phase='waiting';publish(waiting(session));
          let diagnostic='';
          const readers=[child.stdout,child.stderr].map(input=>createInterface({input}));
          readers.forEach(reader=>reader.on('line',raw=>{
            const line=raw.replace(/\x1b\[[0-9;]*m/g,'');
            diagnostic=(diagnostic+'\n'+line).slice(-16000);
            if(session.cancelled||session.phase!=='waiting')return;
            if(device&&/^[A-Z0-9]{4}-[A-Z0-9]{5}$/.test(line.trim())){
              session.deviceCode=line.trim();publish({...waiting(session),browserError:publicState.browserError||null});
            }
            const url=loginUrl(line);
            if(!url||session.url)return;
            const expectedPath=device?'/codex/device':'/oauth/authorize';
            if(new URL(url).pathname!==expectedPath)return;
            session.url=url;publish(waiting(session));open().catch(()=>{});
          }));
          try{
            const code=await new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',resolveExit);});
            return {code,portBlocked:/os error (10013|10048)|address already in use/i.test(diagnostic)};
          }finally{readers.forEach(reader=>reader.close());session.child=null;}
        }
        let result=await attempt(false);
        // Windows may reserve 1455 even with no listener. Device auth needs no local callback.
        if(!session.cancelled&&result.code!==0&&result.portBlocked&&!session.url)result=await attempt(true);
        if (session.cancelled) return;
        if (result.code !== 0) throw new Error('login failed');
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
  return { start, cancel, open, state: () => publicState, busy: () => !!active };
}
module.exports = { createLogin, loginUrl, resolveCli };
