import type { App } from "obsidian";
import { compareStates } from "./compare";
import { GitHubClient, GitHubError } from "./github";
import type {
  CachedFile,
  Conflict,
  ConflictChoice,
  LocalFile,
  PluginData,
  PluginSettings,
  PullResult,
  PushResult,
  RemoteFile,
  RemoteState,
  SyncResult,
} from "./types";
import {
  createIgnoreMatcher,
  ensureFolder,
  normalizePath,
  parentPath,
  renderCommitMessage,
  sha1Blob,
} from "./utils";

export interface SyncHost {
  app: App;
  getSettings(): PluginSettings;
  getData(): PluginData;
  getToken(): string;
  save(): Promise<void>;
  setStatus(text: string, error?: boolean): void;
  notify(message: string, timeout?: number): void;
}

export class SyncConflictError extends Error {
  conflicts: Conflict[];
  headSha: string;

  constructor(conflicts: Conflict[], headSha: string) {
    super(`有 ${conflicts.length} 个文件发生冲突`);
    this.name = "SyncConflictError";
    this.conflicts = conflicts;
    this.headSha = headSha;
  }
}

export class SyncEngine {
  private readonly host: SyncHost;

  constructor(host: SyncHost) {
    this.host = host;
  }

  private get settings(): PluginSettings {
    return this.host.getSettings();
  }

  private get data(): PluginData {
    return this.host.getData();
  }

  private get adapter() {
    return this.host.app.vault.adapter;
  }

  private client(): GitHubClient {
    const token = this.host.getToken();
    if (!token) {
      throw new Error("还没有填写 GitHub Token，请先到插件设置里填写。");
    }
    if (!this.settings.repo) {
      throw new Error("还没有填写 GitHub 仓库，例如“用户名/仓库名”。");
    }
    return new GitHubClient(this.settings.repo, token);
  }

  async testConnection(): Promise<string> {
    const info = await this.client().testConnection();
    return `连接成功：${info.owner}/${info.repo}，默认分支 ${info.defaultBranch}`;
  }

  async pull(): Promise<PullResult> {
    this.host.setStatus("正在拉取…");
    const client = this.client();
    const remote = await this.fetchRemoteState(client);
    const local = await this.scanLocal();
    const compare = compareStates(local, remote);

    const updated: string[] = [];
    const deleted: string[] = [];

    for (const action of compare.pull) {
      if (action.remote) {
        await this.downloadFile(client, action.remote);
        updated.push(action.path);
      } else {
        await this.deleteLocal(action.path);
        deleted.push(action.path);
      }
    }

    const changedLocal = updated.length > 0 || deleted.length > 0;
    if (changedLocal) {
      this.host.notify(
        `拉取完成：更新 ${updated.length} 个，删除 ${deleted.length} 个文件。`,
        5000
      );
    }

    const conflicts = compare.conflicts;
    const refreshed = changedLocal ? await this.scanLocal() : local;
    if (conflicts.length === 0) {
      this.settings.lastSyncCommit = remote.headSha;
      this.settings.lastSyncTime = Date.now();
      await this.saveCache(refreshed);
      await this.host.save();
      this.host.setStatus("已同步");
    } else {
      await this.saveCache(refreshed);
      await this.host.save();
      this.host.setStatus(`有 ${conflicts.length} 个冲突`);
    }

    return {
      headSha: remote.headSha,
      updated,
      deleted,
      conflicts,
      pendingPush: compare.push.length,
      upToDate:
        updated.length === 0 &&
        deleted.length === 0 &&
        conflicts.length === 0 &&
        compare.push.length === 0,
    };
  }

