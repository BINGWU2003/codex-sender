# Codex Sender

通过 npm CLI 在 Cursor 原生聊天输入框旁注入“发送到 Codex”按钮。

> [!WARNING]
> 本工具会备份并修改 Cursor 安装目录中的 `workbench.html` 和 checksum，依赖 Cursor 未公开的 DOM，当前仅支持 Windows。安装、修复和卸载前请完全退出 Cursor。

## 安装

需要 Node.js 20+、Cursor 桌面版，以及已安装并登录的 Codex CLI。

```powershell
npm install -g codex-sender
codex-sender install
```

重新打开 Cursor 后，在原生聊天输入框旁点击 `Codex` 即可发送。首次发送创建任务，后续发送续接当前工作区绑定的任务；下拉按钮用于选择历史任务或新建任务。

## 维护

```powershell
codex-sender doctor
codex-sender repair
codex-sender uninstall
```

Cursor 更新后按钮消失时，完全退出 Cursor，再运行 `codex-sender repair`。

完整说明、工作原理和安全边界请访问 [BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)。
