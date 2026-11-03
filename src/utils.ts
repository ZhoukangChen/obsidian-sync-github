import { minimatch } from "minimatch";

export function normalizeRepoInput(input: string): string {
  let value = (input || "").trim();
  if (!value) return "";
  value = value.replace(/^git@github\.com:/i, "");
  value = value.replace(/^https?:\/\/github\.com\//i, "");
  value = value.replace(/^github\.com\//i, "");
  value = value.replace(/\.git$/i, "");
  value = value.replace(/^\/+|\/+$/g, "");
  return value;
}

export function splitRepo(repo: string): { owner: string; repo: string } {
  const normalized = normalizeRepoInput(repo);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("仓库格式应为“用户名/仓库名”，例如 octocat/hello-world");
  }
  return { owner: parts[0], repo: parts[1] };
}

export function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): ArrayBuffer {
  const cleaned = base64.replace(/\s/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function sha1Blob(buffer: ArrayBuffer): Promise<string> {
  const header = new TextEncoder().encode(`blob ${buffer.byteLength}\0`);
  const combined = new Uint8Array(header.length + buffer.byteLength);
  combined.set(header, 0);
  combined.set(new Uint8Array(buffer), header.length);

  const digest = await crypto.subtle.digest("SHA-1", combined);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return "从未同步";
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function renderCommitMessage(
  template: string,
  device: string
): string {
  return (template || "Obsidian Sync: {{device}} {{time}}")
    .replace(/\{\{device\}\}/g, device || "设备")
    .replace(/\{\{time\}\}/g, formatTime(Date.now()));
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function createIgnoreMatcher(patterns: string) {
  const list = (patterns || "")
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#"));

  return (path: string, isDir = false): boolean => {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    return list.some((pattern) => {
      const p = normalizePath(pattern);
      if (isDir && minimatch(normalized + "/", p, { dot: true })) {
        return true;
      }
      return minimatch(normalized, p, { dot: true, matchBase: true });
    });
  };
}

export async function ensureFolder(
  adapter: {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
  },
  folder: string
): Promise<void> {
  const normalized = normalizePath(folder);
  if (!normalized) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

export function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

export function isTextFile(path: string): boolean {
  return /\.(md|markdown|txt|json|canvas|css|js|ts|yml|yaml|html|xml|csv)$/i.test(
    path
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
