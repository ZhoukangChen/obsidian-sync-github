import { App, Modal } from "obsidian";
import type { SyncProgress } from "./types";
import { formatBytes } from "./utils";

export class ProgressModal extends Modal {
  private headingEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private pathEl!: HTMLElement;
  private fillEl!: HTMLElement;
  private cancelButton!: HTMLButtonElement;
  private cancelled = false;
  private finished = false;
  private readonly onCancel: () => void;

  constructor(app: App, onCancel: () => void) {
    super(app);
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("osync-progress-modal");

    this.headingEl = contentEl.createEl("h2", { text: "正在同步" });
    this.detailEl = contentEl.createEl("div", {
      cls: "osync-progress-detail",
      text: "正在检查仓库…",
    });

    const track = contentEl.createDiv({ cls: "osync-progress-track" });
    this.fillEl = track.createDiv({ cls: "osync-progress-fill" });

    this.pathEl = contentEl.createDiv({ cls: "osync-progress-path" });

    const footer = contentEl.createDiv({ cls: "osync-progress-footer" });
    this.cancelButton = footer.createEl("button", { text: "取消同步" });
    this.cancelButton.addEventListener("click", () => {
      if (this.finished) {
        this.close();
        return;
      }
      this.cancelled = true;
      this.cancelButton.disabled = true;
      this.cancelButton.setText("正在取消…");
      this.onCancel();
    });
  }

  update(progress: SyncProgress): void {
    if (this.finished) return;

    const phaseText =
      progress.phase === "checking"
        ? "正在检查仓库…"
        : progress.phase === "pulling"
        ? "正在拉取文件"
        : progress.phase === "pushing"
        ? "正在推送文件"
        : "正在完成…";

    const percent =
      progress.total > 0
        ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
        : 0;

    this.headingEl.setText("正在同步");
    this.detailEl.setText(
      `${phaseText}：${progress.completed} / ${progress.total}${
        progress.bytesTotal > 0
          ? ` · ${formatBytes(progress.bytesDone)} / ${formatBytes(
              progress.bytesTotal
            )}`
          : ""
      }`
    );
    this.fillEl.style.width = `${percent}%`;
    this.pathEl.setText(progress.currentPath || "");
    this.pathEl.title = progress.currentPath || "";
  }

  finish(message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.headingEl.setText(message);
    this.detailEl.setText("可以关闭这个窗口了。");
    this.pathEl.setText("");
    this.fillEl.style.width = "100%";
    this.cancelButton.disabled = false;
    this.cancelButton.setText("关闭");
  }

  fail(message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.headingEl.setText("同步失败");
    this.detailEl.setText(message);
    this.pathEl.setText("");
    this.cancelButton.disabled = false;
    this.cancelButton.setText("关闭");
  }

  closeNow(): void {
    this.finished = true;
    this.close();
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onClose(): void {
    if (!this.finished) {
      this.cancelled = true;
      this.onCancel();
    }
    this.contentEl.empty();
  }
}
