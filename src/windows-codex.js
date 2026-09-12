const { execFile } = require('node:child_process');
const path = require('node:path');
function run(mode, launcher) {
  if (process.platform !== 'win32') return Promise.reject(new Error('第一版仅支持 Windows Codex 桌面端。'));
  return new Promise((resolve, reject) => {
    const script=path.join(__dirname, 'windows-codex.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode], {
      windowsHide: true, timeout: 45000, maxBuffer: 1024 * 128,
      env: { ...process.env, CAM_LAUNCH_INFO: JSON.stringify(launcher || {}) },
    }, (error, stdout) => {
      if (error) return reject(new Error(mode === 'stop' ? 'Codex 未完全退出。请保存任务并完全退出 Codex 后重试；凭据尚未在此步骤改写。' : mode === 'discover' ? '未找到受支持的 Windows Codex 桌面安装。请启动一次 Codex 后重试。' : '未能确认 Codex 启动成功。'));
      try { resolve(mode === 'discover' ? JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) : undefined); }
      catch { reject(new Error('无法识别 Codex 安装信息。')); }
    });
  });
}
module.exports = { discover: () => run('discover'), stop: () => run('stop'), launch: info => run('launch', info) };
