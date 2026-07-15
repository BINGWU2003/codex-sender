# Codex Sender

通过 npm CLI 在 Cursor 原生 Agent 输入框旁注入 `Codex` 按钮，把整理好的提示词快速交接到 Codex App。

> [!WARNING]
> 本工具会备份并修改 Cursor 安装目录中的 `workbench.html` 和 checksum，依赖 Cursor 未公开的 DOM，当前仅支持 Windows。安装、修复和卸载前请完全退出 Cursor。

## 运行方式

需要 Node.js 20.12+、Cursor、Codex App，以及已安装并登录的 Codex CLI。Codex CLI 只用于读取历史任务，不通过 `codex exec` 发送提示词。

`install` 默认启动交互式安装向导：可以编辑 Cursor 路径和 Bridge 端口，并用空格勾选登录自启动、安装后立即启动等选项。使用 `--non-interactive` 可以跳过向导，适合脚本或 CI。

使用 `npx` 免安装运行：

```powershell
npx --yes codex-sender@latest install --no-startup
npx --yes codex-sender@latest serve
```

`serve` 会在前台运行，关闭终端后 Bridge 也会停止。长期使用和 Windows 登录自启动推荐全局安装，避免启动项依赖可能被清理的 npm 临时缓存：

```powershell
npm install -g codex-sender
codex-sender install
```

重新打开 Cursor 后：

- 点击 `Codex`：读取当前输入框，打开绑定的 Codex App 任务并复制提示词。
- 点击 `⌄`：选择历史任务、新建任务或启用实验性的自动粘贴。
- 新任务会通过官方 `codex://threads/new` Deep Link 预填提示词。

工具不会自动按 `Enter`。默认由你检查内容后手动粘贴并发送。

## 命令说明

所有 `codex-sender ...` 命令都可以替换为 `npx --yes codex-sender@latest ...`。

| 命令 | 作用 | 参数 |
| --- | --- | --- |
| `codex-sender install` | 启动安装向导，确认后备份并注入 Cursor | `--cursor-path PATH`、`--port PORT`、`--no-startup`、`--non-interactive` |
| `codex-sender repair` | Cursor 更新或注入损坏后重新注入 | `--cursor-path PATH`、`--port PORT`、`--no-startup` |
| `codex-sender doctor` | 检查注入文件和 Cursor checksum | `--cursor-path PATH` |
| `codex-sender logs` | 查看结构化诊断日志，默认 100 行 | `--lines COUNT` |
| `codex-sender serve` | 在前台启动 localhost Bridge | `--port PORT` |
| `codex-sender uninstall` | 恢复 Cursor 并删除 Bridge 启动项 | 无 |
| `codex-sender version` | 显示 CLI 版本 | 无 |

示例：

```powershell
npx --yes codex-sender@latest doctor
npx --yes codex-sender@latest logs --lines 200
npx --yes codex-sender@latest repair --cursor-path "D:\Program Files\Cursor\Cursor.exe" --no-startup
npx --yes codex-sender@latest uninstall
```

安装、修复和卸载前必须完全退出 Cursor。Cursor 位于 `Program Files` 等受保护目录时，请在管理员终端运行命令。

完整说明、工作原理和安全边界请访问 [BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)。
