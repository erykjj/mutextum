// main.ts

import { Plugin, WorkspaceLeaf } from "obsidian";
import { MutextumSettingTab, MutextumSettings, DEFAULT_SETTINGS } from "./src/settings";
import { MutextumPanel, VIEW_TYPE_MUTEXTUM } from "./src/panel";

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
        await this.loadSettings();

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
    }

    async activateView(): Promise<void> {
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
        }
    }

    onunload(): void {
        // Nothing
    }
}