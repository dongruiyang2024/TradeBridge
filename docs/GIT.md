# Git 使用说明

## 建议提交内容

建议纳入版本管理：

- `apps/`
- `packages/`
- `docs/`
- `tools/`
- `package.json`
- `package-lock.json`
- `tsconfig.base.json`
- `.gitignore`
- `.gitattributes`

不建议提交：

- `node_modules/`
- `dist/`
- `logs/`
- `exports/`
- `.env*`
- `.tmp-*`
- AliSupplier/AliWorkbench 本机缓存、Cookie、导出的聊天数据

## 常用命令

```bash
git status
git add .
git commit -m "chore: initialize project"
```

开发前建议从主分支拉一个功能分支：

```bash
git switch -c feature/<name>
```

提交前建议至少执行：

```bash
npm test -w @wangwang/api
npm run typecheck
```
