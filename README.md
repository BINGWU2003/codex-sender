# Codex Sender

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)

在 Cursor 原生 Agent 输入框旁增加 `Codex` 按钮，把已经整理好的提示词快速交接到 Codex App。

Codex Sender 不是 VS Code/Cursor 扩展，也不会通过 `codex exec` 或非公开接口向任务写入消息。它复用 Cursor 原生复制能力保留 `@文件路径` 和代码行范围，通过本机 Bridge 打开 Codex App，再按用户选择完成复制、自动粘贴或自动粘贴并发送。

> [!WARNING]
> 这是一个早期实验性工具。它会备份并修改 Cursor 安装目录中的 `workbench.html` 和 checksum，并依赖 Cursor 未公开的 DOM。Cursor 更新可能覆盖注入，修改安装文件也可能触发完整性检查。

## 目录

- [功能与交接方式](#功能与交接方式)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [安装向导](#安装向导)
- [日常使用](#日常使用)
- [命令手册](#命令手册)
- [Bridge 生命周期](#bridge-生命周期)
- [升级](#升级)
- [故障排查](#故障排查)
- [卸载](#卸载)
- [数据与安全](#数据与安全)
- [本地开发与发布](#本地开发与发布)

## 功能与交接方式

Codex Sender 会在编辑器右侧 Agent 面板的模式选择器右侧注入 `Codex` 和 `⌄`：

- 点击 `Codex`：读取当前输入框并交接到 Codex App。
- 点击 `⌄`：选择历史任务、新建任务或切换交接方式。

| 交接方式 | 已绑定历史任务 | 新任务 | 是否自动按 Enter |
| --- | --- | --- | --- |
| 打开并复制（推荐） | 打开任务并复制提示词，由用户粘贴 | 通过 Deep Link 打开并预填 | 否 |
| 打开并自动粘贴（实验） | 使用 Windows UI Automation 粘贴 | 打开并预填 | 否 |
| 打开、自动粘贴并发送（实验） | 校验窗口、焦点和内容后发送 | 校验预填内容后发送 | 是 |

默认推荐“打开并复制”：

```text
在 Cursor 输入框整理提示词
        ↓
点击 Codex
        ↓
复用 Cursor 原生复制序列化器
        ↓
打开绑定的 Codex App 任务并写入剪贴板
        ↓
Ctrl+V → 检查 → Enter
```

当前工作区没有绑定任务时，工具使用官方 Deep Link：

```text
codex://threads/new?prompt=<encoded>&path=<absolute-path>
```

Codex App 会创建新任务并预填提示词。Deep Link 本身不会自动发送；只有显式选择“自动粘贴并发送”时，Codex Sender 才会尝试模拟 `Enter`。

自动粘贴不使用固定屏幕坐标，而是通过 Windows UI Automation 定位 Codex/ChatGPT App 的可访问输入框。如果输入框已有草稿、窗口或焦点不匹配、内容无法校验，工具会停止自动操作并保留剪贴板内容。

## 环境要求

- Windows 10/11。
- Cursor 桌面版。
- Codex App，并已完成登录。
- Node.js 20.12 或更高版本。
- 已安装并登录的 [Codex CLI](https://developers.openai.com/codex/cli/)。

Codex CLI 只用于运行 `codex app-server` 读取历史任务，不用于发送提示词。

Cursor 位于 `Program Files` 等受保护目录时，安装和卸载通常需要管理员终端。执行这些命令前必须完全退出所有 Cursor 窗口及后台 `Cursor.exe` 进程。

## 快速开始

推荐使用 npx，不安装全局 CLI。`install` 可以重复执行，每次都会重新注入当前版本、自动替换旧 Bridge，并在返回前验证版本一致。

### 1. 安装注入

完全退出 Cursor。在管理员 PowerShell 中执行：

```powershell
npx --yes @codex-sender/cli@latest install --no-startup --non-interactive --cursor-path "D:\Program Files\cursor\Cursor.exe"
```

如果 Cursor 安装在默认位置，可以省略路径：

```powershell
npx --yes @codex-sender/cli@latest install --no-startup --non-interactive
```

`--no-startup --non-interactive` 会确定性地跳过 Windows 登录启动项，但本次安装仍会自动启动当前版本 Bridge。安装器会：

1. 检查 Cursor 是否已完全退出。
2. 备份原始 `workbench.html` 和 `product.json`。
3. 写入注入脚本并更新 checksum。
4. 保存恢复清单、端口和本机随机令牌。
5. 通过本机随机令牌确认并停止旧 Bridge。
6. 启动当前 CLI 内置的 Bridge，并验证其版本和注入脚本一致。

### 2. 打开 Cursor 并验证

重新打开 Cursor，在编辑器右侧 Agent 面板输入框旁查看 `Codex` 按钮，然后运行：

```powershell
npx --yes @codex-sender/cli@latest doctor
```

正常结果应包含：

```json
{
  "ok": true,
  "htmlInjected": true,
  "injectionScriptPresent": true,
  "checksumMatches": true,
  "bridgeRunning": true,
  "bridgeVersionMatches": true,
  "problems": []
}
```

## 安装向导

直接运行 `install` 且终端支持交互时，会启动安装向导：

```powershell
npx --yes @codex-sender/cli@latest install
```

向导可以配置：

- Cursor 安装路径，可以填写 `Cursor.exe` 或 `resources/app` 目录。
- Bridge 监听端口，默认 `47321`。
- 是否注册 Windows 登录自启动。

Bridge 不再作为可选项：每次安装都会自动更新并立即启动当前版本。

使用方向键移动，按空格切换多选项，按回车确认，按 `Esc` 或 `Ctrl+C` 取消。取消不会修改 Cursor。

> [!IMPORTANT]
> 使用 npx 时不建议注册登录自启动，因为启动脚本会指向 npm 缓存中的 CLI 文件，缓存清理后可能失效。需要稳定登录自启动时再考虑全局安装。

可选的全局安装方式：

```powershell
npm install -g @codex-sender/cli
codex-sender install
```

全局安装后命令名仍然是 `codex-sender`。

## 日常使用

### 发送当前提示词

1. 在 Cursor Agent 输入框整理提示词和 `@文件` 引用。
2. 点击 `Codex`。
3. 工具让输入框获得焦点并调用 Cursor 原生 `Ctrl+A`、`Ctrl+C`。
4. 打开当前绑定的 Codex 任务；未绑定时创建新任务。
5. 根据选定模式手动粘贴、自动粘贴或自动发送。

读取完成后，工具会恢复原来的焦点、光标和选区。富文本包含文件节点但复制结果缺少 `@` 时会停止交接，不会静默发送丢失路径的文本。

### 选择历史任务

点击 `⌄` 后，会列出当前工作区相关的 Codex App、CLI 和 IDE 历史任务：

- 选择某个任务后，该任务会保存为当前工作区绑定。
- 选择“新建 Codex 任务”会解除绑定。
- 绑定按工作区路径保存，不同项目可以使用不同任务。
- 交接方式是全局设置，对所有工作区生效。

Codex Sender 只负责打开任务和交接提示词，不读取或渲染 Codex 回复。

## 命令手册

所有示例默认使用 npx。全局安装后，可以把：

```text
npx --yes @codex-sender/cli@latest
```

替换为：

```text
codex-sender
```

### 命令总览

| 命令 | 用途 | 是否需要退出 Cursor | 常用参数 |
| --- | --- | --- | --- |
| `install` | 安装、修复或升级注入，并自动更新 Bridge | 是 | `--cursor-path`、`--port`、`--no-startup`、`--non-interactive` |
| `doctor` | 检查注入、checksum、Bridge 状态与版本 | 否 | `--cursor-path` |
| `logs` | 查看结构化诊断日志 | 否 | `--lines` |
| `serve` | 在前台启动本机 Bridge | 否 | `--port` |
| `uninstall` | 恢复 Cursor 并删除登录启动项 | 是 | `--cursor-path` |
| `version` | 输出 CLI 版本 | 否 | 无 |

### install

语法：

```powershell
npx --yes @codex-sender/cli@latest install [--cursor-path PATH] [--port PORT] [--no-startup] [--non-interactive]
```

默认在交互式终端中打开安装向导。成功安装后，规范化的 Cursor 路径会保存到 `~/.codex-sender/installation.json`；再次执行时会优先预填并复用该路径，路径失效后才重新自动探测。使用 `--non-interactive` 时采用相同的路径优先级并直接执行。命令可重复运行，Cursor 更新、按钮消失或 Codex Sender 升级时都使用 `install`。

```powershell
# 交互式安装
npx --yes @codex-sender/cli@latest install

# 可重复的非交互式安装
npx --yes @codex-sender/cli@latest install --cursor-path "D:\Program Files\cursor\Cursor.exe" --port 47321 --no-startup --non-interactive
```

`--no-startup` 只控制 Windows 登录启动项，不会跳过本次 Bridge 更新和启动。不传该参数时，交互式向导可以决定是否注册登录启动；非交互模式默认注册。

### doctor

语法：

```powershell
npx --yes @codex-sender/cli@latest doctor [--cursor-path PATH]
```

检查内容包括：

- Cursor 版本与安装目录。
- `workbench.html` 是否包含注入标记。
- 注入脚本是否存在。
- Cursor checksum 是否匹配。
- Bridge 是否可访问。
- Bridge 版本是否与当前 CLI 一致。

存在问题时 `ok` 为 `false`，命令以非零状态退出，具体原因位于 `problems`。

### logs

语法：

```powershell
npx --yes @codex-sender/cli@latest logs [--lines COUNT]
```

默认输出最近 100 行，`COUNT` 必须是 `1-10000` 之间的整数：

```powershell
npx --yes @codex-sender/cli@latest logs --lines 200
```

### serve

语法：

```powershell
npx --yes @codex-sender/cli@latest serve [--port PORT]
```

Bridge 只监听 `127.0.0.1`。默认读取状态文件中保存的端口；指定 `--port` 会校验并保存新端口：

```powershell
npx --yes @codex-sender/cli@latest serve --port 47321
```

该命令在前台持续运行，按 `Ctrl+C` 停止。

### uninstall

语法：

```powershell
npx --yes @codex-sender/cli@latest uninstall [--cursor-path PATH]
```

执行前必须完全退出 Cursor。命令会从备份恢复 Cursor 文件、删除注入脚本、恢复原始 checksum，并移除 Codex Sender 登录启动项。

```powershell
npx --yes @codex-sender/cli@latest uninstall --cursor-path "D:\Program Files\cursor\Cursor.exe"
```

### version

```powershell
npx --yes @codex-sender/cli@latest version
npx --yes @codex-sender/cli@latest --version
```

### 参数参考

| 参数 | 命令 | 默认值与行为 |
| --- | --- | --- |
| `--cursor-path PATH` | `install`、`doctor`、`uninstall` | 自动发现失败或存在多个安装时，指定 `Cursor.exe` 或 `resources/app` |
| `--port PORT` | `install`、`serve` | 默认使用状态文件端口，首次为 `47321`；范围 `1-65535` |
| `--no-startup` | `install` | 不注册 Windows 登录启动；本次仍自动更新并启动 Bridge |
| `--non-interactive` | `install` | 跳过安装向导，直接执行 |
| `--lines COUNT` | `logs` | 默认 `100`；范围 `1-10000` |

### 权限参考

| 操作 | Cursor 必须退出 | 可能需要管理员终端 |
| --- | --- | --- |
| `install` | 是 | 是，Cursor 位于受保护目录时 |
| `uninstall` | 是 | 是，Cursor 位于受保护目录时 |
| `doctor` | 否 | 否 |
| `logs` | 否 | 否 |
| `serve` | 否 | 否 |

## Bridge 生命周期

Bridge 负责本机鉴权、任务列表、Deep Link、剪贴板和可选的 UI Automation。Cursor 中的注入脚本不能独立工作。

### 自动更新与启动

`install` 会先使用本机随机令牌验证端口上的旧 Bridge，再请求其正常退出；不支持关闭接口的旧版本会在确认身份后通过监听进程替换。随后安装器启动当前 Bridge，并等待健康检查返回同一版本后才成功退出。

因此正常安装和升级后不需要再手动运行 `serve`。

### 可选：前台运行

```powershell
npx --yes @codex-sender/cli@latest serve
```

- 适合调试或没有登录启动项时手动恢复 Bridge。
- 运行前需要先停止现有后台 Bridge，否则同一端口会报 `EADDRINUSE`。
- 保持终端开启即可使用。
- 按 `Ctrl+C` 停止。

### 可选：登录自启动

需要登录 Windows 后自动运行时，推荐先全局安装，再在安装向导中勾选“注册 Windows 登录自启动”：

```powershell
npm install -g @codex-sender/cli
codex-sender install
```

启动脚本位于：

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\codex-sender-bridge.cmd
```

### 检查端口占用

默认端口为 `47321`：

```powershell
$bridge = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 47321 -State Listen
Get-CimInstance Win32_Process -Filter "ProcessId = $($bridge.OwningProcess)" | Select-Object ProcessId, CommandLine
```

确认命令行属于 Codex Sender 后，才能停止对应进程：

```powershell
Stop-Process -Id $bridge.OwningProcess
```

不要直接停止未经确认的端口占用进程。

## 升级

升级时三部分必须使用同一版本：

```text
npx/CLI 版本 = Cursor 注入脚本版本 = Bridge 版本
```

现在只需重复执行 `install`。安装器会重新注入当前脚本、更新登录启动项设置、自动替换旧 Bridge，并验证版本一致：

```powershell
# Cursor 已完全退出；受保护目录使用管理员终端
npx --yes @codex-sender/cli@latest install --cursor-path "D:\Program Files\cursor\Cursor.exe" --no-startup --non-interactive

# 重新打开 Cursor 后验证
npx --yes @codex-sender/cli@latest doctor
```

如果需要复现某个版本，把 `@latest` 替换成固定版本。`install` 返回成功即代表 CLI、注入脚本和 Bridge 已使用同一版本。

版本不一致时，注入脚本会停止发送或打开会话列表，并提示：

```text
Bridge 版本 0.2.0 与注入脚本 0.2.1 不一致，请重启 Bridge 后重试
```

新版本安装器会自动处理该情况；完全退出 Cursor 后重新运行 `install` 即可。

## 故障排查

先执行：

```powershell
npx --yes @codex-sender/cli@latest doctor
npx --yes @codex-sender/cli@latest logs --lines 200
```

| 现象 | 常见原因 | 处理方式 |
| --- | --- | --- |
| Agent 输入框旁没有按钮 | Cursor 更新覆盖注入，或没有完全重启 | 退出 Cursor，重新执行 `install`，再打开 Cursor |
| `EPERM: operation not permitted` | Cursor 位于受保护目录 | 完全退出 Cursor，在管理员终端执行命令 |
| `Cursor 正在运行` | 仍有后台 `Cursor.exe` | 关闭全部窗口并在任务管理器确认进程退出 |
| `Bridge 未在 127.0.0.1:47321 运行` | `serve` 未启动或终端已关闭 | 运行 `npx --yes @codex-sender/cli@latest serve` |
| Bridge 或注入脚本版本不一致 | 使用了尚未支持自动替换的旧安装器 | 完全退出 Cursor，用最新版本重新执行 `install` |
| `EADDRINUSE` | 端口被无法通过令牌验证的其他服务占用 | 检查端口进程，停止确认无关的服务或为 `install` 指定新端口 |
| 会话列表为空 | Codex CLI 未安装、未登录，或没有对应工作区任务 | 验证 Codex CLI 登录状态并在 Codex App 创建任务 |
| 自动粘贴退回复制 | 输入框已有草稿、无法定位或校验失败 | 检查 Codex App 输入框，使用剪贴板手动粘贴 |
| `@文件` 变成普通文件名 | Cursor 原生复制没有返回富文本路径 | 保持 Cursor 在前台重试，并查看日志中的复制诊断 |
| Codex App 没有打开 | App 未安装或 `codex://` 协议未注册 | 启动并登录 Codex App，确认系统可以打开 Codex Deep Link |

日志默认不会记录完整提示词或令牌。如果仍无法定位问题，提交 Issue 时请附带：

- `doctor` 输出。
- 相关日志片段。
- Cursor、Codex Sender、Node.js 版本。
- 是否使用自定义 Cursor 路径或端口。

## 卸载

1. 在 Bridge 终端按 `Ctrl+C`。
2. 完全退出 Cursor。
3. 在需要时使用管理员终端执行：

```powershell
npx --yes @codex-sender/cli@latest uninstall --cursor-path "D:\Program Files\cursor\Cursor.exe"
```

卸载会恢复 Cursor 文件并移除登录启动项，但会保留状态、日志和备份目录，便于诊断。确认恢复成功后，如需彻底清理，可以手动删除：

```text
%USERPROFILE%\.codex-sender
```

删除该目录会同时删除工作区绑定、令牌、日志、恢复清单和备份，请只在成功卸载后执行。

## 数据与安全

```text
Cursor 原生 Agent 输入框
        ↓ 注入脚本读取文本
127.0.0.1 Bridge（随机令牌鉴权）
        ├─ CodexAppLauncher → 剪贴板 + codex:// Deep Link
        ├─ Windows UI Automation → 可选自动粘贴与发送
        ├─ AppServerClient → codex app-server → thread/list
        └─ StateStore → 绑定、交接方式、端口和随机令牌
```

- Bridge 只监听 `127.0.0.1`，每个请求都需要安装时生成的随机令牌。
- 提示词通过子进程标准输入传给 PowerShell，不拼接到 PowerShell 命令行。
- 新任务提示词按 Deep Link 规范编码；链接过长时退回剪贴板。
- 自动发送只在用户显式启用 `paste-and-send` 后执行。
- 状态、令牌、绑定、安装清单和备份位于 `~/.codex-sender`（Windows 上为 `%USERPROFILE%\.codex-sender`）。
- 日志位于 `~/.codex-sender/logs/codex-sender.log`，单文件 2 MiB，保留 3 个轮转文件。
- 从旧版本首次运行时，如果新目录尚不存在，会把 `%LOCALAPPDATA%\codex-sender` 整体迁移到新目录，保留令牌、绑定、备份和日志。
- 日志只记录长度、哈希、是否含 `@` 和富节点属性摘要，不记录完整提示词或令牌。
- 本机随机令牌不应提交到 Git、复制到日志或分享给他人。

Deep Link 行为参考 [Codex App Deep Links 官方文档](https://learn.chatgpt.com/docs/reference/commands#tasks)。

## 本地开发与发布

项目使用 pnpm workspace 和 Turborepo：

```text
packages/cli/                    npm CLI、Cursor 安装与恢复
packages/injector/               Cursor DOM 注入脚本生成器
packages/bridge/                 localhost API、Deep Link 和自动粘贴
packages/app-server-client/      Codex App Server JSONL 客户端
packages/core/                   共享状态类型与路径规范化
```

```powershell
pnpm install
pnpm run check
```

从源码试用：

```powershell
npm install -g ./packages/cli

# 完全退出 Cursor；受保护目录使用管理员终端
codex-sender install
```

测试使用临时 Cursor fixture，不会修改真实安装。详细设计参阅 [项目文档](./docs/project.md)。

项目使用 [Changesets](https://github.com/changesets/changesets) 管理 `@codex-sender/cli` 版本、CHANGELOG 和 npm 发布：

```powershell
pnpm changeset
```

功能和修复需要选择 `@codex-sender/cli` 并添加对应版本变更；仅文档、测试、CI 或私有内部包重构可以不添加 Changeset。合并版本 PR 后，GitHub Actions 会发布 npm、创建 Git tag 和 GitHub Release。

## 项目地址

- npm：[@codex-sender/cli](https://www.npmjs.com/package/@codex-sender/cli)
- GitHub：[BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)
- 问题反馈：[GitHub Issues](https://github.com/BINGWU2003/codex-sender/issues)

## 许可证

[MIT](./LICENSE.md) License © [BINGWU2003](https://github.com/BINGWU2003)
