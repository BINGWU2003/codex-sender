# Codex Sender

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)

一个将 VS Code 与 Cursor 中的代码片段和问题发送到 Codex 任务的轻量扩展。

Codex Sender 使用标准 VS Code Extension API 提供极简发送面板，同一个 VSIX 可安装到 VS Code 和 Cursor。它用于收集一个或多个代码片段、输入问题并选择目标 Codex 任务；消息发送后，完整对话和处理结果仍在 Codex Windows App 中查看。

## 核心体验

- 从同一文件或不同文件收集多个代码片段。
- 将代码选区转换为带文件名和行号的引用。
- 为当前项目创建或切换 Codex 任务。
- 将问题与代码上下文发送到目标任务。
- 在 Codex Windows App 中继续查看完整对话。

## 开发状态

项目目前处于早期开发阶段，已建立 pnpm workspace + Turborepo 架构，以及扩展面板、消息组装和 Codex App Server JSONL 客户端的基础实现。

完整的产品方案与开发顺序请参阅 [项目文档](./docs/project.md)。

## 仓库结构

```text
apps/extension/                 VS Code 兼容扩展（Cursor 复用）
packages/core/                  代码引用与消息组装
packages/app-server-client/     Codex App Server JSONL 客户端
```

## 本地开发

```bash
pnpm install
pnpm run dev
```

在 VS Code 或 Cursor 中打开仓库后，也可以直接按 `F5` 启动 Extension Development Host 调试扩展。

常用检查：

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

## 项目地址

- GitHub：[BINGWU2003/codex-sender](https://github.com/BINGWU2003/codex-sender)
- 问题反馈：[GitHub Issues](https://github.com/BINGWU2003/codex-sender/issues)

## 许可证

[MIT](./LICENSE.md) License © [BINGWU2003](https://github.com/BINGWU2003)
