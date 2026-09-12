// The adapter owns OS and storage operations; this function owns their order.
async function runSwitch(adapter, report = () => {}) {
  report({ phase: 'checking', message: '正在检查目标账号与 Codex 启动位置' });
  const target = await adapter.preflight();
  report({ phase: 'closing', message: '正在关闭 Codex，等待进程完全退出' });
  await adapter.stop(target);
  let snapshot;
  try {
    report({ phase: 'saving', message: '正在保存当前账号的最新登录状态' });
    snapshot = await adapter.capture();
    report({ phase: 'writing', message: '正在写入目标账号凭据' });
    await adapter.apply(target);
    report({ phase: 'starting', message: '正在启动 Codex 并检查进程' });
    await adapter.launch(target);
    report({ phase: 'restarted', message: 'Codex 已重启，请在账号菜单核对登录身份' });
    return { phase: 'restarted', identityVerified: false };
  } catch (error) {
    if (snapshot !== undefined) {
      try {
        // A failed launch may still have created a process. Stop it before rollback.
        await adapter.stop(target);
        await adapter.rollback(snapshot);
      } catch {
        throw new Error('切换未完成，自动恢复也未完成。请关闭 Codex 后检查本地加密备份；不要重复切换。');
      }
      throw new Error('切换未完成，已恢复原凭据。Codex 保持关闭，可重新启动后检查。');
    }
    throw new Error('切换未完成：无法保存原登录状态。原凭据未替换，Codex 已关闭。');
  }
}
module.exports = { runSwitch };
