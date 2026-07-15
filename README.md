# Codex Sender

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)

在 Cursor 原生 Agent 输入框旁增加一个 `Codex` 按钮，把已经整理好的提示词快速交接到 Codex App。

Codex Sender 不执行提示词，也不是 VS Code/Cursor 扩展。它读取 Cursor 当前输入框，打开对应的 Codex App 任务，并通过“剪贴板”或“自动粘贴”完成跨应用交接。这样既能复用 Cursor 的提示词编辑体验，也不会出现 `codex exec` 已写入任务、但已打开的 Codex App 无法实时刷新的问题。

> [!WARNING]
> 这是一个早期实验性工具。它会备份并修改 Cursor 安装目录中的 `workbench.html`，且依赖 Cursor 未公开的 DOM。Cursor 更新可能覆盖或破坏注入；修改安装文件也可能触发完整性检查。

> [!NOTE]
> 当前 `0.1.0` 尚未发布到 npm registry。发布前请按“从源码试用”安装。

## 使用体验

默认的安全流程：

```text
在 Cursor 输入框整理提示词
        ↓
点击 Codex
        ↓
读取当前输入框（不需要 Ctrl+C）
        ↓
打开绑定的 Codex App 任务，并复制提示词
        ↓
Ctrl+V → 检查 → Enter
```

如果当前工作区未绑定任务，会使用官方 Deep Link：

```text
codex://threads/new?prompt=<encoded>&path=<absolute-path>
```

Codex App 会创建新任务并预填提示词，此时通常只需检查后按 `Enter`。官方 Deep Link 只负责打开和预填，不会自动发送。

点击 `Codex` 旁的 `⌄` 可以：

- 选择同一工作区的 Codex 历史任务并保存为当前绑定。
- 选择“新建 Codex 任务”解除绑定。
- 切换“打开并复制（推荐）”和“打开并自动粘贴（实验）”。

自动粘贴使用 Windows UI Automation 查找 Codex App 的可访问输入框，不使用固定坐标，也不会自动按 `Enter`。如果输入框已有草稿、无法定位或无法校验粘贴内容，会保留剪贴板内容并退回手动 `Ctrl+V`。

## 当前能力

- 在编辑器右侧 Agent 面板的原生输入框发送按钮旁注入 `Codex` 和 `⌄`。
- 复用 Cursor 原生复制序列化器读取输入框，不要求手动复制，并保留 `@文件路径` 与 `(起始行-结束行)`。
- 通过 `codex://threads/<thread-id>` 打开已绑定的 Codex App 历史任务。
- 通过 `codex://threads/new` 新建任务，并在链接长度允许时预填提示词和项目路径。
- 通过 Codex App Server 列出当前工作区的 App、CLI、IDE 等历史任务。
- 按工作区保存任务绑定，并全局保存提示词交接方式。
- 自动备份、校验、诊断、修复和卸载 Cursor 注入。

Codex Sender 不读取或渲染 Codex 回复，也不会通过 CLI 代替 Codex App 执行任务。

## 使用前提

