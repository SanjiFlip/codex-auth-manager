# 0.3.0 验证记录

验证环境：Windows，2026-09-12。所有账号写入测试均使用临时目录与合成凭据，没有切换或重启用户正在运行的 Codex。

| 验证项 | 结果与边界 |
| --- | --- |
| JavaScript 语法 | npm run check 通过 |
| 自动化测试 | npm test：17 / 17 通过；登录取消、并发拒绝、令牌不外泄、Pro 档位、额度窗口、统计口径、切换顺序、错误恢复 |
| 源码 Electron 集成 | scripts/smoke-electron.js 通过；真实 IPC、DPAPI、改名、删除、凭据替换、失败恢复；OS 进程适配使用替身；原生浮窗创建 / 加载 / 隐藏 / 置顶通过 |
| 浏览器 UI | scripts/ui-smoke.js 通过；添加与取消、搜索、模拟切换、隐私、统计、额度、诊断、活动记录、浮窗布局和按钮 |
| Windows 发现 | 识别到本机 Store Codex 的 AppID 与 ChatGPT.exe 路径；只读发现，没有停止真实进程 |
| 官方 CLI | 0.154.0；打包后的 Electron 可执行官方 JS CLI；空账户 app-server 返回预期未登录错误；退出与临时目录清理通过 |
| 打包 | electron-builder 生成 0.3.0 x64 NSIS 安装包与 win-unpacked；EXE 版本资源与紫色图标更新 |
| 包内真实启动 | scripts/packaged-smoke.js 启动构建的 EXE；通过真实 bridge 保存合成账号，验证独立库、Pro 5x、紫色样式、原生浮窗、置顶、未知额度和 auth 文件不被改写 |
| 包内 PowerShell | windows-codex.ps1 放入 app.asar.unpacked；修复不能直接执行 ASAR 内脚本的问题 |
| 报告过的闪退 | 隔离启动未复现。新增启动组件失败提示，不宣称已排除所有崩溃原因 |

## 仍未验证

- 真人完成浏览器授权、官方额度有登录状态时返回，以及网络 / 账号权限的实际结果。
- 实际运行中的 Codex 正常退出、切换后重启，并在 UI 中确认在线身份。
- 本次没有覆盖安装用户已安装的旧版本。使用新安装包更新才能看到新版。
- 打包产物未签名；electron-builder 的 signing 日志不代表拥有发行者证书。

## 检查中修复的问题

- PowerShell 帮助脚本原先在 ASAR 内，打包后无法作为外部脚本运行：改为 asarUnpack 并解析到外部路径。
- 官方子进程退出后临时文件短暂被锁：等待 close，清理采用有限重试。
- 官方套餐缓存可能覆盖凭据中已变化的套餐：身份套餐变化时清除旧官方快照。
- 原生浮窗创建后的首次 URL 为空：集成测试改为等待加载并设上限；并非将测试等待误报为程序崩溃。
- electron-builder 的旧版工具包含 macOS 符号链接，当前 Windows 不能解压：仅将下载包中的 Windows 工具解压到构建缓存，保留 EXE 图标与版本编辑。

## 截图

以下是本地验证产物路径，按忽略规则不提交到 GitHub；不代表仓库内提供这些图片。

- output/playwright/aurora-dashboard.png：演示主界面。
- output/playwright/aurora-statistics.png：演示统计页。
- output/playwright/aurora-meter.png：演示浮窗。
- output/playwright/packaged-main.png 与 packaged-meter.png：实际 EXE，合成账号隔离测试；没有演示额度填充。

## 0.3.1 增量验证（2026-09-12）

- npm test：18 / 18 通过，新增 Pro 5x / 20x 默认关闭、显式开启及其他套餐不受影响的测试。
- npm run check 通过；新版安装包和 EXE 0.3.1 已构建。
- 浏览器验证 Pro 开关、账号卡片、默认关闭时的浮窗、周额度仍显示；所有原有 UI 流程通过。
- 860 × 620 桌面小窗口下统计 / 额度 / 设置页面无横向溢出，检查明暗模式。
- 实际 EXE 在隔离凭据库启动通过；更新设置后，原生浮窗从「已关闭展示」变为「额度待获取」，再关闭；设置保存后读取为 true，当前 auth 内容未改变。
- 悬浮窗辅助文字改为 11–12px；主界面正文 14px，标签 12–13px；采用浅灰、白色和系统蓝配色，图标与原生标题栏同步。
- 真实账号授权、真实 Codex 切换验收边界与 0.3.0 相同；没有覆盖安装用户目录中的旧版。

