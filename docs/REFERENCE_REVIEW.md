# 两个参考项目与合并方向

核查时间：2026-09-12。读取源码而非只依据 README。

| 参考 | 固定版本 | 发现 |
| --- | --- | --- |
| [GboyCode/CodexAuth](https://github.com/GboyCode/CodexAuth) | 0.1.16 / `c4bd89d0f9a28604f34ebd4ac319cb0051d13419` | Electron；本机加密、账号快照、本地额度统计、迁移和浮窗比较齐全。保存/导入/重新授权入口存在，但缺少完整的新账号官方登录流程。切换实现先写 auth，再重启，Windows 重启包含强制结束进程。 |
| [Mintimate/codex-auth-switch](https://github.com/Mintimate/codex-auth-switch) | 1.1.3 / `db8efb36dc49749c54962af5176788a54bfae24b` | Tauri/Rust；有 Device Code 添加账号。`manager.rs::switch_account` 校验与替换 auth，未包含 Codex 桌面端退出和重启流程。 |

两个项目技术栈不同，所以本次以第一个 MIT 项目作为实现基础，参考第二个的添加账号体验。没有拼接两套 Electron/Tauri 运行时，也没有复制第二个的 Rust OAuth 私有接口代码。

## 关键决策

- 添加账号通过本机官方 CLI `codex login`；官方工具负责 OAuth、回调和令牌生成。用户在浏览器交互授权。
- 使用每次登录独立的临时 CODEX_HOME，登录完成仅保存到账户库，切换是另一个明确操作。
- 改为先停止桌面端再写凭据，避免仍存活的进程回写旧状态。停止超时不继续。
- 目标凭据预校验、旧凭据备份、写入回读检查、进程启动检查分开处理；后两者不等于账户在线验证。
- 不在启动时自动更改全局 config.toml；用户在界面明确启用文件管理后才更新并备份。
- 使用独立品牌、账户目录和安装标识，保留上游许可证；不使用上游发布更新通道。

官方文档确认浏览器登录、CODEX_HOME 的文件凭据存储及 keyring 区别：[Authentication](https://learn.chatgpt.com/docs/auth)。桌面端强制重启不是该文档承诺的多账号 API，本项目采用本机兼容实现，真实效果仍需桌面端实际验收。
