import { Notice, Plugin } from "obsidian";
import { ConflictModal } from "./conflict-modal";
import { SimpleVaultSyncSettingTab } from "./settings";
import { SyncConflictError, SyncEngine, SyncHost } from "./sync";
import {
  DEFAULT_DATA,
  DEFAULT_SETTINGS,
  PluginData,
  PluginSettings,
} from "./types";

export default class SimpleVaultSyncPlugin
  extends Plugin
  implements SyncHost
{
  data!: PluginData;
  private engine!: SyncEngine;
  private statusBar!: HTMLElement;
  private token = "";
  private syncing = false;
  private dirty = false;
  private intervalId: number | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.engine = new SyncEngine(this);

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("svs-status");
    this.statusBar.addEventListener("click", () => {
      void this.runSync();
    });

    this.addRibbonIcon("refresh-cw", "Obsidian Sync：立即同步", () => {
      void this.runSync();
    });

    this.addCommand({
      id: "sync-now",
      name: "立即同步",
      callback: () => void this.runSync(),
    });
    this.addCommand({
      id: "pull-now",
      name: "从 GitHub 拉取",
      callback: () => void this.runPull(),
    });
    this.addCommand({
      id: "push-now",
      name: "推送到 GitHub",
      callback: () => void this.runPush(),
    });

    this.addSettingTab(new SimpleVaultSyncSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", () => this.markDirty())
    );
    this.registerEvent(
      this.app.vault.on("create", () => this.markDirty())
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.markDirty())
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.markDirty())
    );

    this.configureInterval();
    this.updateStatus();

    this.app.workspace.onLayoutReady(() => {
      this.updateStatus();
      if (
        this.getSettings().autoPullOnStartup &&
        this.getSettings().repo &&
        this.token
      ) {
        window.setTimeout(() => {
          void this.runPull(true);
        }, 3000);
      }
    });
  }

  onunload(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getSettings(): PluginSettings {
    return this.data.settings;
  }

  getData(): PluginData {
    return this.data;
  }

  getToken(): string {
    return this.token;
  }

  hasToken(): boolean {
    return !!this.token;
  }

  async setToken(token: string): Promise<void> {
    this.token = token.trim();
    const key = this.secretKey();
    if (this.token) {
      this.app.secretStorage.setSecret(key, this.token);
    } else {
      this.app.secretStorage.setSecret(key, "");
    }
    this.updateStatus();
  }

  async save(): Promise<void> {
    await this.saveData(this.data);
  }

  setStatus(text: string, error = false): void {
    if (!this.statusBar) return;
    this.statusBar.setText(`Obsidian Sync：${text}`);
    this.statusBar.classList.toggle("svs-status-error", error);
  }

  notify(message: string, timeout = 5000): void {
    new Notice(message, timeout);
  }

  updateStatus(): void {
    if (!this.getSettings().repo) {
      this.setStatus("未配置");
      return;
    }
    if (!this.token) {
      this.setStatus("未填 Token");
      return;
    }
    if (this.dirty) {
      this.setStatus("有本地改动");
      return;
    }
    this.setStatus(this.getSettings().lastSyncTime ? "已同步" : "就绪");
  }

  configureInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const minutes = this.getSettings().autoSyncInterval;
    if (minutes > 0) {
      this.intervalId = window.setInterval(() => {
        void this.runSync(true);
      }, minutes * 60 * 1000);
    }
  }

  async testConnection(): Promise<string> {
    if (!this.getSettings().repo) {
      throw new Error("请先填写 GitHub 仓库。");
    }
    if (!this.token) {
      throw new Error("请先填写 GitHub Token。");
    }
    return this.engine.testConnection();
  }

  async runSync(silent = false): Promise<void> {
    if (!this.ensureConfigured()) return;
    if (this.syncing) {
      if (!silent) this.notify("正在同步，请稍候。", 3000);
      return;
    }

    this.syncing = true;
    this.setStatus("正在同步…");
    let success = false;

    try {
      const result = await this.engine.sync();
      if (result.conflicts.length) {
        await this.handleConflicts(result.conflicts, result.headSha);
      } else {
        const changed = result.push?.changed || 0;
        success = true;
        this.dirty = false;
        if (!silent) {
          this.notify(
            changed > 0
              ? `同步完成：推送了 ${changed} 个文件。`
              : "同步完成，已经是最新。",
            5000
          );
        }
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.syncing = false;
      if (success) this.dirty = false;
      this.updateStatus();
    }
  }

  async runPull(silent = false): Promise<void> {
    if (!this.ensureConfigured()) return;
    if (this.syncing) {
      if (!silent) this.notify("正在同步，请稍候。", 3000);
      return;
    }

    this.syncing = true;
    this.setStatus("正在拉取…");
    try {
      const result = await this.engine.pull();
      if (result.conflicts.length) {
        await this.handleConflicts(result.conflicts, result.headSha);
      } else {
        this.dirty = result.pendingPush > 0;
        if (!silent) {
          if (result.pendingPush > 0) {
            this.notify(
              `拉取完成：更新 ${result.updated.length} 个，删除 ${result.deleted.length} 个文件。还有 ${result.pendingPush} 个本地改动没有推送。`,
              7000
            );
          } else {
            this.notify(
              result.upToDate
                ? "已经是最新，没有需要拉取的内容。"
                : `拉取完成：更新 ${result.updated.length} 个，删除 ${result.deleted.length} 个文件。`,
              5000
            );
          }
        }
        this.updateStatus();
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.syncing = false;
      this.updateStatus();
    }
  }

  async runPush(silent = false): Promise<void> {
    if (!this.ensureConfigured()) return;
    if (this.syncing) {
      if (!silent) this.notify("正在同步，请稍候。", 3000);
      return;
    }

    this.syncing = true;
    this.setStatus("正在推送…");
    let success = false;
    try {
      const result = await this.engine.push();
      success = true;
      this.dirty = false;
      if (!silent) {
        this.notify(
          result.upToDate
            ? "没有需要推送的改动。"
            : `推送完成：${result.changed} 个文件。`,
          5000
        );
      }
      this.setStatus("已同步");
    } catch (error) {
      if (error instanceof SyncConflictError) {
        await this.handleConflicts(error.conflicts, error.headSha);
      } else {
        this.handleError(error);
      }
    } finally {
      this.syncing = false;
      if (success) this.dirty = false;
      this.updateStatus();
    }
  }

  private async handleConflicts(
    conflicts: Parameters<SyncEngine["resolveConflicts"]>[0],
    headSha: string
  ): Promise<void> {
    const choice = await new ConflictModal(this.app, conflicts).openAndGetChoice();
    if (choice === "cancel") {
      this.dirty = true;
      this.setStatus("有冲突未处理");
      this.notify("已取消，冲突文件没有改动。", 5000);
      return;
    }
    await this.engine.resolveConflicts(conflicts, headSha, choice);
    this.dirty = false;
    this.notify("冲突已处理。", 5000);
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus("同步失败", true);
    this.notify(message, 10000);
    console.error("[Obsidian Sync]", error);
  }

  private ensureConfigured(): boolean {
    if (!this.getSettings().repo) {
      new Notice("请先在插件设置里填写 GitHub 仓库。");
      return false;
    }
    if (!this.token) {
      new Notice("请先在插件设置里填写 GitHub Token。");
      return false;
    }
    return true;
  }

  private markDirty(): void {
    if (this.syncing) return;
    this.dirty = true;
    this.updateStatus();
  }

  private secretKey(): string {
    const name = this.app.vault.getName();
    const cleaned = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    const suffix = Math.abs(hash).toString(36);
    const base = (cleaned || "vault").slice(0, 40);
    return `obsidian-sync-github-${base}-${suffix}`.slice(0, 64);
  }

  private async loadPluginData(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PluginData> | null;
    this.data = {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(loaded?.settings || {}),
      },
      cache: {
        ...DEFAULT_DATA.cache,
        ...(loaded?.cache || {}),
        files: loaded?.cache?.files || {},
      },
    };
    try {
      this.token = this.app.secretStorage.getSecret(this.secretKey()) || "";
    } catch {
      this.token = "";
    }
  }
}
