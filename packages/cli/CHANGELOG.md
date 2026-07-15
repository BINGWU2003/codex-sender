# @codex-sender/cli

## 0.2.3

### Patch Changes

- [`1982356`](https://github.com/BINGWU2003/codex-sender/commit/1982356439c460e1d4775d75a423ce444b7be1ce) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 兼容 Cursor 3.7.42 的 Agent 输入框结构，并以模式选择器为锚点将 Codex 按钮稳定放在其右侧。

## 0.2.2

### Patch Changes

- [`e1440b5`](https://github.com/BINGWU2003/codex-sender/commit/e1440b517ac20ca236911aa66675d2d2edb4914e) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 完善 npm 包的安装、命令参数、Bridge 生命周期、版本升级、故障排查和卸载说明。

## 0.2.1

### Patch Changes

- [`967cf4c`](https://github.com/BINGWU2003/codex-sender/commit/967cf4c1d9a0f1b0af5540d15d03fd8c53cc0cd3) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 检测注入脚本与 Bridge 的版本错配，并在 `doctor` 中报告旧 Bridge 进程，避免升级后切换交接方式时出现误导性的参数错误。

## 0.2.0

### Minor Changes

- [`b3a28a8`](https://github.com/BINGWU2003/codex-sender/commit/b3a28a869827dce8bbd0661ebad2d645b5cef0a4) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 新增“自动粘贴并发送”交接模式，在提示词内容、Codex 前台窗口和输入框焦点均校验通过后自动按 Enter 发送。

## 0.1.3

### Patch Changes

- [`8744e1f`](https://github.com/BINGWU2003/codex-sender/commit/8744e1ffcd25c03843070093b94ba764e11332b1) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 将 npm 包迁移为 `@codex-sender/cli`，全局安装后的 `codex-sender` 命令保持不变。

## 0.1.2

### Patch Changes

- [`458e764`](https://github.com/BINGWU2003/codex-sender/commit/458e7645c5d88819b659d1f252414c345d3ef8c1) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 修复 CLI 与注入脚本仍显示旧版本号的问题，版本信息现在直接读取已发布包的 package.json。

## 0.1.1

### Patch Changes

- [`75d86df`](https://github.com/BINGWU2003/codex-sender/commit/75d86df95d9d2f2bb7bc4a1c07022c14f0f3585a) Thanks [@BINGWU2003](https://github.com/BINGWU2003)! - 配置 Changesets 自动版本管理、npm 发布和 provenance，并补充发布流程文档。
