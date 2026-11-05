// main.ts

import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import { MutextumSettingTab, MutextumSettings, DEFAULT_SETTINGS } from "./src/settings";
import { MutextumPanel, VIEW_TYPE_MUTEXTUM } from "./src/panel";
import { SUPPORTED_EXTENSIONS } from "./src/ui";

export default class MutextumPlugin extends Plugin {
    settings: MutextumSettings = DEFAULT_SETTINGS;

    async loadSettings(): Promise<void> {
        const saved = (await this.loadData()) as Partial<MutextumSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async onload(): Promise<void> {
        this.addSettingTab(new MutextumSettingTab(this.app, this));

        this.registerView(
            VIEW_TYPE_MUTEXTUM,
            (leaf) => new MutextumPanel(leaf, this)
        );

        this.addRibbonIcon("file-symlink", "mu/TEX/tum: Import", () => {
            void this.activateView();
        });

        this.addCommand({
            id: "open-panel",
            name: "Open Import Panel",
            callback: () => {
                void this.activateView();
            }
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!(file instanceof TFile)) return;
                if (!SUPPORTED_EXTENSIONS.includes(file.extension.toLowerCase())) return;
                menu.addItem((item) =>
                    item
                        .setTitle("Queue in mu/TEX/tum")
                        .setIcon("file-symlink")
                        .onClick(async () => {
                            const view = await this.activateView();
                            view?.addVaultFile(file);
                        })
                );
            })
        );

        this.detachRestoredLeaves();
        this.app.workspace.onLayoutReady(() => {
            this.detachRestoredLeaves();
            void this.loadSettings();
        });
    }

    private detachRestoredLeaves(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MUTEXTUM)) {
            leaf.detach();
        }
    }

    async activateView(): Promise<MutextumPanel | null> {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_MUTEXTUM);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf(true);
            await leaf.setViewState({ type: VIEW_TYPE_MUTEXTUM, active: true });
        }

        if (leaf) {
            await workspace.revealLeaf(leaf);
            return leaf.view instanceof MutextumPanel ? leaf.view : null;
        }

        return null;
    }

    onunload(): void { }
}