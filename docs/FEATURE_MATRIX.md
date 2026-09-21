# 功能对照与落地范围

当前版本：v0.4.1；核对日期：2026-09-21。上游固定提交见 REFERENCE_REVIEW.md。以下区分源码实现与真实账号验收。

| 能力 | 参考来源 | 本版落地 |
| --- | --- | --- |
| 本机凭据加密与账号库 | GboyCode：DPAPI、快照、索引恢复 | 继承加密与恢复基础，改用独立目录；Windows DPAPI / macOS Keychain + 合成账号已验证 |
| 添加新账号 | Mintimate：Device Code 授权 | 使用官方 CLI 浏览器 OAuth，回调端口不可用时支持设备码登录；独立临时目录；取消、保存与清理已测试，真人完整授权待验收 |
| 切换立即生效 | GboyCode 有重启，Mintimate switch_account 只替换文件 | 重写顺序为退出完成后写入、回读、启动；正常退出超时不继续；真实 Codex 重启未执行 |
| 防止旧进程覆盖凭据 | 两项目保存轮换后的凭据 | 退出后保存当前最新令牌，暂停切换期间的自动同步；失败注入验证回滚 |
| 官方套餐与额度 | Mintimate 订阅额度页 | 使用官方 app-server account/read 与 account/rateLimits/read；单账号与批量刷新 |
| Pro 档位 | 用户明确要求；官方协议枚举 | pro → Pro 20x；prolite → Pro 5x；未知类型不猜档位 |
| 本地用量 | 两项目都有统计 | 今日、近 7 天、模型分布、Token 构成与每日明细；沿用本地日志解析 |
| 独立悬浮窗 | GboyCode 原生浮窗；用户图片 | 重做浅灰玻璃主题、额度环、重置 / 今日 Tokens / 会话、切换、置顶、刷新和明暗切换 |
| 搜索、筛选、隐私、主题 | 两项目 UI 与 Mintimate 偏好设置 | 主窗口全部接通；浏览器演示交互验证 |
| 加密导入导出 | GboyCode portable-credentials | 保留迁移密码文件方式，不使用明文剪贴板共享 |
| 环境体检 | 两项目本机诊断 | 版本、凭据、同步、数据库与会话文件检查 |
| EXE / macOS 应用与界面一致 | 用户要求 | 打包使用相同 manager / meter 页面；独立系统蓝图标、版本资源；Windows 与 macOS 两种架构包内启动已验证 |

本版未提供 Mintimate 的二维码迁移、完整模型参数配置中心、30 天 / 年度热力图、双语及签名更新，也未保留 GboyCode 所有旧页面入口。没有将这些列为已完成能力。重置次数仅展示，不消耗重置权益。

## 数据口径

- 订阅额度属于账号级官方快照或本地已记录快照，展示更新时间；网络失败保留旧值。自动同步只读本地，官方查询需主动触发。v0.4.1 阻止同周期本地异常 0 值或不完整记录覆盖有效额度，新周期重置仍正常显示。
- 主界面与悬浮窗的 Tokens / 会话均为本机统计，可能包含多个账号的会话，界面明确标注「本机」。
- 无官方额度或未加载统计显示未知；成功读取后没有记录的日子为 0。
- 缓存输入和推理输出是子项，不重复叠加到 total_tokens。

## 源码索引

- 登录：src/official-login.js；官方账号查询：src/official-account.js。
- 切换状态与回滚：src/switch-lifecycle.js；Windows 进程适配：src/windows-codex.js / .ps1；macOS：src/mac-codex.js。
- 主界面：src/ui/manager.html / manager.js / aurora.css。
- 悬浮窗：src/ui/meter.html / meter.js / meter.css。
- 统计显示：src/ui/statistics.js；日志聚合：src/quota 与 src/main.js。

## 0.3.1 补充

全局保存 proFiveHourEnabled，默认 false，仅作用于 pro/prolite。启用后显示真实快照，无快照时仍为未知；设置变更通过 IPC 广播到原生浮窗。本次同时加大主界面与浮窗字号，按用户要求改为苹果应用风格的中性色与系统蓝。

## 0.3.2 悬浮窗

关闭 Pro 五小时展示时，周额度与恢复时间移至主圆环，并移除第二张周额度卡。自定义账号列表替换原生 select，区分当前账号与待切换选择；刷新保留选择，确认框固定目标账号，成功后显示新账号，失败保留选择供重试。原生高度为 560，保持 360 宽度。
