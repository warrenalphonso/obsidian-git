import { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import simpleGit, { CheckRepoActions, FileStatusResult, SimpleGit } from "simple-git";

enum PluginState {
    idle,
    status,
    pull,
    add,
    commit,
    push,
}
interface ObsidianGitSettings {
    commitMessage: string;
    commitDateFormat: string;
    autoSaveInterval: number;
    autoPullOnBoot: boolean;
    disablePush: boolean;
    disablePopups: boolean;
}
const DEFAULT_SETTINGS: ObsidianGitSettings = {
    commitMessage: "vault backup: {{date}}",
    commitDateFormat: "YYYY-MM-DD HH:mm:ss",
    autoSaveInterval: 0,
    autoPullOnBoot: false,
    disablePush: true,
    disablePopups: false,
};

export default class ObsidianGit extends Plugin {
    git: SimpleGit;
    settings: ObsidianGitSettings;
    statusBar: StatusBar;
    state: PluginState = PluginState.idle;
    intervalID: number;
    lastUpdate: number;

    setState(state: PluginState) {
        this.state = state;
        this.statusBar.display();
    }
    async onload() {
        console.log('loading ' + this.manifest.name + " plugin");
        await this.loadSettings();

        let statusBarEl = this.addStatusBarItem();
        this.statusBar = new StatusBar(statusBarEl, this);
        this.setState(PluginState.idle);
        this.registerInterval(
            window.setInterval(() => this.statusBar.display(), 1000)
        );
        let path: string;
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            path = adapter.getBasePath();
        }

        this.git = simpleGit(path);

        const isValidRepo = await this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);

        if (!isValidRepo) {
            this.displayMessage("Valid git repository not found.", 0);
            return;
        }

        const remote = await this.git.remote([]);

        if (!remote) {
            this.displayMessage("Failed to detect remote.", 0);
            return;
        }

        if (this.settings.autoPullOnBoot) {
            const filesUpdated = await this.pull();

            this.setState(PluginState.idle);
            const message =
                filesUpdated > 0
                    ? `Pulled new changes. ${filesUpdated} files updated`
                    : "Everything up-to-date";
            this.displayMessage(message);
        }

        if (this.settings.autoSaveInterval > 0) {
            this.enableAutoBackup();
        }

        this.addSettingTab(new ObsidianGitSettingsTab(this.app, this));

        this.addCommand({
            id: "pull",
            name: "Pull from remote repository",
            callback: () => this.pullChangesFromRemote(),
        });

        this.addCommand({
            id: "push",
            name: "Commit *all* changes and push to remote repository",
            callback: async () => {
                const changedFiles = await this.getFilesChanged();

                if (!changedFiles.length) {
                    this.displayMessage("No changes detected");
                    this.setState(PluginState.idle);
                    return;
                }
                await this.createBackup();
            }
        });
    }
    async onunload() {
        console.log('unloading ' + this.manifest.name + " plugin");
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }

    async pullChangesFromRemote() {
        await this.pull().then((filesUpdated) => {
            if (filesUpdated > 0) {
                this.displayMessage(
                    `Pulled new changes. ${filesUpdated} files updated`
                );
            } else {
                this.displayMessage("Everything is up-to-date");
            }
        });

        this.lastUpdate = Date.now();
        this.setState(PluginState.idle);
    }

    async createBackup() {
        const changedFiles = await this.getFilesChanged();

        if (changedFiles.length === 0) {
            this.setState(PluginState.idle);
            return;
        }

        await this.add();
        await this.commit();
        this.displayMessage(`Committed ${changedFiles.length} files`);

        if (!this.settings.disablePush) {
            await this.push();
            this.displayMessage(`Pushed ${changedFiles.length} files to remote`);
        }

        this.lastUpdate = Date.now();
        this.setState(PluginState.idle);
    }



    // region: main methods
    async getFilesChanged(): Promise<FileStatusResult[]> {
        this.setState(PluginState.status);
        const status = await this.git.status();
        return status.files;
    }

    async add(): Promise<void> {
        this.setState(PluginState.add);
        await this.git.add(
            "./*",
            (err: Error | null) =>
                err && this.displayError(`Cannot add files: ${err.message}`)
        );
    }

    async commit(): Promise<void> {
        this.setState(PluginState.commit);
        const commitMessage = await this.formatCommitMessage(this.settings.commitMessage);
        await this.git.commit(commitMessage);
    }

    async push(): Promise<void> {
        this.setState(PluginState.push);
        await this.git.push(
            this.settings.remote,
            this.settings.currentBranch,
            null,
            (err: Error | null) => {
                err && this.displayError(`Push failed ${err.message}`);
            }
        );

        this.lastUpdate = Date.now();
    }

    async pull(): Promise<number> {
        this.setState(PluginState.pull);
        const pullResult = await this.git.pull(
            null,
            null,
            null,
            (err: Error | null) =>
                err && this.displayError(`Pull failed ${err.message}`)
        );
        this.lastUpdate = Date.now();
        return pullResult.files.length;
    }

    // endregion: main methods

    enableAutoBackup() {
        const minutes = this.settings.autoSaveInterval;
        this.intervalID = window.setInterval(
            async () => await this.createBackup(),
            minutes * 60000
        );
        this.registerInterval(this.intervalID);
    }

    disableAutoBackup(): boolean {
        if (this.intervalID) {
            clearInterval(this.intervalID);
            return true;
        }

        return false;
    }

    // region: displaying / formatting messages
    displayMessage(message: string, timeout: number = 4 * 1000): void {
        this.statusBar.displayMessage(message.toLowerCase(), timeout);

        if (!this.settings.disablePopups) {
            new Notice(message);
        }

        console.log(`git obsidian: ${message}`);
    }
    displayError(message: string, timeout: number = 0): void {
        new Notice(message);
        this.statusBar.displayMessage(message.toLowerCase(), timeout);
    }

    async formatCommitMessage(template: string): Promise<string> {
        if (template.includes("{{numFiles}}")) {
            let status = await this.git.status();
            let numFiles = status.files.length;
            template = template.replace("{{numFiles}}", String(numFiles));
        }

        if (template.includes("{{files}}")) {
            let status = await this.git.status();

            let changeset: { [key: string]: string[]; } = {};
            status.files.forEach((value: FileStatusResult) => {
                if (value.index in changeset) {
                    changeset[value.index].push(value.path);
                } else {
                    changeset[value.index] = [value.path];
                }
            });

            let chunks = [];
            for (let [action, files] of Object.entries(changeset)) {
                chunks.push(action + " " + files.join(" "));
            }

            let files = chunks.join(", ");

            template = template.replace("{{files}}", files);
        }

        let moment = (window as any).moment;
        return template.replace(
            "{{date}}",
            moment().format(this.settings.commitDateFormat)
        );
    }

    // endregion: displaying / formatting stuff
}


