import { requestUrl } from "obsidian";
import type { RemoteFile, RepoInfo } from "./types";
import { decodeBase64, encodeBase64, splitRepo } from "./utils";

const API_BASE = "https://api.github.com";

export class GitHubError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

interface GitHubRef {
  object: {
    sha: string;
  };
}

interface GitHubCommit {
  sha: string;
  tree: {
    sha: string;
  };
  parents: Array<{ sha: string }>;
}

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

interface GitHubTree {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated?: boolean;
}

export class GitHubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;

  constructor(repoInput: string, token: string) {
    const parsed = splitRepo(repoInput);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
    this.token = token;
  }

  private get repoPath(): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(
      this.repo
    )}`;
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      allow404?: boolean;
    } = {}
  ): Promise<T | null> {
    const method = options.method || "GET";
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "obsidian-sync-github",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response;
    try {
      response = await requestUrl({
        url: `${API_BASE}${path}`,
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        throw: false,
      });
    } catch (error) {
      throw new GitHubError(
        `无法连接 GitHub：${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (response.status >= 200 && response.status < 300) {
      if (response.status === 204) return null as T;
      try {
        return response.json as T;
      } catch {
        return null as T;
      }
    }

    if (options.allow404 && response.status === 404) {
      return null;
    }

    let message = "";
    try {
      const parsed = response.json;
      message = parsed?.message || "";
    } catch {
      try {
        message = response.text || "";
      } catch {
        message = "";
      }
    }

    if (response.status === 401) {
      throw new GitHubError(
        "GitHub Token 无效或已过期。请在设置里重新填写 Token。",
        401
      );
    }
    if (response.status === 403) {
      const remaining = response.headers?.["x-ratelimit-remaining"];
      if (remaining === "0") {
        const reset = response.headers?.["x-ratelimit-reset"];
        const time = reset
          ? new Date(Number(reset) * 1000).toLocaleTimeString()
          : "稍后";
        throw new GitHubError(
          `GitHub API 请求次数已用完，将于 ${time} 恢复。请稍后再试。`,
          403
        );
      }
      throw new GitHubError(
        `没有权限执行这个操作。请确认 Token 对此仓库有 Contents 读写权限。${
          message ? `（${message}）` : ""
        }`,
        403
      );
    }
    if (response.status === 404) {
      throw new GitHubError(
        `找不到仓库或分支。请确认仓库名、分支名和 Token 权限。${
          message ? `（${message}）` : ""
        }`,
        404
      );
    }
    if (response.status === 409 || response.status === 422) {
      throw new GitHubError(
        `远端仓库已经变化，请先拉取再推送。${
          message ? `（${message}）` : ""
        }`,
        response.status
      );
    }
    if (response.status === 413) {
      throw new GitHubError(
        "文件太大，GitHub 拒绝了这次提交。请把大文件移出同步范围。",
        413
      );
    }

    throw new GitHubError(
      `GitHub API 错误（${response.status}）：${message || "未知错误"}`,
      response.status
    );
  }

  async getRepo(): Promise<RepoInfo> {
    const data = await this.request<{
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
      permissions?: RepoInfo["permissions"];
    }>(this.repoPath);

    if (!data) {
      throw new GitHubError("无法读取仓库信息。");
    }

    return {
      owner: this.owner,
      repo: this.repo,
      defaultBranch: data.default_branch,
      private: data.private,
      permissions: data.permissions,
    };
  }

  async getRef(branch: string): Promise<GitHubRef | null> {
    return this.request<GitHubRef>(
      `${this.repoPath}/git/ref/heads/${encodeBranch(branch)}`,
      { allow404: true }
    );
  }

  async getCommit(sha: string): Promise<GitHubCommit> {
    const data = await this.request<GitHubCommit>(
      `${this.repoPath}/git/commits/${sha}`
    );
    if (!data) throw new GitHubError("无法读取提交信息。");
    return data;
  }

  async getTree(treeSha: string): Promise<RemoteFile[]> {
    const first = await this.request<GitHubTree>(
      `${this.repoPath}/git/trees/${treeSha}?recursive=1`
    );
    if (!first) throw new GitHubError("无法读取仓库文件树。");

    if (!first.truncated) {
      return first.tree.filter(isBlob).map(toRemoteFile);
    }

    const result: RemoteFile[] = [];
    const walked = new Set<string>();

    const walk = async (sha: string): Promise<void> => {
      if (walked.has(sha)) return;
      walked.add(sha);
      const tree = await this.request<GitHubTree>(
        `${this.repoPath}/git/trees/${sha}`
      );
      if (!tree) return;
      for (const entry of tree.tree) {
        if (entry.type === "blob") {
          result.push(toRemoteFile(entry));
        } else if (entry.type === "tree") {
          await walk(entry.sha);
        }
      }
    };

    await walk(treeSha);
    return result;
  }

  async getBlob(sha: string): Promise<ArrayBuffer> {
    const data = await this.request<{ content: string; encoding: string }>(
      `${this.repoPath}/git/blobs/${sha}`
    );
    if (!data) throw new GitHubError("无法读取文件内容。");
    return decodeBase64(data.content);
  }

  async createBlob(data: ArrayBuffer): Promise<string> {
    const result = await this.request<{ sha: string }>(
      `${this.repoPath}/git/blobs`,
      {
        method: "POST",
        body: {
          content: encodeBase64(data),
          encoding: "base64",
        },
      }
    );
    if (!result?.sha) throw new GitHubError("创建 blob 失败。");
    return result.sha;
  }

  async createTree(
    baseTree: string | undefined,
    entries: Array<{
      path: string;
      mode: string;
      type: "blob";
      sha: string | null;
    }>
  ): Promise<string> {
    const body: Record<string, unknown> = { tree: entries };
    if (baseTree) body.base_tree = baseTree;
    const result = await this.request<{ sha: string }>(
      `${this.repoPath}/git/trees`,
      { method: "POST", body }
    );
    if (!result?.sha) throw new GitHubError("创建 tree 失败。");
    return result.sha;
  }

  async createCommit(
    message: string,
    tree: string,
    parents: string[]
  ): Promise<string> {
    const result = await this.request<{ sha: string }>(
      `${this.repoPath}/git/commits`,
      {
        method: "POST",
        body: { message, tree, parents },
      }
    );
    if (!result?.sha) throw new GitHubError("创建 commit 失败。");
    return result.sha;
  }

  async createRef(branch: string, sha: string): Promise<void> {
    await this.request(`${this.repoPath}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha },
    });
  }

  async updateRef(
    branch: string,
    sha: string,
    force = false
  ): Promise<void> {
    await this.request(
      `${this.repoPath}/git/refs/heads/${encodeBranch(branch)}`,
      {
        method: "PATCH",
        body: { sha, force },
      }
    );
  }

  async testConnection(): Promise<RepoInfo> {
    const info = await this.getRepo();
    if (info.permissions && info.permissions.push === false) {
      throw new GitHubError(
        "能读取仓库，但当前 Token 没有写入权限。请给 Contents 读写权限。",
        403
      );
    }
    return info;
  }
}

function encodeBranch(branch: string): string {
  return branch
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isBlob(entry: GitHubTreeEntry): boolean {
  return entry.type === "blob";
}

function toRemoteFile(entry: GitHubTreeEntry): RemoteFile {
  return {
    path: entry.path,
    sha: entry.sha,
    size: entry.size || 0,
    mode: entry.mode,
    type: "blob",
  };
}
