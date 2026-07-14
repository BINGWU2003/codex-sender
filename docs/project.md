# Codex Sender

> 通过 npm CLI 修改 Cursor 工作台，在原生 Agent 输入框旁提供到 Codex App 的提示词交接按钮。

| 项目信息 | 内容 |
| --- | --- |
| 项目名称 | Codex Sender |
| npm 包 | `codex-sender` |
| 作者 | [BINGWU2003](https://github.com/BINGWU2003) |
| GitHub 仓库 | [BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender) |
| 许可证 | [MIT](../LICENSE.md) |

## 产品定位

Codex Sender 不采用 VS Code/Cursor 扩展形式，也不提供独立 Webview。用户全局安装 npm 包并运行一次安装命令，工具直接在 Cursor 编辑器右侧 Agent 输入框旁注入按钮：

```powershell
npm install -g codex-sender
codex-sender install
```

项目解决的是跨应用提示词交接，而不是重新实现 Codex 客户端：用户在 Cursor 输入框中整理提示词，Codex Sender 读取内容、打开选定的 Codex App 任务并复制或粘贴，最终由用户确认发送。

这是依赖 Cursor 私有 DOM 和安装目录结构的非官方本地补丁方案，第一版只支持 Windows。

## 最终使用体验

```text
打开 Cursor 项目
→ 在右侧 Agent 输入框整理提示词
→ 点击 Codex
→ 调用 Cursor 原生复制序列化，不需要手动 Ctrl+C
→ 打开当前工作区绑定的 Codex App 任务
→ 默认复制，或可选自动粘贴
→ 用户检查后按 Enter
```

未绑定历史任务时使用：

```text
codex://threads/new?prompt=<encoded>&path=<encoded-absolute-path>
```

官方 Deep Link 会打开新本地任务、设置工作目录并预填 composer，但不会自动发送。链接过长时只传入工作目录，提示词仍保留在剪贴板中。

已绑定任务时使用：

```text
codex://threads/<thread-id>
```

现有任务链接没有公开的 `prompt` 参数，因此默认流程是打开任务后由用户 `Ctrl+V`。实验模式会使用 Windows UI Automation 自动粘贴，但仍不会按 `Enter`。

## 任务绑定与设置

同一项目可能有多个 Codex 任务，本地状态使用标准化工作区路径保存当前绑定：

```json
{
  "version": 2,
  "settings": {
    "deliveryMode": "copy"
  },
  "workspaces": {
    "d:\\files\\hjc-code\\chat-list": {
      "activeThreadId": "019f5f77-...",
      "title": "修复消息列表",
      "updatedAt": "2026-07-14T08:00:00.000Z"
    }
  }
}
```

`deliveryMode` 有两个值：

- `copy`：默认模式。复制提示词并打开任务，由用户粘贴和发送。
- `paste`：实验模式。复制、打开后通过辅助功能树定位输入框并粘贴，由用户发送。

任务选择面板列出相同工作目录的历史任务，并显示当前绑定。选择“新建 Codex 任务”会解除绑定；新任务实际发送后，用户可以从列表中将其绑定，后续即可直接打开。

历史任务由 Codex App Server 的 `thread/list` 提供，按 `cwd` 筛选、按更新时间倒序排列。App、CLI、IDE、exec 和 App Server 创建的任务都可以进入列表。

## 总体架构

```text
Cursor workbench.html
        ↓ 加载
codex-sender.inject.js
        ↓ token + HTTP
localhost Bridge
        ├─ CodexAppLauncher
        │      ├─ Windows Clipboard
        │      ├─ codex:// Deep Link
        │      └─ Windows UI Automation（可选）
        ├─ AppServerClient → codex app-server → thread/list
        └─ StateStore → 工作区绑定、发送方式、端口、随机令牌
```

项目使用 pnpm workspace 与 Turborepo：

```text
codex-sender/
├─ packages/
│  ├─ cli/                    # 可发布 npm CLI、补丁安装与恢复
│  ├─ injector/               # Cursor DOM 注入脚本
│  ├─ bridge/                 # localhost API、Deep Link 与自动粘贴
│  ├─ app-server-client/      # Codex App Server JSONL 客户端
│  └─ core/                   # 共享状态类型与路径规范化
├─ docs/project.md
├─ pnpm-workspace.yaml
└─ turbo.json
```

依赖方向：

```text
cli → bridge → app-server-client
 │       └──→ core
 └──→ injector
```

内部包保持 `private`，发布时将工作区依赖打入单一 `dist/cli.mjs`。

## Cursor 注入方案

安装器定位：

```text
resources/app/out/vs/code/electron-sandbox/workbench/workbench.html
```

安装流程：

1. 检查 Windows 平台，并确认 `Cursor.exe` 已完全退出。
2. 定位 `resources/app`、`product.json` 和 `workbench.html`。
3. 按 Cursor 版本与原始 HTML hash 创建版本化备份。
4. 写入独立的 `codex-sender.inject.js`。
5. 在 `</html>` 前插入带开始、结束标记的 `<script type="module">`。
6. 更新 `product.json` 中 `workbench.html` 的 SHA-256 base64 checksum。
7. 原子写入安装清单，用于诊断和恢复。
8. 注册 Windows 登录启动脚本并启动 Bridge。

注入是幂等的。重复安装只更新独立脚本，不重复插入标签。缺少安装清单但发现已有标记时停止修改，避免覆盖来源不明的补丁。

卸载优先使用备份完整恢复；如果 Cursor 文件已发生其他变化，则只移除 Codex Sender 标记区并重算 checksum。

## Cursor DOM 策略

当前实现只处理编辑器右侧 Agent pane：

```text
.composer-bar[data-composer-location="pane"]
└─ .aislash-editor-input[contenteditable="true"]
```

注入脚本从同一个 composer 内找到 Cursor 原生发送按钮，将 `[Codex] [⌄]` 插在它旁边。`MutationObserver` 处理面板动态挂载，每个 composer 只插入一组带版本标记的按钮。独立 Cursor Agents 窗口不在该选择器范围内，不会注入。

Cursor 的 `@file` 是 Lexical mention 节点，DOM 只暴露显示名和内部 `data-mention-key`，直接读取 `innerText` 会丢失完整路径和选区行号；脚本触发的 `execCommand('copy')` 也不会调用 Cursor 的 Lexical 复制序列化器。点击 `Codex` 时，注入脚本先把焦点交还 contenteditable，然后请求本机 Bridge：Bridge 验证前台窗口、进程和焦点都属于 Cursor，再通过原生键盘输入发送 `Ctrl+A`、`Ctrl+C` 并读取 Windows 剪贴板。因此输出与用户手动复制一致，例如：

```text
分析一下这个文件 @docker/Dockerfile.app @packages/domain/src/admin.ts @admin.ts (26-40)
```

复制完成后，注入脚本恢复此前的 DOM 选区和焦点，再调用 `/api/send`。如果前台窗口或焦点在复制期间变化，或者富文本结果缺少 `@`，Bridge 返回错误并停止。整个流程只模拟全选和复制，永远不模拟 `Enter`。

任务选择面板使用 `position: fixed`，根据 `⌄` 按钮的 `getBoundingClientRect()` 放在按钮下方，并限制剩余视口高度。

Cursor DOM 是项目最不稳定的边界。`doctor` 只能证明文件注入与 checksum 正常，不能证明某个 Cursor 版本的选择器仍然有效。

## Codex App 交接器

`CodexAppLauncher.deliver()` 接收：

```ts
interface DeliveryRequest {
  cwd: string
  text: string
  threadId?: string
  mode: 'copy' | 'paste'
}
```

共同步骤：

1. 提示词以 UTF-8 Base64 通过 PowerShell 子进程标准输入传递，不拼接进命令行。
2. 使用 `Set-Clipboard` 写入剪贴板，作为所有模式的兜底。
3. Deep Link 通过环境变量交给 `Start-Process`，避免 `&` 等字符被 shell 解释。

新任务在 URL 长度允许时通过 `prompt` 预填；历史任务打开后按配置选择手动粘贴或自动粘贴。

自动粘贴的保护条件：

- 只检查进程名为 Codex 或 ChatGPT 的顶层窗口。
- 优先选择辅助功能树中可聚焦的 `ProseMirror` Group，并为兼容版本变化保留带 composer 名称的 `Edit`/`Document` 回退；定位只使用元素属性和窗口内相对位置，不点击固定坐标。
- 粘贴前读取输入框；已有草稿时立即停止。
- 粘贴后从 `ValuePattern` 或 `TextPattern` 回读并校验内容。
- 任一步失败都返回 `copy` 兜底结果；剪贴板内容不丢失。
- 永远不模拟 `Enter`。

## Localhost Bridge

Electron renderer 通过只监听本机的 Bridge 调用系统能力：

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 版本和存活检查 |
| `GET /api/threads` | 查询历史任务，同时返回当前绑定和发送设置 |
| `POST /api/send` | 立即执行 Codex App 交接并返回结果 |
| `POST /api/copy-cursor-prompt` | 验证 Cursor 焦点后执行原生 `Ctrl+A`、`Ctrl+C` 并返回序列化文本 |
| `POST /api/send-clipboard` | 从 Windows 系统剪贴板读取 Cursor 原生复制结果并交接 |
| `POST /api/bind` | 绑定历史任务 |
| `POST /api/unbind` | 解除绑定，下次新建任务 |
| `GET /api/settings` | 查询交接方式 |
| `POST /api/settings` | 保存 `copy` 或 `paste` 交接方式 |
| `POST /api/log` | 接收注入端的安全诊断事件 |

安全策略：

- 安装时生成 32 字节随机令牌，所有请求必须携带令牌。
- Origin 只接受 Cursor 本地 renderer 形态。
- 请求体限制为 1 MiB，提示词限制为 500,000 字符。
- Bridge 不监听外网地址，也不提供远程中转服务。
- 最终发送由 Codex App 和用户完成，Bridge 不调用 `codex exec`。

本地状态与备份默认位于：

```text
%LOCALAPPDATA%\codex-sender
```

旧的 version 1 状态会迁移到 version 2，并默认采用安全的 `copy` 模式。

## 诊断日志

Bridge 将 JSONL 日志写入：

```text
%LOCALAPPDATA%\codex-sender\logs\codex-sender.log
```

单文件最大 2 MiB，保留 3 个轮转文件。可以运行 `codex-sender logs --lines 100` 查看最近事件。复制诊断包含原生 copy 是否成功、DOM 选区长度、富文本节点数量和节点 lineage 中的 `data-*`、`aria-*`、`title` 等属性；剪贴板和 fallback 提示词只记录长度、SHA-256 短哈希以及是否包含 `@`，访问令牌与授权头始终脱敏。

## 生命周期命令

| 命令 | 行为 |
| --- | --- |
| `install` | 备份、注入、注册并启动 Bridge |
| `repair` | 使用当前配置重新注入，用于 Cursor 更新后恢复 |
| `doctor` | 检查注入标记、脚本存在性和 checksum |
| `serve` | 前台启动 Bridge |
| `uninstall` | 恢复 Cursor 文件并移除登录启动脚本 |
| `version` | 输出 CLI 版本 |

安装、修复、卸载必须在 Cursor 完全退出后进行。自动化测试使用临时 Cursor fixture，不修改真实安装。

## 兼容性与已知限制

- 第一版仅支持 Windows。
- Cursor 更新会替换安装目录，需要重新运行 `repair`。
- 依赖 Cursor 私有 DOM，不保证跨版本稳定。
- `doctor` 不启动 Cursor，因此无法验证真实按钮是否挂载。
- Cursor 安装在受保护目录时需要管理员权限。
- 当前同一工作区只保存一个活动任务绑定。
- 新任务发送后不会自动猜测并绑定生成的任务 ID，需要用户在历史列表中选择。
- 读取历史任务依赖已安装并登录的 Codex CLI/App Server。
- Windows UI Automation 受 Codex App 辅助功能树变化影响，因此自动粘贴仍是实验功能。

## 开发与验证

```powershell
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

发布前还需要验证：

1. `pnpm run check` 全部通过。
2. CLI tarball 只包含 README、package metadata 和自包含的 `dist/cli.mjs`。
3. 构建产物不保留 `@codex-sender/*` 运行时 import。
4. 临时 Cursor fixture 能完成安装、`doctor` 和卸载恢复。
5. 全仓不再存在 `codex exec` 发送链、任务队列和 job 轮询。
6. 在完全退出 Cursor 后运行 `repair`，验证按钮、列表、Deep Link、复制和实验粘贴流程。

官方 Deep Link 参数与“不自动发送”行为参考 [Codex App Deep Links](https://learn.chatgpt.com/docs/reference/commands#tasks)。
