export interface CachedFile {
  mtime: number;
  size: number;
  sha: string;
}

export interface PluginSettings {
  repo: string;
  branch: string;
  autoPullOnStartup: boolean;
  autoSyncInterval: number;
  ignorePatterns: string;
  maxFileSizeMB: number;
  commitMessage: string;
  deviceName: string;
  lastSyncCommit: string;
  lastSyncTime: number;
}

export interface PluginData {
  settings: PluginSettings;
  cache: {
    commit: string;
    files: Record<string, CachedFile>;
  };
}

export const DEFAULT_IGNORE_PATTERNS = [
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/plugins/simple-vault-sync/**",
  ".obsidian/plugins/*/data.json",
  ".trash/**",
  ".git/**",
  ".DS_Store",
  "**/.DS_Store",
].join("\n");

export const DEFAULT_SETTINGS: PluginSettings = {
  repo: "",
  branch: "main",
  autoPullOnStartup: true,
  autoSyncInterval: 0,
  ignorePatterns: DEFAULT_IGNORE_PATTERNS,
  maxFileSizeMB: 50,
  commitMessage: "简同步: {{device}} {{time}}",
  deviceName: "iPad",
  lastSyncCommit: "",
  lastSyncTime: 0,
};

export const DEFAULT_DATA: PluginData = {
  settings: DEFAULT_SETTINGS,
  cache: {
    commit: "",
    files: {},
  },
};

export interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

export interface RemoteFile {
  path: string;
  sha: string;
  size: number;
  mode: string;
  type: "blob" | "tree" | "commit";
}

export interface LocalFile {
  path: string;
  mtime: number;
  size: number;
  sha: string;
}

export type FileState = string | null;

export interface Conflict {
  path: string;
  localSha: string | null;
  remoteSha: string | null;
  baseSha: string | null;
}

export type ConflictChoice = "local" | "remote" | "cancel";

export interface PullResult {
  headSha: string;
  updated: string[];
  deleted: string[];
  conflicts: Conflict[];
  pendingPush: number;
  upToDate: boolean;
}

export interface PushResult {
  commitSha: string;
  changed: number;
  upToDate: boolean;
}

export interface SyncResult {
  pull: PullResult;
  push?: PushResult;
  conflicts: Conflict[];
  headSha: string;
}

export interface RemoteState {
  headSha: string;
  treeSha: string;
  tree: Map<string, RemoteFile>;
  baseTree: Map<string, RemoteFile>;
}
