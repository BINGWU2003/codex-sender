# Codex Sender

通过 npm CLI 在 Cursor 原生 Agent 输入框旁注入 `Codex` 按钮，把整理好的提示词快速交接到 Codex App。

> [!WARNING]
> 本工具会备份并修改 Cursor 安装目录中的 `workbench.html` 和 checksum，依赖 Cursor 未公开的 DOM，当前仅支持 Windows。安装、修复和卸载前请完全退出 Cursor。

## 安装

需要 Node.js 20+、Cursor、Codex App，以及已安装并登录的 Codex CLI。Codex CLI 只用于读取历史任务，不通过 `codex exec` 发送提示词。

```powershell
npm install -g codex-sender
codex-sender install
```

重新打开 Cursor 后：

- 点击 `Codex`：读取当前输入框，打开绑定的 Codex App 任务并复制提示词。
- 点击 `⌄`：选择历史任务、新建任务或启用实验性的自动粘贴。
- 新任务会通过官方 `codex://threads/new` Deep Link 预填提示词。

工具不会自动按 `Enter`。默认由你检查内容后手动粘贴并发送。

## 维护

```powershell
codex-sender doctor
codex-sender logs --lines 100
codex-sender repair
codex-sender uninstall
```

Cursor 更新后按钮消失时，完全退出 Cursor，再运行 `codex-sender repair`。

完整说明、工作原理和安全边界请访问 [BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)。
