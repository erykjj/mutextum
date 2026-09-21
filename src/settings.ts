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
                        text: "mu/TEX/tum",
                        cls: "mutextum-settings-title",
                    });
                    headerEl.createSpan({
                        text: `   v${PLUGIN_VERSION} \u2013 anydoc v${ANYDOC_VERSION}`,
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
                        desc: "Where converted notes are written",
                        control: {
                            type: "folder",
                            key: "destinationFolder",
                            defaultValue: "Imports",
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
            {
                name: "",
                render: (setting) => {
                    setting.settingEl.empty();
                    setting.settingEl.addClass("mutextum-settings-footer");

                    const footerEl = setting.settingEl.createDiv();
                    footerEl.appendChild(
                        document.createTextNode("My other Obsidian plugins: ")
                    );

                    const conversumStrong = footerEl.createEl("strong");
                    const conversumLink = conversumStrong.createEl("a", {
                        text: "con[VER]sum",
                        href: "https://github.com/erykjj/conversum",
                    });
                    conversumLink.setAttribute("target", "_blank");
                    conversumLink.setAttribute("rel", "noopener noreferrer");
                    footerEl.appendChild(document.createTextNode(", "));

                    const inrefensStrong = footerEl.createEl("strong");
                    const inrefensLink = inrefensStrong.createEl("a", {
                        text: "in(REF)ens",
                        href: "https://github.com/erykjj/inrefens",
                    });
                    inrefensLink.setAttribute("target", "_blank");
                    inrefensLink.setAttribute("rel", "noopener noreferrer");
                    footerEl.appendChild(document.createTextNode(", "));

                    const travertureStrong = footerEl.createEl("strong");
                    const travertureLink = travertureStrong.createEl("a", {
                        text: "tra.VER:ture",
                        href: "https://github.com/erykjj/traverture",
                    });
                    travertureLink.setAttribute("target", "_blank");
                    travertureLink.setAttribute("rel", "noopener noreferrer");

                },
            },
        ];
    }
}