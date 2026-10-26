# Antigravity 账号管理

左侧「Codex」和「Antigravity」分别管理两种应用的账号。Antigravity 页面支持添加引导、保存当前登录、搜索、重命名、移除、切换并重启、历史备份恢复和中断恢复，跟随主窗口明暗主题及邮箱隐私设置。

目前仅支持 Windows 新版 Antigravity 桌面应用的凭据格式，凭据适配基线为 2.18.1；本次已只读核对本机 2.26.0 的安装结构，未执行真实账号在线切换。macOS 显示暂不支持。不能用于原来的 Antigravity IDE 配置目录切换，也不提供 Google 额度查询或自动轮换。

1. 在 Antigravity 中正常登录，点击「保存当前账号」。登录其他账号后重复保存。
2. 保存工作，选择「切换并重启」，核对确认窗口。程序依次检查目标、退出应用、保存当前账号的最新凭据、替换并回读检查、启动应用，页面显示各阶段进度。后台未退出时可自行退出后重试，或经二次确认结束目标安装目录中的后台进程；共享凭据的其他 CLI 仍需自行退出。
3. 每次替换前自动加密备份，恢复记录保留到启动检查完成。写入或启动失败时先确认应用退出，再恢复原凭据；无法安全恢复时保留中断记录并显示恢复入口。历史备份恢复前需要完全退出应用与相关 CLI。
4. 自定义安装可点击「安装位置」，填写 Antigravity.exe 完整路径。

重新进入页面、窗口重新获得焦点及可见时的定时刷新会更新外部登录状态。操作失败后重新读取账号库与中断记录；读取失败时停止使用旧缓存提供账号操作。组件超时会停止并提示刷新及恢复。

账号库沿用 `%LOCALAPPDATA%\AntigravityAccountSwitcher`，原独立切换器保存的账号可直接使用。Windows DPAPI 绑定当前系统用户，不适合直接跨设备复制。两个切换器共用互斥锁，使用本页面前请关闭旧版独立切换器。移除只归档已保存快照，不退出当前登录。

原生组件只操作 `gemini:antigravity` 凭据，不复制聊天或配置目录。渲染界面只能收到账号名称、邮箱、时间和状态，不能获取令牌。没有登录有效性的在线检查，切换后仍需在 Antigravity 核对身份。

## 构建和验证

`npm start` 与 Windows electron-builder 打包会编译 `src/antigravity/*.cs`，使用系统 .NET Framework 4.x 编译器。生成的组件随应用解包至 `app.asar.unpacked`，运行时无需编译。源码保留原切换器的加密、备份及恢复实现和 MIT 许可。

本地验证入口：

- `npm run build:native`
- `src\antigravity\AntigravityBridge.exe --self-test output\antigravity\self-test.json`
- `node --test tests/antigravity.test.js`
- `electron scripts/antigravity-smoke.js`
- `electron scripts/antigravity-smoke.js --packaged output/account-switch-fix`（参数为构建输出目录；省略目录时使用 `output/antigravity-build`）

原生测试覆盖 DPAPI、隔离 Windows 凭据目标、更新快照、启动失败回滚、恢复、进程归属和路径保护；界面测试以模拟服务验证实际 IPC、进度、二次确认、重复提交保护、失败后恢复入口、取消、HTML 转义、明暗主题及窄窗口布局。未执行真实账号在线切换。
