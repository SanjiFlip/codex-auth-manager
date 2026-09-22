# 贡献说明

本项目面向 Windows 与 macOS Codex 桌面端。请通过 Issue 描述问题或建议；提交 PR 时说明具体问题、修改后的行为、验证结果与尚未验证的范围。

## 开发与验证

使用 Node.js 22 或更高版本，在仓库根目录运行：

```sh
npm ci
npm run check
npm test
```

根据修改范围运行相关检查：

| 修改范围 | 检查方式 |
| --- | --- |
| 界面 | `npm run demo`；检查主窗口与悬浮窗、明暗主题、长账号名称 |
| 账号切换、IPC、凭据存储 | `npx electron scripts/smoke-electron.js` |
| 蒸馏、记忆和知识库 | `npx electron scripts/knowledge-smoke.js` |
| Skills、场景分组与来源 | `npx electron scripts/skills-smoke.js --limited`；打包后加 `--packaged` |
| 蒸馏断点恢复 | `node scripts/resume-smoke.js`；打包后加 `--packaged` |
| 额度与本地刷新 | `npx electron scripts/realtime-smoke.js` |
| 窗口关闭与恢复 | `npx electron scripts/window-lifecycle-smoke.js` |
| Windows 安装包 | `npm run dist`，然后 `node scripts/packaged-smoke.js` |
| macOS 安装包（在 Mac 上） | `npm run dist:mac`，然后 `npx electron scripts/window-lifecycle-smoke.js --packaged`、`npx electron scripts/knowledge-smoke.js --packaged` 与 `node scripts/mac-packaged-smoke.js` |

集成脚本使用临时目录、合成凭据和必要的进程替身，不应改为使用个人账号。若环境设置了 `ELECTRON_RUN_AS_NODE`，运行 Electron 应用检查前应清除此变量。

[GitHub Actions](.github/workflows/ci.yml) 在 Windows 运行静态检查和单元测试，在 macOS arm64 / x64 运行单元、原生窗口、隔离账号、构建与打包应用检查。这些检查不代表完成真实用户浏览器授权或 Codex 在线身份验收。继承的 `scripts/validate-*.js` 不是当前全量验收入口。

## 提交与文档

- 保持改动聚焦，新增测试应覆盖实际行为与失败边界。
- 功能或行为变更更新 [README](README.md)、[更新日志](CHANGELOG.md) 和相关文档；验证结果记录到 [VALIDATION](docs/VALIDATION.md)。
- 发布时核对 package.json、界面版本、README 下载链接和 Release 标签；只有构建与校验完成的产物才能标为已发布。
- 安装包放在 GitHub Releases，不提交到 Git 源码目录；保留上游 MIT 版权和第三方来源说明。

## 敏感数据

禁止提交真实 auth.json、访问令牌、刷新令牌、账号库、加密迁移文件、原始日志、数据库、个人截图或签名证书。测试只使用明确标注的合成数据。提交前检查暂存区，不能仅依赖 .gitignore。

安全问题按 [安全说明](SECURITY.md) 处理。

界面改动还应运行 `npx electron scripts/design-smoke.js`，覆盖主页面、深浅主题、长列表和悬浮窗布局。性能对比可运行 `node scripts/performance-benchmark.js 55e95f0`；仅使用合成数据，不扫描个人会话。