- Windows 10/11。
- Cursor 桌面版。
- Codex App，并已完成登录。
- Node.js 20.12 或更高版本。
- 已安装并登录的 [Codex CLI](https://developers.openai.com/codex/cli/)；目前只用 `codex app-server` 读取历史任务，不用 `codex exec` 发送提示词。

Cursor 位于 `Program Files` 等受保护目录时，安装、修复或卸载通常需要管理员终端。

## 发布后运行

完全退出 Cursor，包括所有后台 `Cursor.exe` 进程。可以选择使用 `npx` 免安装运行，或者全局安装后运行。

`install` 默认启动交互式向导，可以编辑 Cursor 路径和 Bridge 端口，并通过空格勾选登录自启动、安装后立即启动等选项；按回车确认，按 `Esc` 或 `Ctrl+C` 取消且不会修改 Cursor。

### 使用 npx

适合临时试用、诊断或不希望全局安装 CLI 的场景：

```powershell
npx --yes codex-sender@latest install --no-startup
npx --yes codex-sender@latest serve
```

`serve` 会在前台运行 Bridge，关闭终端后 Bridge 也会停止。由于 `npx` 的包路径位于 npm 缓存中，可能被缓存清理，长期使用和 Windows 登录自启动推荐采用全局安装。

### 全局安装

适合日常使用以及配置 Bridge 登录自启动：

```powershell
npm install -g codex-sender
codex-sender install
```

安装器会备份 Cursor 文件、注入脚本、更新 checksum、注册本机 Bridge 的 Windows 登录启动脚本，并立即在后台启动 Bridge。找不到 Cursor 时可显式指定路径：

```powershell
codex-sender install --cursor-path "D:\Program Files\Cursor\Cursor.exe"

# npx 免安装方式
npx --yes codex-sender@latest install --cursor-path "D:\Program Files\Cursor\Cursor.exe" --no-startup
```

## 从源码试用

```powershell
pnpm install
pnpm run check
npm install -g ./packages/cli

# 完全退出 Cursor 后执行；受保护目录请使用管理员终端
codex-sender install
```

重新打开 Cursor，在编辑器右侧 Agent 面板中即可看到按钮。

## 命令说明

以下命令既可以使用全局安装后的 `codex-sender`，也可以将命令前缀替换为 `npx --yes codex-sender@latest`：

| 命令 | 作用 | 可用参数 |
| --- | --- | --- |
| `codex-sender install` | 启动交互式向导，确认后备份并注入 Cursor | `--cursor-path PATH`、`--port PORT`、`--no-startup`、`--non-interactive` |
| `codex-sender repair` | Cursor 更新、按钮消失或注入损坏后重新注入当前版本 | `--cursor-path PATH`、`--port PORT`、`--no-startup` |
| `codex-sender doctor` | 检查 Cursor 版本、HTML 注入、脚本文件和 checksum | `--cursor-path PATH` |
| `codex-sender logs` | 查看最近的结构化诊断日志，默认显示 100 行 | `--lines COUNT` |
| `codex-sender serve` | 在前台启动 localhost Bridge，适合 npx 使用或排错 | `--port PORT` |
| `codex-sender uninstall` | 恢复 Cursor 文件、移除注入并删除 Bridge 登录启动项 | 无 |
| `codex-sender version` | 显示当前 CLI 版本 | 无 |

例如：

```powershell
# 检查安装状态
npx --yes codex-sender@latest doctor

# 查看最近 200 行日志
npx --yes codex-sender@latest logs --lines 200

# Cursor 更新后重新注入；执行前必须完全退出 Cursor
npx --yes codex-sender@latest repair --cursor-path "D:\Program Files\Cursor\Cursor.exe" --no-startup

# 恢复 Cursor 原文件并移除 Codex Sender
npx --yes codex-sender@latest uninstall
```

安装、修复和卸载前必须完全退出 Cursor。如果不想注册登录启动项：

```powershell
codex-sender install --no-startup
codex-sender serve
```

参数含义：

- `--cursor-path PATH`：显式指定 `Cursor.exe`，自动发现失败或安装在自定义目录时使用。
- `--port PORT`：指定 Bridge 监听端口，默认使用状态文件中保存的端口。
- `--no-startup`：不注册 Windows 登录启动项；`install` 时会移除已有的 Codex Sender 启动项。
- `--non-interactive`：跳过 `install` 安装向导，直接使用参数和默认值，适合脚本或 CI。
- `--lines COUNT`：指定 `logs` 输出的最近日志行数。

## 工作原理与安全边界

```text
Cursor 原生 Agent 输入框
        ↓ 注入脚本读取文本
127.0.0.1 Bridge（随机令牌鉴权）
        ├─ CodexAppLauncher → 剪贴板 + codex:// Deep Link
        ├─ Windows UI Automation → 可选的受保护自动粘贴
        ├─ AppServerClient → codex app-server → thread/list
        └─ StateStore → 工作区绑定、交接方式、端口和随机令牌
```

- Bridge 只监听 `127.0.0.1`，每个请求都需要安装时生成的随机令牌。
- 提示词通过子进程标准输入传给 PowerShell，不拼进 PowerShell 命令行。
- 注入端先把焦点交还 Cursor 输入框，再由本机 Bridge 在确认前台窗口和键盘焦点属于 Cursor 后发送原生 `Ctrl+A`、`Ctrl+C`，因此会调用与用户手动复制相同的 Lexical 序列化器；读取完成后恢复原来的光标和选区。Bridge 不模拟 `Enter`。富文本结果缺少 `@` 时会停止交接，不会静默退化成丢失路径的文件名。
- 新任务的提示词会按官方规范进行 URL 编码；链接过长时退回剪贴板方式。
- 自动粘贴只接受 Codex/ChatGPT App 进程中的可访问输入框，遇到已有草稿会停止。
- 工具不会自动按 `Enter`，最终发送动作由用户确认。
- 状态、令牌、绑定和备份位于 `%LOCALAPPDATA%\codex-sender`。
- 诊断日志位于 `%LOCALAPPDATA%\codex-sender\logs\codex-sender.log`，单文件 2 MiB、保留 3 个轮转文件。日志只记录长度、哈希、是否含 `@` 和富节点属性摘要，不记录完整提示词或令牌。
- 令牌是本机凭据，不应提交到 Git、复制到日志或分享给他人。

Deep Link 行为参考 [Codex App Deep Links 官方文档](https://learn.chatgpt.com/docs/reference/commands#tasks)。

## Cursor 更新后的处理

Cursor 更新通常会替换 `resources/app`。按钮消失或 `doctor` 报错时，完全退出 Cursor 后运行：

```powershell
codex-sender repair
codex-sender doctor
```

## 本地开发

项目使用 pnpm workspace 和 Turborepo：

```text
packages/cli/                    npm CLI、Cursor 安装与恢复
packages/injector/               Cursor DOM 注入脚本生成器
packages/bridge/                 localhost API、App Deep Link 和自动粘贴
packages/app-server-client/      Codex App Server JSONL 客户端
packages/core/                   共享状态类型与路径规范化
```

```powershell
pnpm install
pnpm run check
```

测试使用临时 Cursor fixture，不会修改真实安装。详细设计参阅 [项目文档](./docs/project.md)。

## 项目地址

- GitHub：[BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)
- 问题反馈：[GitHub Issues](https://github.com/BINGWU2003/codex-sender/issues)

## 许可证

[MIT](./LICENSE.md) License © [BINGWU2003](https://github.com/BINGWU2003)
