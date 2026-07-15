---
'@codex-sender/cli': minor
---

移除重复的 `repair` 命令，统一由可重复执行的 `install` 完成安装、修复和升级。每次安装都会安全替换旧 Bridge、启动当前版本并验证 CLI、注入脚本与 Bridge 版本一致。用户数据统一保存到 `~/.codex-sender`，Windows 旧目录会安全迁移；再次安装还会复用安装清单中的 Cursor 路径。
