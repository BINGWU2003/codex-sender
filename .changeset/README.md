# Changesets

每个会影响公开 npm 包的 Pull Request 都应添加一份 changeset：

```powershell
pnpm changeset
```

按照提示选择 `@codex-sender/cli`、版本类型并填写简体中文变更说明。仅文档、测试、CI 或私有内部包重构可以不添加 changeset。

合并到 `main` 后，Changesets Action 会维护版本发布 PR。合并版本发布 PR 后，工作流将发布 npm、创建 Git tag 和 GitHub Release。
