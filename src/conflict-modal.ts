import { App, Modal } from "obsidian";
import type { Conflict, ConflictChoice } from "./types";

export class ConflictModal extends Modal {
  private readonly conflicts: Conflict[];
  private resolveChoice: ((choice: ConflictChoice) => void) | null = null;
  private resolved = false;

  constructor(app: App, conflicts: Conflict[]) {
    super(app);
    this.conflicts = conflicts;
  }

  openAndGetChoice(): Promise<ConflictChoice> {
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("svs-conflict-modal");
    contentEl.createEl("h2", { text: "发现冲突" });

    contentEl.createEl("p", {
      text: `有 ${this.conflicts.length} 个文件在本地和远端都被修改过。请选择这次要保留哪一边：`,
    });

    const list = contentEl.createDiv({ cls: "svs-conflict-list" });
    for (const conflict of this.conflicts.slice(0, 30)) {
      const item = list.createDiv({ cls: "svs-conflict-item" });
      item.createSpan({ text: conflict.path });
      const detail = item.createSpan({ cls: "svs-conflict-detail" });
      if (!conflict.localSha) detail.setText("本地已删除");
      else if (!conflict.remoteSha) detail.setText("远端已删除");
      else detail.setText("两边都修改了");
    }
    if (this.conflicts.length > 30) {
      list.createDiv({
        cls: "svs-conflict-more",
        text: `……还有 ${this.conflicts.length - 30} 个文件`,
      });
    }

    const buttons = contentEl.createDiv({ cls: "svs-conflict-buttons" });
    const localButton = buttons.createEl("button", {
      text: "保留本地，覆盖远端",
      cls: "mod-warning",
    });
    localButton.addEventListener("click", () => this.finish("local"));

    const remoteButton = buttons.createEl("button", {
      text: "保留远端，覆盖本地",
    });
    remoteButton.addEventListener("click", () => this.finish("remote"));

    const cancelButton = buttons.createEl("button", { text: "取消" });
    cancelButton.addEventListener("click", () => this.finish("cancel"));
  }

  private finish(choice: ConflictChoice): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveChoice?.(choice);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.resolveChoice?.("cancel");
    }
    this.contentEl.empty();
  }
}