  async push(): Promise<PushResult> {
    this.host.setStatus("正在推送…");
    const client = this.client();
    const remote = await this.fetchRemoteState(client);
    const local = await this.scanLocal();
    const compare = compareStates(local, remote);

    if (compare.conflicts.length) {
      throw new SyncConflictError(compare.conflicts, remote.headSha);
    }

    if (compare.push.length === 0) {
      this.settings.lastSyncCommit = remote.headSha;
      this.settings.lastSyncTime = Date.now();
      await this.saveCache(local);
      await this.host.save();
      this.host.setStatus("已同步");
      return {
        commitSha: remote.headSha,
        changed: 0,
        upToDate: true,
      };
    }

    const entries: Array<{
      path: string;
      mode: string;
      type: "blob";
      sha: string | null;
    }> = [];

    let index = 0;
    for (const action of compare.push) {
      index++;
      this.host.setStatus(`正在上传 ${index}/${compare.push.length}…`);
      if (!action.local) {
        entries.push({
          path: action.path,
          mode: "100644",
          type: "blob",
          sha: null,
        });
        continue;
      }
      const bytes = await this.adapter.readBinary(action.local.path);
      const blobSha = await client.createBlob(bytes);
      entries.push({
        path: action.path,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      });
    }

    const treeSha = await client.createTree(remote.treeSha || undefined, entries);
    const message = renderCommitMessage(
      this.settings.commitMessage,
      this.settings.deviceName
    );
    const commitSha = await client.createCommit(
      message,
      treeSha,
      remote.headSha ? [remote.headSha] : []
    );

    try {
      if (remote.headSha) {
        await client.updateRef(this.settings.branch, commitSha);
      } else {
        await client.createRef(this.settings.branch, commitSha);
      }
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422) {
        throw new Error(
          "远端在你推送前又有了新提交，请先点“拉取”再推送。"
        );
      }
      throw error;
    }

    this.settings.lastSyncCommit = commitSha;
    this.settings.lastSyncTime = Date.now();
    await this.saveCache(local);
    await this.host.save();
    this.host.setStatus("已同步");
    this.host.notify(`推送完成：${entries.length} 个文件。`, 5000);

