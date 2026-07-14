# Codex Sender

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)

通过 npm CLI 在 Cursor 原生聊天输入框旁增加“发送到 Codex”按钮，把当前输入内容发送到 Codex 任务。

Codex Sender 不是 VS Code/Cursor 扩展。它会备份并修改 Cursor 安装目录中的 `workbench.html`，注入独立脚本，再通过仅监听本机的 bridge 调用 Codex CLI。这样可以直接复用 Cursor 原生输入框，同时不需要维护 VSIX 或单独的侧边栏。

> [!WARNING]
> 这是一个早期实验性工具，依赖 Cursor 未公开的 DOM 和安装目录结构。Cursor 更新可能覆盖或破坏注入；修改安装文件也可能触发完整性检查。请确认你接受这一风险，并保留 Codex Sender 创建的备份。

> [!NOTE]
> 当前 `0.1.0` 仍在重构验证阶段，`codex-sender` 尚未发布到 npm registry。下面的全局安装命令在首个版本发布后可用；现在请使用“从源码试用”。

## 当前能力

- 在 Cursor 原生聊天输入框的发送按钮旁注入 `Codex` 按钮和任务选择按钮。
- 把输入框中的文字发送给当前工作区绑定的 Codex 任务。
- 首次发送时创建新任务，随后自动续接同一个 `threadId`。
- 列出当前工作区的 Codex 历史任务，可切换任务或选择下次新建。
- 历史列表来自 Codex App Server，因此可以发现使用相同 `CODEX_HOME` 和工作目录创建的 Codex App、CLI 等任务。
- 按工作区串行排队发送，并在按钮上显示排队、成功或失败状态。
- 自动备份、校验、诊断、修复和卸载 Cursor 注入。

Cursor 中只显示发送状态，不显示 Codex 的完整回复。任务内容和运行结果仍在 Codex App 或其他 Codex 客户端中查看。

## 使用前提

- Windows 10/11。
- Cursor 桌面版。
- Node.js 20 或更高版本。
- 已安装并完成登录的 [Codex CLI](https://developers.openai.com/codex/cli/)，`codex --version` 可以正常执行。
- 当前项目最好是 Git 仓库；Codex CLI 默认要求在 Git 仓库中运行。

目前安装器只支持 Windows。Cursor 安装在 `Program Files` 等受保护目录时，可能需要在管理员终端中执行安装、修复或卸载命令。

## 发布后安装

先完全退出 Cursor，包括所有后台 `Cursor.exe` 进程，然后运行：

```powershell
npm install -g codex-sender
codex-sender install
```

安装成功后重新打开 Cursor。安装器会：

1. 定位 Cursor 的 `resources/app` 目录。
2. 备份原始 `workbench.html` 和 `product.json`。
3. 写入 `codex-sender.inject.js`，并在 `workbench.html` 中引用它。
4. 更新 `product.json` 中对应的 SHA-256 checksum。
5. 注册本机 bridge 的 Windows 登录启动脚本，并立即在后台启动 bridge。

默认会自动查找 Cursor。找不到时可以显式指定 `Cursor.exe`、Cursor 安装目录或 `resources/app`：

```powershell
codex-sender install --cursor-path "D:\Program Files\Cursor\Cursor.exe"
```

## 从源码试用

克隆仓库后先构建可发布 CLI，再从本地包目录安装：

```powershell
pnpm install
pnpm run check
npm install -g ./packages/cli

# 完全退出 Cursor 后再执行
codex-sender install
```

本地安装使用的也是 `packages/cli/dist/cli.mjs` 自包含产物，不需要发布内部的 `@codex-sender/*` workspace 包。

## 使用

1. 在 Cursor 聊天输入框中输入要交给 Codex 的内容。
2. 点击新增的 `Codex` 按钮。
3. 第一次发送会通过 `codex exec` 创建任务，并把任务绑定到当前工作区。
4. 后续发送会通过 `codex exec resume <threadId>` 续接已绑定任务。

点击 `Codex` 旁的下拉按钮可以选择当前项目的历史任务。选择“新建 Codex 任务”会解除当前绑定，下一次发送时再创建任务；选择历史任务会立即把它设为当前工作区的默认目标。

点击 `Codex` 不会触发 Cursor 自己的发送按钮，也不会自动清空 Cursor 输入框。需要同时发送给 Cursor 时，请再手动点击 Cursor 的原生发送按钮。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `codex-sender install` | 备份并注入 Cursor，同时配置 bridge 自启动 |
| `codex-sender doctor` | 检查 HTML 注入、脚本文件和 Cursor checksum |
| `codex-sender repair` | Cursor 更新或注入损坏后重新安装 |
| `codex-sender serve` | 在前台启动 localhost bridge，便于排错 |
| `codex-sender uninstall` | 恢复 Cursor 文件并删除 bridge 自启动脚本 |
| `codex-sender version` | 显示当前版本 |

安装、修复和卸载前都必须完全退出 Cursor。

如果不想注册 Windows 登录启动项，可以执行：

```powershell
codex-sender install --no-startup
codex-sender serve
```

此时每次使用前都需要自行保持 `serve` 进程运行。

## Cursor 更新后的处理

Cursor 更新通常会替换 `resources/app`。更新后如果按钮消失或 `doctor` 报错：

```powershell
# 先完全退出 Cursor
codex-sender repair
codex-sender doctor
```

如果新版本改变了聊天输入框 DOM，重新注入也可能无法恢复按钮，需要等待 Codex Sender 更新选择器。

## 工作原理与安全边界

```text
Cursor 原生聊天输入框
        ↓ 注入脚本读取文本
127.0.0.1 bridge（随机令牌鉴权）
        ├─ Codex CLI：新建或续接任务
        └─ Codex App Server：读取历史任务
```

- bridge 只监听 `127.0.0.1`，不会暴露到局域网。
- 每次请求都需要安装时生成的随机令牌，并限制允许的 renderer Origin。
- 状态、令牌、工作区绑定和备份保存在 `%LOCALAPPDATA%\codex-sender`。
- 新任务默认使用 Codex CLI 的 `read-only` sandbox；Codex Sender 不会自行放宽为 `workspace-write` 或 `danger-full-access`。
- 输入内容只经过本机注入脚本、localhost bridge 和你已登录的 Codex CLI；Codex Sender 不提供额外的远程中转服务。
- 令牌是本机凭据，不应提交到 Git、复制到日志或分享给其他人。

## 本地开发

项目使用 pnpm workspace 和 Turborepo：

```text
packages/cli/                    可发布的 codex-sender CLI 与 Cursor 安装器
packages/injector/               Cursor DOM 注入脚本生成器
packages/bridge/                 localhost API、状态、队列和 Codex CLI 调用
packages/app-server-client/      Codex App Server JSONL 客户端
packages/core/                   共享状态类型与工作区路径规范化
```

安装依赖并运行全量检查：

```powershell
pnpm install
pnpm run check
```

只构建并运行 CLI：

```powershell
pnpm --filter codex-sender build
node packages/cli/dist/cli.mjs help
```

测试使用临时 Cursor fixture，不会修改本机真实 Cursor。不要在开发验证中对真实安装目录运行 `install`，除非已经完全退出 Cursor 并明确准备测试系统级注入。

详细设计参阅 [项目文档](./docs/project.md)。

## 项目地址

- GitHub：[BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)
- 问题反馈：[GitHub Issues](https://github.com/BINGWU2003/codex-sender/issues)

## 许可证

[MIT](./LICENSE.md) License © [BINGWU2003](https://github.com/BINGWU2003)
