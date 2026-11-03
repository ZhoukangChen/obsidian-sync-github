import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SimpleVaultSyncPlugin from "./main";
import { formatTime, normalizeRepoInput } from "./utils";

export class SimpleVaultSyncSettingTab extends PluginSettingTab {
  plugin: SimpleVaultSyncPlugin;
  private pendingToken = "";

  constructor(app: App, plugin: SimpleVaultSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("svs-settings");

    containerEl.createEl("h2", { text: "Obsidian Sync设置" });
    containerEl.createEl("p", {
      cls: "svs-help",
      text: "用 GitHub 仓库同步这个 vault。插件不需要 Git 命令，也不会修改 .git 目录。",
    });

    new Setting(containerEl)
      .setName("GitHub 仓库")
      .setDesc("格式：用户名/仓库名，例如 octocat/my-notes。")
      .addText((text) =>
        text
          .setPlaceholder("用户名/仓库名")
          .setValue(this.plugin.getSettings().repo)
          .onChange(async (value) => {
            this.plugin.getSettings().repo = normalizeRepoInput(value);
            await this.plugin.save();
            this.restoreStatus();
          })
      );

    new Setting(containerEl)
      .setName("分支")
      .setDesc("通常是 main；如果你的仓库用 master，就填 master。")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.getSettings().branch)
          .onChange(async (value) => {
            this.plugin.getSettings().branch = value.trim() || "main";
            await this.plugin.save();
            this.restoreStatus();
          })
      );

    const tokenSetting = new Setting(containerEl)
      .setName("GitHub Token")
      .setDesc(
        "需要 Fine-grained Token，权限：Contents 读写、Metadata 只读。Token 保存在 Obsidian 的 SecretStorage 里，不会写进笔记。"
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(
          this.plugin.hasToken() ? "已保存，留空表示不修改" : "github_pat_..."
        );
        text.onChange((value) => {
          this.pendingToken = value.trim();
        });
      })
      .addButton((button) =>
        button.setButtonText("保存").onClick(async () => {
          if (!this.pendingToken) {
            new Notice("请先填写 Token。");
            return;
          }
          await this.plugin.setToken(this.pendingToken);
          this.pendingToken = "";
          new Notice("Token 已保存。");
          this.display();
        })
      )
      .addButton((button) =>
        button.setButtonText("清除").onClick(async () => {
          await this.plugin.setToken("");
          this.pendingToken = "";
          new Notice("Token 已清除。");
          this.display();
        })
      );

    tokenSetting.descEl.createEl("br");
    tokenSetting.descEl.createEl("a", {
      text: "打开 GitHub 创建 Fine-grained Token",
      href: "https://github.com/settings/tokens?type=beta",
      attr: { target: "_blank", rel: "noopener" },
    });

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("检查仓库、分支和 Token 权限是否正常。")
      .addButton((button) =>
        button.setButtonText("测试").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("测试中…");
          try {
            const message = await this.plugin.testConnection();
            new Notice(message, 8000);
          } catch (error) {
            new Notice(
              error instanceof Error ? error.message : String(error),
              10000
            );
          } finally {
            button.setDisabled(false);
            button.setButtonText("测试");
          }
        })
      );

    containerEl.createEl("h3", { text: "同步选项" });

    new Setting(containerEl)
      .setName("启动时拉取")
      .setDesc("打开 Obsidian 后自动从 GitHub 拉取一次。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().autoPullOnStartup)
          .onChange(async (value) => {
            this.plugin.getSettings().autoPullOnStartup = value;
            await this.plugin.save();
          })
      );

    new Setting(containerEl)
      .setName("自动同步间隔")
      .setDesc("单位：分钟。0 表示关闭。iOS 上后台定时不保证准时，建议配合手动同步。")
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.getSettings().autoSyncInterval))
          .onChange(async (value) => {
            const minutes = Math.max(0, Math.floor(Number(value) || 0));
            this.plugin.getSettings().autoSyncInterval = minutes;
            await this.plugin.save();
            this.plugin.configureInterval();
          })
      );

    new Setting(containerEl)
      .setName("单文件大小上限")
      .setDesc("单位：MB。0 表示不限制。超过上限的文件会阻止同步，避免误删。")
      .addText((text) =>
        text
          .setPlaceholder("50")
          .setValue(String(this.plugin.getSettings().maxFileSizeMB))
          .onChange(async (value) => {
            const size = Math.max(0, Number(value) || 0);
            this.plugin.getSettings().maxFileSizeMB = size;
            await this.plugin.save();
          })
      );

    new Setting(containerEl)
      .setName("设备名")
      .setDesc("会写进提交信息，方便区分是哪台设备同步的。")
      .addText((text) =>
        text
          .setPlaceholder("iPad")
          .setValue(this.plugin.getSettings().deviceName)
          .onChange(async (value) => {
            this.plugin.getSettings().deviceName = value.trim() || "设备";
            await this.plugin.save();
          })
      );

    new Setting(containerEl)
      .setName("提交信息")
      .setDesc("支持 {{device}} 和 {{time}} 两个占位符。")
      .addText((text) =>
        text
          .setPlaceholder("Obsidian Sync: {{device}} {{time}}")
          .setValue(this.plugin.getSettings().commitMessage)
          .onChange(async (value) => {
            this.plugin.getSettings().commitMessage =
              value.trim() || "Obsidian Sync: {{device}} {{time}}";
            await this.plugin.save();
          })
      );

    new Setting(containerEl)
      .setName("忽略规则")
      .setDesc(
        "每行一个 glob。默认排除 workspace、回收站和本插件自己的配置。不要删除 .obsidian/plugins/obsidian-sync-github/**，否则 Token 所在的 data.json 可能被同步。"
      )
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.addClass("svs-ignore-input");
        text
          .setValue(this.plugin.getSettings().ignorePatterns)
          .onChange(async (value) => {
            this.plugin.getSettings().ignorePatterns = value;
            await this.plugin.save();
          });
      });

    containerEl.createEl("h3", { text: "手动操作" });

    new Setting(containerEl)
      .setName("立即同步")
      .setDesc("先拉取远端，再推送本地改动。")
      .addButton((button) =>
        button
          .setButtonText("同步")
          .setCta()
          .onClick(() => {
            button.setDisabled(true);
            void this.plugin.runSync().finally(() => button.setDisabled(false));
          })
      );

    new Setting(containerEl)
      .setName("只拉取 / 只推送")
      .setDesc("需要单独控制时使用。")
      .addButton((button) =>
        button.setButtonText("拉取").onClick(() => {
          void this.plugin.runPull();
        })
      )
      .addButton((button) =>
        button.setButtonText("推送").onClick(() => {
          void this.plugin.runPush();
        })
      );

    const status = containerEl.createDiv({ cls: "svs-status-box" });
    status.createEl("div", {
      text: `上次同步：${formatTime(this.plugin.getSettings().lastSyncTime)}`,
    });
    if (this.plugin.getSettings().lastSyncCommit) {
      status.createEl("div", {
        text: `上次提交：${this.plugin.getSettings().lastSyncCommit.slice(0, 10)}`,
      });
    }
    status.createEl("div", {
      cls: "svs-help",
      text: "提示：GitHub 只保存你主动同步的内容。关闭 Obsidian 前，建议点一次“同步”。",
    });
  }

  private restoreStatus(): void {
    this.plugin.updateStatus();
  }
}