## 0.3.2 悬浮窗验证（2026-09-12）

- npm run check 与 18 项单元测试通过。
- scripts/meter-smoke.js 验证：Pro 默认周额度主环且无五小时文本、无重复周卡；Plus 双窗口；刷新保留选择；取消不切换；确认后更新身份与额度；方向键 / Enter / Escape；明暗列表；360 × 560 下无内容溢出。
- 账号名称通过 textContent 写入，长名称省略并提供标题；列表设置最大高度与内部滚动。
- scripts/packaged-smoke.js 通过实际 0.3.2 EXE 验证：默认周主环、开启 Pro 五小时设置后切回双窗口，真实 IPC / DPAPI、原生浮窗和置顶可用。
- 未执行真实 Codex 重启；UI 切换验收使用演示账号，打包验证使用独立临时账号库。
- 截图：output/playwright/meter-weekly.png、meter-accounts.png、meter-plus.png、meter-dark-picker.png。

## 0.3.3 标记位置修复（2026-09-12）

- 主窗口从整页滚动改为 page-scroll 独立滚动；topbar 固定布局，原生桌面端预留 160px 窗口按钮区域。页面切换重置滚动，同页数据刷新不重置。
- scripts/chrome-smoke.js 验证 1340 × 920、860 × 620 的滚动状态：标题栏 top=0、滚动容器在标题栏之下、window.scrollY=0、右侧状态文字不进入原生控件区域。
- 悬浮窗 logo、顶部工具按钮和三个统计图标改为 SVG；统计图标底座 28 × 28、图形 18 × 18，检查中心对齐。
- 内部卡片与壳体改为不透明颜色，窗口外部仍保留透明圆角。原 CSS backdrop-filter 不会模糊 Windows 后方窗口文字，因此移除了依赖该效果的半透明壳体。
- 双额度模式增大图标后一度超出 4px，调小组件间距后 scripts/meter-smoke.js 无裁切检查通过。
- scripts/ui-smoke.js、scripts/meter-smoke.js、scripts/chrome-smoke.js 通过。
- 真实打包 EXE 0.3.3 通过隔离账户库启动检查，新增标题栏布局、原生标题栏颜色接口、三个 SVG 图标检查；保留 Pro 设置联动、加密与 IPC 检查。
- 构建新版安装包；没有覆盖安装用户目录里的旧版，也没有切换真实 Codex 账号。
- 截图：output/playwright/titlebar-scrolled.png、meter-icons.png；实际 EXE：packaged-main.png、packaged-meter.png。

## 0.3.4 自动刷新验证（2026-09-13）

- 使用合成账户启动真实 main / preload / 两个 renderer，先在旧版运行 scripts/realtime-smoke.js：新增 JSONL 用量后，两个窗口在 9 秒内没有更新，测试失败。
- 修复后同一复现通过：日志触发两窗口统计更新，手动官方刷新传给浮窗，随后更晚的本地额度覆盖旧官方快照；本地 Unix 秒恢复时间正常。
- 21 项单元测试通过，覆盖请求合并、自动补查间隔、失败退避、手动重试、额度窗口按观测时间选择；保留原有登录、切换回滚和用量口径测试。
- scripts/meter-smoke.js 验证待切换选择保留、取消 / 确认、键盘列表、明暗主题和布局无裁切。
- 自动官方补查使用合成服务替身验证；真实账号的服务端更新延迟仍未验收。发布 EXE 的隔离测试通过 PATH 中的合成 CLI 验证自动查询，不向真实服务发送测试凭据。

## 0.3.5 本地同步与隐藏查询验证（2026-09-13）

- 检查本机 Codex CLI 0.154.0 启动脚本：npm 包装层再 spawn 原生 CLI 时未设置 windowsHide；此前管理工具的隐藏参数只作用于包装层。
- 新解析器直接查找原生 EXE，去掉查询前的 PowerShell 查找和 Electron / Node 包装运行方式；本机实际安装解析到平台依赖内的 codex.exe。
- 25 项单元测试通过，包括 npm 原生路径、独立 EXE、空格路径、ARM64 vendor 布局、缺失原生包拒绝回退及查询隐藏参数。
- 打包测试采用模拟 npm 目录中的原生控制台测试程序，通过 Windows GetConsoleWindow / IsWindowVisible 检查控制台不可见；测试没有调用真实额度服务。
- 默认启动、日志事件、本地手动刷新与 10 秒定时补查均不调用官方服务；原生联动测试断言查询次数保持不变。打包测试先验证没有 CLI 调用，再主动点用官方查询路径验证隐藏控制台。
