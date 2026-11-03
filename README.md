# Obsidian Sync

一个专门给 Obsidian 用的中文 GitHub 同步插件。它不依赖终端、不需要 `.git` 目录，也不会再出现 `refs/heads/master` 这类分支问题。

> 名称按你的要求定为 **Obsidian Sync**。这是第三方 GitHub 同步插件，不是 Obsidian 官方的付费同步服务。

- 中文界面，设置项尽量少
- 通过 GitHub API 同步，iPad / iPhone / 桌面都能用
- 在 GitHub 上生成真正的 commit，保留提交历史
- 支持手动同步、启动时拉取、定时同步
- 手动同步时显示进度窗口：文件数量、已下载大小、当前文件，可取消
- 支持文本和附件（受 GitHub 单文件 100MB 限制）
- 冲突时弹窗选择“保留本地”或“保留远端”
- Token 保存在 Obsidian 的 SecretStorage 中，不写进笔记

## 安装

### 方式一：BRAT（推荐）

1. 在 Obsidian 里安装并启用 **BRAT**。
2. 打开 BRAT 设置，选择 **Add Beta Plugin**。
3. 填入本仓库地址：
   `https://github.com/ZhoukangChen/obsidian-sync-github`
4. 安装完成后，在“社区插件”里启用 **Obsidian Sync**。

> 如果仓库地址不同，换成你自己的地址即可。

### 方式二：手动安装

从 GitHub Release 下载以下文件：

- `main.js`
- `manifest.json`
- `styles.css`

放到：

```
你的 vault/.obsidian/plugins/obsidian-sync-github/
```

重启 Obsidian，在“社区插件”里启用“Obsidian Sync”。

## 配置

### 1. 创建 GitHub Token

打开 GitHub：

`Settings → Developer settings → Personal access tokens → Fine-grained tokens`

新建 Token：

- Repository access：只选你的笔记仓库
- Permissions：
  - **Contents: Read and write**
  - **Metadata: Read-only**（通常会自动勾选）

复制生成的 Token（只显示一次）。

### 2. 填写插件设置

打开 Obsidian：

`设置 → 社区插件 → Obsidian Sync`

填写：

- **GitHub 仓库**：`用户名/仓库名`
- **分支**：通常是 `main`，旧仓库可能是 `master`
- **GitHub Token**：粘贴后点“保存”
- 点“测试”确认连接成功

### 3. 同步

- 点左侧栏的刷新图标，或命令面板执行“Obsidian Sync：立即同步”
- 也可以在设置页点“同步”

第一次同步建议先备份 vault。插件会对比本地和远端：

- 只有远端改过：自动下载
- 只有本地改过：自动提交并推送
- 两边都改过：弹窗让你选择保留哪一边

## 同步原理

插件不运行 `git`，而是调用 GitHub 的 Git Data API：

1. 读取远端分支的最新 tree
2. 对比本地文件的 Git blob SHA
3. 有本地改动时，创建 blob、tree、commit，再更新分支
4. 有远端改动时，下载 blob 写回本地

因此：

- 不需要 `.git`
- 不需要终端
- 不会出现 mobile Git 实现的 ref 问题
- GitHub 上仍然是一条条正常的 commit，可以在网页上查看历史

## 默认忽略的文件

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
.obsidian/plugins/obsidian-sync-github/**
.obsidian/plugins/*/data.json
.trash/**
.git/**
.DS_Store
**/.DS_Store
```

`.obsidian/plugins/*/data.json` 默认被排除，因为很多插件会把 API Key 存在这里。Token 本身在 SecretStorage 里，不在 `data.json`，但保留这些忽略规则更安全。

## 限制

- 不是完整的 Git 客户端：不支持 LFS、子模块、SSH、rebase
- GitHub 单文件上限 100MB；超过插件设置上限的文件会阻止同步
- GitHub API 有速率限制（已登录通常 5000 次/小时）
- iOS 后台定时同步不保证准时；建议打开/关闭 Obsidian 时手动点一下，或使用快捷指令触发
- 不会同步空文件夹（Git 本身不保存空文件夹）
- 不会自动解决内容冲突；冲突时需要你选择保留哪一边

## 安全

- Token 存在 Obsidian 的 `SecretStorage` 中
- 插件只连接 `api.github.com`，没有中间服务器
- 插件不会把笔记上传到 GitHub 以外的任何地方
- 建议使用只针对单个仓库的 Fine-grained Token，不要用全权限 classic token

## 开发

```bash
npm install
npm run dev    # 监听 src，生成 main.js
npm run build  # 类型检查 + 生产构建
```

把整个项目目录链接到 vault 的插件目录，或在构建后复制 `main.js`、`manifest.json`、`styles.css`。

## 许可证

MIT
