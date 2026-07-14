# Codex Sender

> 一个将 VS Code 与 Cursor 中的代码片段和问题发送到 Codex 任务的轻量扩展。

| 项目信息 | 内容 |
| --- | --- |
| 项目名称 | Codex Sender |
| 作者 | [BINGWU2003](https://github.com/BINGWU2003) |
| GitHub 仓库 | [BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender) |
| 许可证 | [MIT](../LICENSE.md) |

总体方案是做一个标准的 VS Code 兼容扩展，名称为 `Codex Sender`，主要面向 Cursor 使用。VS Code 与 Cursor 安装同一个 VSIX，不维护两套扩展。它只负责收集代码片段、输入问题、选择目标 Codex 会话并发送；完整对话仍然在 Codex Windows App 查看。

## 最终使用体验

```text
在文件 A 选择代码
→ Ctrl+C
→ 在 Codex Sender 输入框 Ctrl+V
→ 自动生成 @App.tsx (8-22)

在文件 B 选择代码
→ Ctrl+C
→ Ctrl+V
→ 自动生成 @useChat.ts (31-48)

输入问题
→ 点击“发送到 Codex”
→ 去 Codex App 查看对话和结果
```

编辑器侧不显示 Codex 的完整回复和聊天记录。

## VS Code 与 Cursor 里的界面

在侧边栏增加一个极简面板：

```text
┌─ Codex Sender ─────────────────────┐
│ 项目：chat-list                    │
│ 目标任务：修复消息列表        [切换] │
│                                    │
│ @App.tsx (8-22)               [×] │
│ @useChat.ts (31-48)           [×] │
│ @messageStore.ts (80-105)     [×] │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ 分析这些代码为什么重复发送消息 │ │
│ └────────────────────────────────┘ │
│                                    │
│ [清空上下文]       [发送到 Codex] │
└────────────────────────────────────┘
```

同时提供快捷键：

```text
Ctrl+Alt+Enter   聚焦发送框/发送
Ctrl+Alt+A       直接加入当前代码选区
```

## 多代码片段的实现

扩展记录每个复制的代码引用：

```ts
interface CodeReference {
  workspacePath: string
  relativeFilePath: string
  languageId: string
  startLine: number
  endLine: number
  selectedText: string
  documentVersion: number
}
```

粘贴到发送框时，不只是插入普通文本，而是生成：

```text
@App.tsx (8-22)
```

这个标签背后保留完整文件路径、行号和代码内容。

可以连续从：

- 同一个文件选择多个片段。
- 不同文件选择多个片段。
- 不同目录选择多个片段。

发送前，扩展把所有标签转换成 Codex 能理解的结构化文本。

## 项目与 Codex 会话对应

项目路径只能确定工作区，不能唯一确定会话。因为同一个项目可以有很多 Codex 任务。

所以映射采用：

```text
标准化项目路径 → 当前绑定的 threadId
```

例如：

```json
{
  "d:\\files\\hjc-code\\chat-list": {
    "activeThreadId": "019f5f77-...",
    "title": "修复消息列表"
  }
}
```

映射保存在 Cursor 扩展的 `globalState` 中，不写进项目，不污染 Git。

扩展提供三个任务管理操作：

- `New Codex Task`
- `Switch Codex Task`
- `Send to Current Codex Task`

如果当前项目有多个任务，显示选择框：

```text
选择目标 Codex 任务：

1. 修复消息重复问题
2. 重构虚拟列表
3. 新建任务
```

选中后保存为该项目的默认目标。

## 与 Codex 的通信

扩展在后台启动：

```powershell
codex app-server
```

然后使用官方 JSONL 协议通信。

首次创建：

```text
initialize
→ thread/start，传入项目 cwd
→ 得到 threadId
→ 保存项目与 threadId 的对应
→ turn/start 发送消息
```

继续已有任务：

```text
thread/resume
→ turn/start(threadId, cwd, input)
```

如果 Codex 正在处理上一条消息：

- 可以排队等待。
- 或使用 `turn/steer` 补充上下文。
- 第一版建议直接排队，行为更容易理解。

## 发送给 Codex 的内容

扩展最终生成类似：

````text
请分析这些代码为什么会重复发送消息。

片段 1
文件：src/App.tsx
行号：8-22

```tsx
选中的代码……
```

片段 2
文件：src/hooks/useChat.ts
行号：31-48

```ts
选中的代码……
```

片段 3
文件：src/store/messageStore.ts
行号：80-105

```ts
选中的代码……
```
````

Codex 同时获得正确的项目 `cwd`，因此还能自行读取相关文件和执行项目命令。

## Codex App 中查看

Windows Codex App 与 Windows 原生 Codex 共用：

```text
%USERPROFILE%\.codex
```

要保证共享会话：

- Cursor 扩展调用 Windows 原生 Codex。
- 不单独设置其他 `CODEX_HOME`。
- 不使用独立的 WSL `~/.codex`。

需要注意：官方没有保证另一个 app-server 产生的流式事件会立即刷新到已经打开的 App 页面。任务会进入共享会话记录，但 App 可能需要返回任务列表后重新打开。

如果任务需要人工审批，扩展也需要提供简单的批准/拒绝提示，或者使用不会弹出审批的配置。

## 为什么不拦截 Cursor 原生聊天框

不建议直接给 Cursor 自带聊天窗口插入“发送到 Codex”按钮，因为：

- Cursor 没有稳定公开的聊天框扩展接口。
- 普通扩展不能可靠修改 Cursor 私有 UI。
- 很难取得输入框中的文本和附件。
- Cursor 更新后容易失效。
- 可能造成消息同时发送给 Cursor 和 Codex。

因此采用标准 VS Code Webview View 实现自己的极简发送面板，界面可以适配 Cursor，但不显示对话记录。

## Monorepo 架构

项目使用 pnpm workspace 与 Turborepo 管理：

```text
codex-sender/
├─ apps/
│  └─ extension/               # VS Code 兼容扩展，Cursor 复用同一 VSIX
├─ packages/
│  ├─ core/                    # 代码引用、任务绑定和消息组装
│  └─ app-server-client/       # Codex App Server 进程与 JSONL 通信
├─ docs/
│  └─ project.md
├─ pnpm-workspace.yaml
└─ turbo.json
```

依赖方向保持单向：

```text
codex-sender
  ├─ @codex-sender/core
  └─ @codex-sender/app-server-client
```

各模块职责如下：

- `apps/extension`：扩展激活、命令、代码选区、Webview、`globalState` 和用户交互。
- `packages/core`：不依赖编辑器或 Node.js 的纯 TypeScript 业务逻辑，负责代码引用与最终消息组装。
- `packages/app-server-client`：Node.js 环境下启动 `codex app-server`，处理 JSONL 请求、响应、通知、超时和进程退出。
- 根目录：只负责编排 workspace、Turbo 任务、统一代码规范和 CI，不再作为可发布 npm 包。

第一版不单独拆分 UI、配置或协议包；等出现第二个消费者后再提取，避免空包和过早抽象。

## 开发顺序

第一版先完成核心闭环：

1. 建立 monorepo、共享核心类型和 App Server JSONL 客户端。
2. VS Code/Cursor 侧边栏发送框。
3. 复制粘贴生成 `@文件 (行号)` 标签。
4. 支持多个文件、多个片段。
5. 创建 Codex 任务并保存 `threadId`。
6. 将消息发送到 Codex。
7. 成功、失败和运行中状态提示。

第二版再补充：

- 切换多个 Codex 任务。
- 代码片段预览、排序和删除。
- 文件改变后的过期提醒。
- 消息排队。
- Codex 审批提示。
- 自动打开或定位 Codex App 任务——取决于后续是否有稳定的 Windows 深链接口。

最终架构就是：

```text
VS Code / Cursor 代码选择与复制
        ↓
Codex Sender 标准扩展
  ├─ 多片段上下文
  ├─ 极简输入框
  └─ 项目 → threadId 映射
        ↓
Codex App Server
        ↓
共享 Codex 会话记录
        ↓
Codex Windows App 查看完整对话
```
