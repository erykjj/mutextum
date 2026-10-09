// src/settings.ts

import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type MutextumPlugin from "../main";

declare const PLUGIN_VERSION: string;
declare const ANYDOC_VERSION: string;

export interface MutextumSettings {
    destinationFolder: string;
    includeFrontmatter: boolean;
}

export const DEFAULT_SETTINGS: MutextumSettings = {
    destinationFolder: "Imports",
    includeFrontmatter: true,
};

export class MutextumSettingTab extends PluginSettingTab {
    plugin: MutextumPlugin;

    constructor(app: App, plugin: MutextumPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        if (key === "destinationFolder") {
            const trimmed = typeof value === "string" ? value.trim() : "";
            if (trimmed === "") {
                value = DEFAULT_SETTINGS.destinationFolder;
            }
        }

        (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
        await this.plugin.saveSettings();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: "",
                render: (setting) => {
                    setting.settingEl.empty();
                    setting.settingEl.addClass("mutextum-settings-header");

                    const headerEl = setting.settingEl.createDiv();
                    headerEl.createSpan({
                        text: "mu/TEX/tum  ",
                        cls: "mutextum-settings-title",
                    });
                    headerEl.createSpan({
                        text: `v${PLUGIN_VERSION} (anydoc v${ANYDOC_VERSION})`,
                        cls: "mutextum-version-info",
                    });
                },
            },
            {
                type: "group",
                heading: "Output",
                items: [
                    {
                        name: "Destination folder",
                        desc: "Where converted notes are written. Leave blank to use the default (Imports).",
                        control: {
                            type: "folder",
                            key: "destinationFolder",
                            defaultValue: "Imports",
                            validate: (value: string) => {
                                if (value.includes("..")) {
                                    return "Folder path cannot contain '..'.";
                                }
                                return undefined;
                            },
                        },
                    },
                    {
                        name: "Include frontmatter",
                        desc: "Write YAML frontmatter (source and conversion timestamp)",
                        control: {
                            type: "toggle",
                            key: "includeFrontmatter",
                            defaultValue: true,
                        },
                    },
                ],
            },
        ];
    }
}