class ObsidianGitSettingsTab extends PluginSettingTab {
    display(): void {
        let { containerEl } = this;
        const plugin: ObsidianGit = (this as any).plugin;

        containerEl.empty();
        containerEl.createEl("h2", { text: "Git Backup settings" });

        new Setting(containerEl)
            .setName("Vault backup interval (minutes)")
            .setDesc(
                "Commit and push changes every X minutes. To disable automatic backup, specify negative value or zero (default)"
            )
            .addText((text) =>
                text
                    .setValue(String(plugin.settings.autoSaveInterval))
                    .onChange((value) => {
                        if (!isNaN(Number(value))) {
                            plugin.settings.autoSaveInterval = Number(value);
                            plugin.saveSettings();

                            if (plugin.settings.autoSaveInterval > 0) {
                                plugin.disableAutoBackup(); // call clearInterval() before setting up a new one
                                plugin.enableAutoBackup();
                                new Notice(
                                    `Automatic backup enabled! Every ${plugin.settings.autoSaveInterval} minutes.`
                                );
                            } else if (
                                plugin.settings.autoSaveInterval <= 0 &&
                                plugin.intervalID
                            ) {
                                plugin.disableAutoBackup() &&
                                    new Notice("Automatic backup disabled!");
                            }
                        } else {
                            new Notice("Please specify a valid number.");
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Commit message")
            .setDesc(
                "Specify custom commit message. Available placeholders: {{date}}" +
                " (see below) and {{numFiles}} (number of changed files in the commit)"
            )
            .addText((text) =>
                text
                    .setPlaceholder("vault backup")
                    .setValue(
                        plugin.settings.commitMessage
                            ? plugin.settings.commitMessage
                            : ""
                    )
                    .onChange((value) => {
                        plugin.settings.commitMessage = value;
                        plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("{{date}} placeholder format")
            .setDesc('Specify custom date format. E.g. "YYYY-MM-DD HH:mm:ss"')
            .addText((text) =>
                text
                    .setPlaceholder(plugin.settings.commitDateFormat)
                    .setValue(plugin.settings.commitDateFormat)
                    .onChange(async (value) => {
                        plugin.settings.commitDateFormat = value;
                        await plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Preview commit message")
            .addButton((button) =>
                button.setButtonText("Preview").onClick(async () => {
                    let commitMessagePreview = await plugin.formatCommitMessage(
                        plugin.settings.commitMessage
                    );
                    new Notice(`${commitMessagePreview}`);
                })
            );

        new Setting(containerEl)
            .setName("Current branch")
            .setDesc("Switch to a different branch")
            .addDropdown(async (dropdown) => {
                const branchInfo = await plugin.git.branchLocal();
                for (const branch of branchInfo.all) {
                    dropdown.addOption(branch, branch);
                }
                dropdown.setValue(branchInfo.current);
                dropdown.onChange(async (option) => {
                    await plugin.git.checkout(
                        option,
                        [],
                        async (err: Error) => {
                            if (err) {
                                new Notice(err.message);
                                dropdown.setValue(branchInfo.current);
                            } else {
                                new Notice(`Checked out to ${option}`);
                            }
                        }
                    );
                });
            });

        new Setting(containerEl)
            .setName("Pull updates on startup")
            .setDesc("Automatically pull updates when Obsidian starts")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.autoPullOnBoot)
                    .onChange((value) => {
                        plugin.settings.autoPullOnBoot = value;
                        plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Disable push")
            .setDesc("Do not push changes to the remote repository")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.disablePush)
                    .onChange((value) => {
                        plugin.settings.disablePush = value;
                        plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Disable notifications")
            .setDesc(
                "Disable notifications for git operations to minimize distraction (refer to status bar for updates)"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.disablePopups)
                    .onChange((value) => {
                        plugin.settings.disablePopups = value;
                        plugin.saveSettings();
                    })
            );
    }
}

interface StatusBarMessage {
    message: string;
    timeout: number;
}

class StatusBar {
    public messages: StatusBarMessage[] = [];
    public currentMessage: StatusBarMessage;
    public lastMessageTimestamp: number;

    private statusBarEl: HTMLElement;
    private plugin: ObsidianGit;

    constructor(statusBarEl: HTMLElement, plugin: ObsidianGit) {
        this.statusBarEl = statusBarEl;
        this.plugin = plugin;
    }

    public displayMessage(message: string, timeout: number) {
        this.messages.push({
            message: `git: ${message.slice(0, 100)}`,
            timeout: timeout,
        });
        this.display();
    }

    public display() {
        if (this.messages.length > 0 && !this.currentMessage) {
            this.currentMessage = this.messages.shift();
            this.statusBarEl.setText(this.currentMessage.message);
            this.lastMessageTimestamp = Date.now();
        } else if (this.currentMessage) {
            let messageAge = Date.now() - this.lastMessageTimestamp;
            if (messageAge >= this.currentMessage.timeout) {
                this.currentMessage = null;
                this.lastMessageTimestamp = null;
            }
        } else {
            this.displayState();
        }
    }

    private displayState() {
        switch (this.plugin.state) {
            case PluginState.idle:
                this.displayFromNow(this.plugin.lastUpdate);
                break;
            case PluginState.status:
                this.statusBarEl.setText("git: checking repo status..");
                break;
            case PluginState.add:
                this.statusBarEl.setText("git: adding files to repo..");
                break;
            case PluginState.commit:
                this.statusBarEl.setText("git: committing changes..");
                break;
            case PluginState.push:
                this.statusBarEl.setText("git: pushing changes..");
                break;
            case PluginState.pull:
                this.statusBarEl.setText("git: pulling changes..");
                break;
        }
    }

    private displayFromNow(timestamp: number): void {
        if (timestamp) {
            let moment = (window as any).moment;
            let fromNow = moment(timestamp).fromNow();
            this.statusBarEl.setText(`git: last update ${fromNow}..`);
        } else {
            this.statusBarEl.setText(`git: ready`);
        }
    }
}