    return {
      commitSha,
      changed: entries.length,
      upToDate: false,
    };
  }

  async sync(): Promise<SyncResult> {
    const pullResult = await this.pull();
    if (pullResult.conflicts.length) {
      return {
        pull: pullResult,
        conflicts: pullResult.conflicts,
        headSha: pullResult.headSha,
      };
    }

    try {
      const pushResult = await this.push();
      return {
        pull: pullResult,
        push: pushResult,
        conflicts: [],
        headSha: pushResult.commitSha || pullResult.headSha,
      };
    } catch (error) {
      if (error instanceof SyncConflictError) {
        return {
          pull: pullResult,
          conflicts: error.conflicts,
          headSha: error.headSha,
        };
      }
      throw error;
    }
  }

  async resolveConflicts(
    conflicts: Conflict[],
    headSha: string,
    choice: Exclude<ConflictChoice, "cancel">
  ): Promise<void> {
    const client = this.client();

    if (choice === "remote") {
      for (const conflict of conflicts) {
        if (conflict.remoteSha) {
          const remote: RemoteFile = {
            path: conflict.path,
            sha: conflict.remoteSha,
            size: 0,
            mode: "100644",
            type: "blob",
          };
          await this.downloadFile(client, remote);
        } else {
          await this.deleteLocal(conflict.path);
        }
      }
      this.settings.lastSyncCommit = headSha;
      this.settings.lastSyncTime = Date.now();
      await this.saveCache(await this.scanLocal());
      await this.host.save();
      this.host.setStatus("已用远端版本覆盖");
      this.host.notify("已保留远端版本。", 5000);
      await this.push();
      return;
    }

    // Keep local: make the remote head the new base, then push local files.
    this.settings.lastSyncCommit = headSha;
    await this.host.save();
    await this.push();
  }

  private async fetchRemoteState(
    client: GitHubClient
  ): Promise<RemoteState> {
    const ref = await client.getRef(this.settings.branch);
    if (!ref) {
      return {
        headSha: "",
        treeSha: "",
        tree: new Map(),
        baseTree: new Map(),
      };
    }

    const commit = await client.getCommit(ref.object.sha);
    const files = await client.getTree(commit.tree.sha);
    const tree = new Map(files.map((file) => [file.path, file]));

    let baseTree = new Map<string, RemoteFile>();
    if (this.settings.lastSyncCommit) {
      if (this.settings.lastSyncCommit === ref.object.sha) {
        baseTree = tree;
      } else {
        try {
          const baseCommit = await client.getCommit(
            this.settings.lastSyncCommit
          );
          const baseFiles = await client.getTree(baseCommit.tree.sha);
          baseTree = new Map(baseFiles.map((file) => [file.path, file]));
        } catch {
          // The previous commit may have been removed by a force push.
          // Treat it as a first sync rather than blocking the user.
          baseTree = new Map();
        }
      }
    }

    return {
      headSha: ref.object.sha,
      treeSha: commit.tree.sha,
      tree,
      baseTree,
    };
  }

  private async scanLocal(): Promise<Map<string, LocalFile>> {
    const result = new Map<string, LocalFile>();
    const ignore = createIgnoreMatcher(this.settings.ignorePatterns);
    const maxBytes =
      this.settings.maxFileSizeMB > 0
        ? this.settings.maxFileSizeMB * 1024 * 1024
        : Number.POSITIVE_INFINITY;
    const cached = this.data.cache.files || {};

    const walk = async (folder: string): Promise<void> => {
      let listing;
      try {
        listing = await this.adapter.list(folder);
      } catch {
        if (!folder) {
          try {
            listing = await this.adapter.list("/");
          } catch {
            return;
          }
        } else {
          return;
        }
      }

      for (const rawPath of listing.files) {
        const path = normalizePath(rawPath);
        if (!path || ignore(path)) continue;

        const stat = await this.adapter.stat(path);
        if (!stat || stat.type !== "file") continue;

        if (stat.size > maxBytes) {
          throw new Error(
            `文件“${path}”有 ${formatSize(
              stat.size
            )}，超过设置的 ${this.settings.maxFileSizeMB} MB 上限。请把它加入忽略规则，或调高上限。`
          );
        }

        const cachedFile = cached[path];
        let sha: string;
        if (
          cachedFile &&
          cachedFile.mtime === stat.mtime &&
          cachedFile.size === stat.size
        ) {
          sha = cachedFile.sha;
        } else {
          const bytes = await this.adapter.readBinary(path);
          sha = await sha1Blob(bytes);
        }

        result.set(path, {
          path,
          mtime: stat.mtime,
          size: stat.size,
          sha,
        });
      }

      for (const rawFolder of listing.folders) {
        const path = normalizePath(rawFolder);
        if (!path || ignore(path, true)) continue;
        await walk(path);
      }
    };

    await walk("");
    return result;
  }

  private async downloadFile(
    client: GitHubClient,
    remote: RemoteFile
  ): Promise<void> {
    const maxBytes =
      this.settings.maxFileSizeMB > 0
        ? this.settings.maxFileSizeMB * 1024 * 1024
        : Number.POSITIVE_INFINITY;
    if (remote.size > maxBytes) {
      throw new Error(
        `远端文件“${remote.path}”有 ${formatSize(
          remote.size
        )}，超过设置的 ${this.settings.maxFileSizeMB} MB 上限。`
      );
    }
    const bytes = await client.getBlob(remote.sha);
    await ensureFolder(this.adapter, parentPath(remote.path));
    await this.adapter.writeBinary(remote.path, bytes);
  }

  private async deleteLocal(path: string): Promise<void> {
    try {
      await this.adapter.remove(path);
    } catch {
      // The file may already be gone.
    }
    delete this.data.cache.files[path];
  }

  private async saveCache(local: Map<string, LocalFile>): Promise<void> {
    const cache: Record<string, CachedFile> = {};
    for (const [path, file] of local) {
      cache[path] = {
        mtime: file.mtime,
        size: file.size,
        sha: file.sha,
      };
    }
    this.data.cache.files = cache;
    this.data.cache.commit = this.settings.lastSyncCommit;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
