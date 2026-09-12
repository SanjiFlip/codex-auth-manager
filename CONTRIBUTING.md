# 贡献说明

本项目主要面向 Windows Codex 桌面端。提交前请说明具体问题、修改后的行为和验证结果。

1. 使用 Node.js 22 或更高版本，执行 `npm ci`。
2. 执行 `npm run check` 和 `npm test`。
3. UI 修改通过 `npm run demo` 检查主窗口和悬浮窗的明暗主题、小窗口和长账号名称。
4. Windows 集成验证：`node_modules/.bin/electron.cmd scripts/smoke-electron.js`。此脚本使用临时目录、合成凭据和进程替身，不应改为使用个人账号。
5. 打包验证：`npm run dist` 后执行 `node scripts/packaged-smoke.js`。

禁止提交真实 auth.json、访问令牌、刷新令牌、账号库、加密迁移文件、日志、数据库、个人截图或签名证书。测试只使用明确标注的合成数据。请保留上游 MIT 版权和第三方来源说明。

GitHub Actions 仅运行静态检查和单元测试，不代表完成真实账号授权、Windows 安装或 Codex 重启验收。`scripts/validate-*.js` 等继承脚本不是本版全量验收入口；以 README 中列出的检查为准。
