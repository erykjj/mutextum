// main.ts

import { Plugin } from "obsidian";
import { MutextumSettingTab, MutextumSettings, DEFAULT_SETTINGS } from "./src/settings";
import { registerFileMenu } from "./src/ui";

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
        registerFileMenu(this);
    }

    onunload(): void {
        // Nothing
    }
}