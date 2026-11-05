# DSH 状态栏提醒（DSH Status Notifier）

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件包：把 Agent 的运行状态放到
macOS 菜单栏，不用切回 Harness 窗口就能看到「待批准的权限请求」和「刚完成的任务」。

## 菜单栏显示

| 显示 | 含义 |
| --- | --- |
| `⚠ 1`（橙） | 有权限请求正在等你批准 |
| `● 1`（蓝） | 有任务运行中 |
| `✓ 1`（绿） | 有任务在 30 分钟内完成 |
| `○ 空闲`（灰） | 空闲 |

点开图标是下拉列表，按状态分区列出对应会话；点任意条目（或「打开 DeepSeek Harness」）即可唤回窗口。每
5 秒自动刷新。

窗口隐藏/失焦时还会发送 macOS 系统通知；窗口关闭但 Host 仍在运行时会改用 `osascript` 通知。两条通知通道
互不重复（Host 只在没有页面连接时通知）。

## 工作原理

- **Host 半**（`index.js`，运行在 DSH Host 进程）：监听与审批顺序无关的持久信号 `session/event`
  （`approval/asked` / `approval/decided` 审计事件对）与 `agent/status` 运行↔空闲切换，渲染 SwiftBar 脚本与
  输出文件（状态文件放在插件目录**之外**，避免 SwiftBar 把它们当成插件加载）；无页面连接时用 `osascript`
  发通知。
- **Client 半**（`client.js`，运行在 Web GUI）：订阅框架自带的 `uiSession.sessionStatus`（running /
  pendingInteraction / completionUnread），窗口不在前台时发浏览器通知。

## 安装

1. 克隆仓库，或把目录复制到工作区；
2. 在 DSH 里安装该 bundle（Plugin Manager → 安装本地 bundle，或让 Agent 用 `plugin_manager`
   `install_bundle` 指向此目录）；
3. 让 SwiftBar 监听目录：新建 `~/.swiftbar` 并在 SwiftBar 偏好设置 → General → Plugin Folder 指向它；或
   把你现有的插件目录路径写入 `~/.dsh/swiftbar-dir.txt` 第一行；
4. 重启 DeepSeek Harness，几秒后菜单栏出现图标。

## 配置

| 变量 / 文件 | 用途 |
| --- | --- |
| `DSH_SWIFTBAR_DIR` | SwiftBar 插件目录（否则读 `~/.dsh/swiftbar-dir.txt`，再否则 `~/.swiftbar`） |
| `~/.dsh/swiftbar-dir.txt` | 第一行：插件目录路径 |
| `DSH_SWIFTBAR_STATE_DIR` | 渲染状态文件目录（默认 `~/.dsh/swiftbar-state`） |

## 开发

`test-render.mjs` 用桩 Context 跑 Host 半，模拟审批/运行/空闲事件，校验渲染结果与遗留文件清理：

```bash
node test-render.mjs
```

## 已知限制

- 菜单栏条目由 SwiftBar 脚本提供，SwiftBar 必须处于运行状态；
- 点击条目只会唤回窗口，暂不支持直接跳到某个会话。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
