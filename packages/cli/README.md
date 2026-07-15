# @codex-sender/cli

在 Cursor 原生 Agent 输入框旁注入 `Codex` 按钮，把已经整理好的提示词快速交接到 Codex App。

Codex Sender 不是 VS Code/Cursor 扩展，也不使用 `codex exec` 发送消息。它复用 Cursor 原生复制能力保留 `@文件路径` 和代码行范围，通过本机 Bridge 打开 Codex App，并按用户选择完成复制、自动粘贴或自动粘贴并发送。

> [!WARNING]
> 本工具会备份并修改 Cursor 安装目录中的 `workbench.html` 和 checksum，并依赖 Cursor 未公开的 DOM。当前仅支持 Windows。安装、修复和卸载前必须完全退出 Cursor。

## 环境要求

- Windows 10/11。
- Node.js 20.12 或更高版本。
- Cursor 桌面版。
- 已安装并登录的 Codex App。
- 已安装并登录的 [Codex CLI](https://developers.openai.com/codex/cli/)。

Codex CLI 只用于运行 `codex app-server` 读取历史任务，不用于发送提示词。

Cursor 位于 `Program Files` 等受保护目录时，安装、修复和卸载通常需要管理员终端。

## 快速开始

推荐通过 npx 运行，并在前台启动 Bridge。

### 1. 完全退出 Cursor 并安装

在管理员 PowerShell 中执行：

```powershell
npx --yes @codex-sender/cli@latest install --no-startup --non-interactive --cursor-path "D:\Program Files\cursor\Cursor.exe"
```

Cursor 位于默认路径时可以省略 `--cursor-path`：

```powershell
npx --yes @codex-sender/cli@latest install --no-startup --non-interactive
```

### 2. 启动 Bridge

在普通 PowerShell 中运行，并保持终端开启：

```powershell
npx --yes @codex-sender/cli@latest serve
```

按 `Ctrl+C` 可以停止 Bridge。

### 3. 打开 Cursor 并检查

重新打开 Cursor，在编辑器右侧 Agent 面板输入框旁查看 `Codex` 按钮：

```powershell
npx --yes @codex-sender/cli@latest doctor
```

正常输出应满足：

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

## 交互式安装向导

不带 `--non-interactive` 时，`install` 默认启动交互式向导：

```powershell
npx --yes @codex-sender/cli@latest install
```

向导支持：

- 输入或修改 Cursor 路径。
- 修改 Bridge 监听端口。
- 使用空格选择 Windows 登录自启动。
- 使用空格选择安装后立即启动 Bridge。
- 按回车确认，按 `Esc` 或 `Ctrl+C` 取消。

使用 npx 时建议取消登录自启动，因为启动脚本会引用 npm 缓存中的 CLI 文件，缓存清理后可能失效。

如需稳定的 Windows 登录自启动，可以选择全局安装：

```powershell
npm install -g @codex-sender/cli
codex-sender install
```

全局安装后的命令名仍然是 `codex-sender`。

## Cursor 中的使用方法

重新打开 Cursor 后：

- 点击 `Codex`：读取当前输入框并交接到 Codex App。
- 点击 `⌄`：选择历史任务、新建任务或切换交接方式。
- 未绑定历史任务时，通过官方 `codex://threads/new` Deep Link 创建新任务。

| 模式 | 行为 | 自动发送 |
| --- | --- | --- |
| 打开并复制（推荐） | 打开任务并写入剪贴板，由用户检查后粘贴 | 否 |
| 打开并自动粘贴（实验） | 通过 Windows UI Automation 定位并粘贴 | 否 |
| 打开、自动粘贴并发送（实验） | 校验窗口、焦点和内容后模拟 Enter | 是 |

如果输入框已有草稿、无法定位或无法校验内容，自动粘贴会停止并保留剪贴板内容。

历史任务绑定按工作区路径保存；交接方式是全局设置。Codex Sender 不读取或渲染 Codex 回复。

## 命令总览

所有 `codex-sender ...` 命令都可以替换为：

```text
npx --yes @codex-sender/cli@latest ...
```

| 命令 | 用途 | Cursor 必须退出 | 参数 |
| --- | --- | --- | --- |
| `install` | 首次备份并注入 Cursor | 是 | `--cursor-path`、`--port`、`--no-startup`、`--non-interactive` |
| `repair` | 更新或修复 Cursor 注入 | 是 | `--cursor-path`、`--port`、`--no-startup` |
| `doctor` | 检查注入、checksum、Bridge 和版本 | 否 | `--cursor-path` |
| `logs` | 查看结构化诊断日志 | 否 | `--lines` |
| `serve` | 在前台运行 localhost Bridge | 否 | `--port` |
| `uninstall` | 恢复 Cursor 并删除登录启动项 | 是 | `--cursor-path` |
| `version` | 显示 CLI 版本 | 否 | 无 |

## 命令与参数

### install

```powershell
npx --yes @codex-sender/cli@latest install [--cursor-path PATH] [--port PORT] [--no-startup] [--non-interactive]
```

安装器会检查 Cursor 进程、备份原文件、写入注入脚本、更新 checksum，并保存恢复清单和本机随机令牌。

```powershell
# 交互式安装
npx --yes @codex-sender/cli@latest install

# 非交互式安装，不注册或后台启动 Bridge
npx --yes @codex-sender/cli@latest install --cursor-path "D:\Program Files\cursor\Cursor.exe" --port 47321 --no-startup --non-interactive
```

交互模式下，`--no-startup` 只会让登录自启动和立即启动默认不选中，用户仍可在向导中重新选择。非交互模式下，它会同时禁用登录启动和安装后的后台启动。

### repair

```powershell
npx --yes @codex-sender/cli@latest repair [--cursor-path PATH] [--port PORT] [--no-startup]
```

Cursor 更新、按钮消失、checksum 异常或 Codex Sender 升级后使用。执行前必须完全退出 Cursor：

```powershell
npx --yes @codex-sender/cli@latest repair --cursor-path "D:\Program Files\cursor\Cursor.exe" --no-startup
```

不传 `--no-startup` 时会更新登录启动脚本并尝试后台启动 Bridge。传入后不会注册或启动 Bridge，但不会主动删除以前存在的启动项。

### doctor

```powershell
npx --yes @codex-sender/cli@latest doctor [--cursor-path PATH]
```

检查 Cursor 安装、HTML 注入、注入脚本、checksum、Bridge 可达性及 Bridge 与当前 CLI 的版本是否一致。存在问题时 `ok` 为 `false`、原因写入 `problems`，命令以非零状态退出。

### logs

```powershell
npx --yes @codex-sender/cli@latest logs [--lines COUNT]
```

默认输出最近 100 行，`COUNT` 范围为 `1-10000`：

```powershell
npx --yes @codex-sender/cli@latest logs --lines 200
```

### serve

```powershell
npx --yes @codex-sender/cli@latest serve [--port PORT]
```

Bridge 只监听 `127.0.0.1`。默认使用状态文件中的端口，首次为 `47321`；传入 `--port` 会保存新端口。

```powershell
npx --yes @codex-sender/cli@latest serve --port 47321
```

`serve` 持续在前台运行，按 `Ctrl+C` 停止。

### uninstall

```powershell
npx --yes @codex-sender/cli@latest uninstall [--cursor-path PATH]
```

执行前必须停止 Bridge 并完全退出 Cursor：

```powershell
npx --yes @codex-sender/cli@latest uninstall --cursor-path "D:\Program Files\cursor\Cursor.exe"
```

命令会恢复备份、删除注入脚本、恢复 checksum，并移除 Codex Sender 登录启动项。

### version

```powershell
npx --yes @codex-sender/cli@latest version
npx --yes @codex-sender/cli@latest --version
```

### 参数参考

| 参数 | 适用命令 | 说明 |
| --- | --- | --- |
| `--cursor-path PATH` | `install`、`repair`、`doctor`、`uninstall` | 指定 `Cursor.exe` 或 `resources/app` 目录 |
| `--port PORT` | `install`、`repair`、`serve` | Bridge 端口，范围 `1-65535`，首次默认 `47321` |
| `--no-startup` | `install`、`repair` | 不注册或更新登录启动；非交互安装时也不后台启动 |
| `--non-interactive` | `install` | 跳过安装向导 |
| `--lines COUNT` | `logs` | 日志行数，默认 `100`，范围 `1-10000` |

## Bridge 生命周期

推荐在前台运行：

```powershell
npx --yes @codex-sender/cli@latest serve
```

- 保持终端开启即可使用。
- 按 `Ctrl+C` 停止。
- 升级前先停止旧 Bridge。
- 不要同时启动多个使用同一端口的 Bridge。

检查默认端口进程：

```powershell
$bridge = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 47321 -State Listen
Get-CimInstance Win32_Process -Filter "ProcessId = $($bridge.OwningProcess)" | Select-Object ProcessId, CommandLine
```

只有确认命令行属于 Codex Sender 后，才能执行：

```powershell
Stop-Process -Id $bridge.OwningProcess
```

## 升级

升级时应确保 CLI、Cursor 注入脚本和 Bridge 使用同一版本：

1. 在旧 Bridge 终端按 `Ctrl+C`。
2. 完全退出 Cursor。
3. 使用新版本运行 `repair`。
4. 使用同一版本运行 `serve`。
5. 重新打开 Cursor 并运行 `doctor`。

```powershell
npx --yes @codex-sender/cli@latest repair --cursor-path "D:\Program Files\cursor\Cursor.exe" --no-startup
npx --yes @codex-sender/cli@latest serve
npx --yes @codex-sender/cli@latest doctor
```

需要复现特定版本时，将所有 `@latest` 替换成相同的固定版本，例如 `@0.2.1`。

版本错配时，发送和会话列表会被阻止，并显示类似提示：

```text
Bridge 版本 0.2.0 与注入脚本 0.2.1 不一致，请重启 Bridge 后重试
```

停止旧 Bridge，再用与 `repair` 相同的版本启动即可。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| `EPERM: operation not permitted` | 完全退出 Cursor，在管理员终端执行安装、修复或卸载 |
| 按钮消失 | 退出 Cursor，执行 `repair`，再重新打开 |
| Bridge 未运行 | 执行 `npx --yes @codex-sender/cli@latest serve` |
| Bridge 版本不匹配 | 停止旧进程，用相同版本执行 `repair` 和 `serve` |
| `EADDRINUSE` | 检查端口进程，停止已确认的旧 Bridge 或使用新端口 |
| 会话列表为空 | 检查 Codex CLI 登录状态以及当前工作区是否存在历史任务 |
| 自动粘贴失败 | 清空 Codex App 草稿并重试，或使用推荐的复制模式 |
| `@文件` 路径丢失 | 保持 Cursor 在前台重试，并使用 `logs` 查看原生复制诊断 |

诊断命令：

```powershell
npx --yes @codex-sender/cli@latest doctor
npx --yes @codex-sender/cli@latest logs --lines 200
```

## 数据与安全

- Bridge 只监听 `127.0.0.1`，请求必须携带安装时生成的本机随机令牌。
- 状态、绑定、令牌和备份位于 `%LOCALAPPDATA%\codex-sender`。
- 日志位于 `%LOCALAPPDATA%\codex-sender\logs\codex-sender.log`。
- 日志记录长度、哈希和诊断摘要，不记录完整提示词或令牌。
- 自动发送只在用户明确启用 `paste-and-send` 时执行。
- 提示词通过标准输入传给 PowerShell，不拼接到 PowerShell 命令行。

卸载会保留本地状态、日志和备份目录。确认 Cursor 已成功恢复后，如需彻底清理，可以手动删除 `%LOCALAPPDATA%\codex-sender`。

## 项目链接

- 完整文档：[BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender#readme)
- npm：[@codex-sender/cli](https://www.npmjs.com/package/@codex-sender/cli)
- 问题反馈：[GitHub Issues](https://github.com/BINGWU2003/codex-sender/issues)
- 许可证：[MIT](https://github.com/BINGWU2003/codex-sender/blob/main/LICENSE.md)
