# 开发说明

这个仓库是 Obsidian 插件 **Obsidian Sync** 的完整源码。`main.js` 是构建产物，真正的源码在 `src/`。

## 环境

- Node.js 22 或更高
- npm
- Obsidian 1.11.4 或更高（使用了 `app.secretStorage`）

```bash
npm install
npm run dev    # 监听源码，生成 main.js
npm run build  # 类型检查 + 生产构建
npm test       # 同步对比逻辑单元测试
```

## 目录结构

```text
src/
  main.ts            插件入口：命令、状态栏、进度窗口、Token 存储
  github.ts          GitHub REST / Git Data API 客户端
  sync.ts            同步引擎：pull / push / 冲突 / 缓存 / 进度
  compare.ts         纯三路对比逻辑，单元测试覆盖
  settings.ts        中文设置页
  conflict-modal.ts  冲突选择弹窗
  progress-modal.ts  同步进度窗口
  types.ts           类型与默认配置
  utils.ts           SHA-1、base64、glob、路径、格式化工具

test/
  compare.test.ts    三路对比测试

.github/workflows/
  release.yml        打 tag 后自动构建并发布 Release
```

## 同步模型

插件不使用 `.git`，也不调用系统 `git`。它通过 GitHub 的 Git Data API 创建真实的 commit。

核心状态：

- `settings.lastSyncCommit`：上一次成功同步的远端 commit，作为三路对比的 base。
- `settings.lastIgnorePatterns`：上一次同步时使用的忽略规则，用来避免修改忽略规则后误删远端文件。
- `cache.files[path]`：本地文件的 `mtime + size + sha` 缓存，避免每次同步都重读整个 vault。

三路对比在 `src/compare.ts`：

```text
local / remote / base 都是 Git blob SHA，文件不存在时为 null
local == remote                  -> 不处理
base == null, local + remote     -> 两边新增，冲突
base == null, 只有一边           -> 拉取或推送
local == base, remote 变化       -> 拉取
remote == base, local 变化       -> 推送
两边都变化且不相同               -> 冲突
```

## Pull 流程

1. 读取远端分支最新 commit 和 tree。
2. 用当前忽略规则过滤远端 tree；用 `lastIgnorePatterns` 过滤 base tree。
3. 扫描本地文件，计算 Git blob SHA（命中缓存则跳过读取）。
4. 三路对比。
5. 下载远端新增/修改的文件，删除远端已删除且本地未改的文件。
6. 下载优先走 `raw.githubusercontent.com`，不消耗 GitHub API 5000 次/小时配额；失败时回退到 Git Data API。
7. 下载后直接写入 `cache.files`，不重新扫描整个 vault。
8. 没有冲突时更新 `lastSyncCommit`；有冲突时保留旧 base，等用户选择。

## Push 流程

1. 先确认没有冲突，并且没有“只存在于远端、本地还没拉取”的文件。
2. 对本地新增/修改的文件创建 blob。
3. 用远端 tree 作为 `base_tree` 创建新 tree，删除项用 `sha: null`。
4. 创建 commit，parent 是远端最新 commit。
5. 更新分支 ref。
6. 更新 `lastSyncCommit` 和缓存。

`push()` 在发现 `compare.pull.length > 0` 时会拒绝执行，避免用户直接点“推送”导致远端新文件被当成“本地删除”。

## 忽略规则

默认规则在 `src/types.ts` 的 `DEFAULT_IGNORE_PATTERNS`：

```text
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/plugins/obsidian-sync-github/**
.obsidian/plugins/*/data.json
.trash/**
.git/**
.DS_Store
**/.DS_Store
```

注意：

- 忽略规则会同时过滤远端 tree 和本地扫描。
- base tree 使用上一次同步的 `lastIgnorePatterns`，所以“后来才加入忽略”的文件不会被当成远端删除。
- 不要默认同步 `.obsidian/plugins/*/data.json`，很多插件会在这里存 API Key。

## 移动端注意事项

- 运行时不能使用 Node API（`fs`、`path`、`child_process` 等）。
- 文件操作统一走 `app.vault.adapter`。
- HTTP 统一走 Obsidian 的 `requestUrl`，避免 CORS。
- iOS 后台会挂起 Obsidian；同步时要求用户保持前台。
- 进度窗口和取消逻辑在 `main.ts` + `progress-modal.ts` + `sync.ts` 的 `SyncOptions`。

## SecretStorage

Token 不写进 `data.json`，而是存在：

```ts
app.secretStorage.setSecret(key, token)
```

SecretStorage 的 key 必须满足：**小写字母、数字、连字符，最多 64 个字符**。见 `main.ts` 的 `secretKey()`。

## 发布新版本

1. 修改 `manifest.json`、`package.json`、`package-lock.json` 的版本号。
2. 在 `versions.json` 增加 `"新版本": "最低 Obsidian 版本"`。
3. 构建并测试：

   ```bash
   npm run build
   npm test
   ```

4. 提交并打 tag：

   ```bash
   git add .
   git commit -m "release: x.y.z"
   git tag x.y.z
   git push origin main
   git push origin x.y.z
   ```

5. GitHub Actions 会运行 `.github/workflows/release.yml`，自动创建 Release，并上传 `main.js`、`manifest.json`、`styles.css`、`versions.json`。
6. BRAT 会从 Release 读取新版本并更新插件。

## 已知限制

- 不支持 Git LFS、子模块、SSH。
- GitHub 单文件上限 100MB；插件默认上限 50MB，可调。
- 没有逐文件冲突合并，只有“保留本地/保留远端”的整体选择。
- 空文件夹不会同步。
- iOS 后台定时同步不保证准时。
- 仓库很大时首次同步会很慢；进度窗口可以取消，下一次会从缓存继续。

## 后续可以做的方向

- 逐文件冲突选择 / 三方合并
- 按文件夹稀疏同步
- GitHub OAuth Device Flow，免手动创建 PAT
- 后台同步的 Shortcuts / App Intents 集成
- 更细的进度（当前文件、速度、剩余时间）
