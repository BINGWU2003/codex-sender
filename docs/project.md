# Codex Sender

> 通过 npm CLI 修改 Cursor 工作台，在原生聊天输入框旁增加“发送到 Codex”按钮。

| 项目信息 | 内容 |
| --- | --- |
| 项目名称 | Codex Sender |
| npm 包 | `codex-sender` |
| 作者 | [BINGWU2003](https://github.com/BINGWU2003) |
| GitHub 仓库 | [BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender) |
| 许可证 | [MIT](../LICENSE.md) |

## 产品定位

Codex Sender 不再采用 VS Code/Cursor 扩展形式，也不提供独立 Webview。目标使用方式是全局安装 npm 包并运行一次安装命令，工具直接在 Cursor 原生聊天输入框旁注入按钮：

```powershell
npm install -g codex-sender
codex-sender install
```

目标是复用 Cursor 已有的输入体验，把同一段输入内容交给 Codex CLI，并允许用户决定新建 Codex 任务还是续接历史任务。

这是一种非官方、随 Cursor 版本变化的本地补丁方案。第一版只支持 Windows Cursor。

当前 `0.1.0` 已完成 npm tarball 构建，但尚未发布到 npm registry。发布前以源码构建和临时安装验证为准。

## 最终使用体验

```text
打开 Cursor 项目
→ 在 Cursor 聊天输入框中输入问题
→ 点击 Codex
→ 当前工作区没有绑定时创建 Codex 任务
→ 已绑定时续接对应任务
→ 在 Codex App 中查看完整过程和结果
```

任务选择按钮提供：

- 当前工作区的历史 Codex 任务。
- “新建 Codex 任务”，用于解除绑定并在下次发送时创建任务。
- 来自相同 Codex 本地数据目录的 App、CLI、IDE、exec 和 App Server 任务。

Cursor 原生发送和 Codex 发送是两个独立动作。Codex Sender 不自动点击 Cursor 的发送按钮，也不清空输入框。

## 任务绑定规则

工作区路径不能唯一表示任务，同一项目可能同时存在多个 Codex 任务。因此本地状态使用：

```text
标准化 cwd → activeThreadId
```

示例：

```json
{
  "d:\\files\\hjc-code\\chat-list": {
    "activeThreadId": "019f5f77-...",
    "title": "修复消息列表",
    "updatedAt": "2026-07-14T08:00:00.000Z"
  }
}
```

首次发送执行新任务：

```text
codex exec --json --sandbox read-only -C <cwd> -
```

读取 JSONL 中的 `thread.started`，保存 `thread_id` 后，后续发送执行：

```text
codex exec resume --json <threadId> -
```

历史任务由 Codex App Server 的 `thread/list` 提供，按 `cwd` 筛选、按更新时间倒序排列。这样可以选择此前在 Codex App 中创建、且使用相同工作目录和 `CODEX_HOME` 的任务。

## 总体架构

```text
Cursor workbench.html
        ↓ 加载
codex-sender.inject.js
        ↓ token + HTTP
localhost bridge
        ├─ CodexCliRunner → codex exec / exec resume
        ├─ AppServerClient → codex app-server → thread/list
        └─ StateStore → 工作区绑定、端口、随机令牌
```

项目使用 pnpm workspace 与 Turborepo：

```text
codex-sender/
├─ packages/
│  ├─ cli/                    # 可发布 npm CLI、补丁安装与恢复
│  ├─ injector/               # 生成注入到 Cursor 的浏览器脚本
│  ├─ bridge/                 # localhost API、队列和 Codex CLI 调用
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

内部包保持 `private`，发布时由 CLI 构建将工作区依赖打入单一 `dist/cli.mjs`，npm 包不能依赖未发布的 `@codex-sender/*` 包。

## Cursor 注入方案

安装器定位：

```text
resources/app/out/vs/code/electron-sandbox/workbench/workbench.html
```

安装流程：

1. 检查 Windows 平台并确认 `Cursor.exe` 已完全退出。
2. 定位 `resources/app`、`product.json` 和 `workbench.html`。
3. 按 Cursor 版本与原始 HTML hash 创建版本化备份。
4. 写入独立的 `codex-sender.inject.js`。
5. 在 `</html>` 前插入带开始、结束标记的 `<script type="module">`。
6. 计算修改后 HTML 的 SHA-256 base64，并更新：

   ```text
   checksums["vs/code/electron-sandbox/workbench/workbench.html"]
   ```

7. 原子写入安装清单，以便诊断和恢复。
8. 注册 Windows 登录启动脚本并启动 bridge。

注入是幂等的。重复安装只更新独立脚本，不重复插入标签。缺少安装清单但发现已有标记时停止修改，避免覆盖来源不明的补丁。

卸载优先使用备份完整恢复；如果 Cursor 文件已发生其他变化，则只移除 Codex Sender 标记区并重算 checksum，避免覆盖后续改动。

## Cursor DOM 策略

当前已确认的关键节点：

```text
.composer-input-wrapper
.composer-input-container
.ProseMirror[contenteditable="true"]
button[aria-label="Send message"]
```

注入脚本使用 `MutationObserver` 处理聊天面板的动态挂载。每个 composer 只插入一组带版本标记的按钮，避免重复渲染。

这是项目最不稳定的边界。Cursor 更新后如果 selector 改变，`doctor` 只能证明文件注入正常，不能证明按钮一定成功挂载；后续需要增加真实 UI 冒烟测试或 selector 兼容层。

## Localhost bridge

Electron renderer 不直接拥有可靠、安全的 Node.js 子进程能力，因此注入脚本通过 bridge 间接调用 Codex CLI。

bridge 只监听 `127.0.0.1`，提供：

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 版本和存活检查 |
| `GET /api/threads` | 查询当前工作区历史任务 |
| `POST /api/send` | 创建排队发送任务 |
| `POST /api/bind` | 绑定历史任务 |
| `POST /api/unbind` | 解除绑定，下次新建任务 |
| `GET /api/jobs/:id` | 查询排队、运行、成功或失败状态 |

安全策略：

- 安装时生成 32 字节随机令牌，所有请求必须携带令牌。
- Origin 只接受 Cursor 本地 renderer 形态。
- 请求体限制为 1 MiB，发送文本限制为 500,000 字符。
- 每个标准化工作区使用独立串行队列，避免同时续接同一任务。
- 新任务默认使用 `read-only` sandbox。
- bridge 不监听外网地址，也不提供远程中转服务。

本地状态与备份默认位于：

```text
%LOCALAPPDATA%\codex-sender
```

## 生命周期命令

| 命令 | 行为 |
| --- | --- |
| `install` | 备份、注入、注册并启动 bridge |
| `repair` | 使用当前配置重新注入；用于 Cursor 更新后恢复 |
| `doctor` | 检查注入标记、脚本存在性和 checksum |
| `serve` | 前台启动 bridge |
| `uninstall` | 恢复 Cursor 文件并移除登录启动脚本 |
| `version` | 输出 CLI 版本 |

安装、修复、卸载都必须在 Cursor 完全退出后进行。真实系统安装只能由用户明确执行；自动化测试必须使用临时 Cursor fixture。

## 兼容性与已知限制

- 第一版仅支持 Windows。
- Cursor 更新会替换安装目录，用户需要重新运行 `repair`。
- 依赖 Cursor 私有 DOM，不保证跨版本稳定。
- `doctor` 不启动 Cursor，因此无法验证真实按钮是否挂载。
- Cursor 安装目录受保护时需要管理员权限。
- Cursor 中只显示发送状态，不渲染 Codex 回复或审批 UI。
- 当前同一工作区只保存一个活动任务绑定。
- 任务必须存在于当前 Codex CLI 能访问的本地 Codex 数据目录中。

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
5. 全仓没有旧扩展代码、调试配置或发布产物残留。
6. 在一个明确关闭的测试用 Cursor 上完成按钮、历史选择与发送闭环的人工冒烟测试。
