# AGENTS.md

本仓库是 Obsidian 插件 **Obsidian Sync**。继续开发前请先读 `DEVELOPMENT.md`。

## 必须遵守的约束

- 不要使用 Node API（`fs`、`path`、`child_process` 等），插件必须能在 iPad/iPhone 上运行。
- 文件读写使用 `app.vault.adapter`。
- 网络请求使用 Obsidian 的 `requestUrl`，不要直接用 `fetch`。
- Token 只能存 `app.secretStorage`，不能写入 `data.json` 或提交到仓库。
- SecretStorage key 只能包含小写字母、数字、连字符，最长 64 字符。
- 修改同步逻辑后必须更新/补充 `test/compare.test.ts`。
- 不要直接修改 `main.js`；它是 `npm run build` 生成的。

## 常用命令

```bash
npm run build
npm test
```

## 发布

发布流程见 `DEVELOPMENT.md` 的“发布新版本”。
