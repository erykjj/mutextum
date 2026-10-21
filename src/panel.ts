// src/panel.ts

import { App, ItemView, WorkspaceLeaf, TFile, Notice, FuzzySuggestModal, setIcon } from "obsidian";
import { convertBytes } from "./converter";
import type MutextumPlugin from "../main";
import { writeOutputFromPanel, SUPPORTED_EXTENSIONS } from "./ui";

export const VIEW_TYPE_MUTEXTUM = "mutextum-panel";

// ──────────────────────────────────────────────
// Queue item
// ──────────────────────────────────────────────

interface QueueItem {
    fileName: string;
    basename: string;
    vaultFile: TFile | null;
    bytes: Uint8Array | null;
}

// ──────────────────────────────────────────────
// Vault file picker
// ──────────────────────────────────────────────

class FilePickerModal extends FuzzySuggestModal<TFile> {
    private onChoose: (file: TFile) => void;

    constructor(app: App, onChoose: (file: TFile) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("Select a document to import\u2026");
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter((f) =>
            SUPPORTED_EXTENSIONS.includes(f.extension.toLowerCase())
        );
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onChoose(file);
    }
}

// ──────────────────────────────────────────────
// Panel view
// ──────────────────────────────────────────────

export class MutextumPanel extends ItemView {
    plugin: MutextumPlugin;

    private queue: QueueItem[] = [];
    private isConverting = false;

    private listEl!: HTMLElement;
    private progressBar!: HTMLProgressElement;
    private statusEl!: HTMLElement;
    private convertBtn!: HTMLButtonElement;
    private browseBtn!: HTMLButtonElement;
    private destFolderInput!: HTMLInputElement;
    private includeFmToggle!: HTMLInputElement;

    constructor(leaf: WorkspaceLeaf, plugin: MutextumPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_MUTEXTUM; }
    getDisplayText(): string { return "mu/TEX/tum"; }
    getIcon(): string { return "file-symlink"; }

    async onOpen(): Promise<void> {
        const container = this.contentEl;
        container.empty();
        container.addClass("mutextum-panel");

        const dropZone = container.createDiv({ cls: "mutextum-dropzone" });
        dropZone.createEl("p", { text: "Drag documents here" });
        dropZone.createEl("p", { text: "or", cls: "mutextum-dropzone__or" });
        this.browseBtn = dropZone.createEl("button", {
            text: "Browse Vault",
            cls: "mod-cta",
        });
        this.browseBtn.onclick = () => this.openPicker();

        this.setupDragAndDrop(dropZone);

        container.createEl("h3", { text: "Queue" });
        this.listEl = container.createDiv({ cls: "mutextum-queue" });

        const configEl = container.createDiv({ cls: "mutextum-config" });

        const row1 = configEl.createDiv({ cls: "mutextum-config-row mutextum-config-row--split" });

        const destGroup = row1.createDiv({ cls: "mutextum-config-group" });
        destGroup.createEl("label", { text: "Destination folder:" });
        this.destFolderInput = destGroup.createEl("input", {
            type: "text",
            value: this.plugin.settings.destinationFolder,
        });
        this.destFolderInput.onchange = () => {
            this.plugin.settings.destinationFolder =
                this.destFolderInput.value.trim() || "Imports";
            void this.plugin.saveSettings();
        };

        const actionGroup = row1.createDiv({ cls: "mutextum-action-group" });

        this.convertBtn = actionGroup.createEl("button", {
            text: "Convert All",
            cls: "mod-cta",
        });
        this.convertBtn.disabled = true;
        this.convertBtn.onclick = () => void this.startConversion();

        this.progressBar = actionGroup.createEl("progress", {
            attr: { max: "100", value: "0" },
        });
        this.progressBar.hide();

        const row2 = configEl.createDiv({ cls: "mutextum-config-row mutextum-config-row--split" });

        const fmGroup = row2.createDiv({ cls: "mutextum-config-group" });
        this.includeFmToggle = fmGroup.createEl("input", { type: "checkbox" });
        this.includeFmToggle.checked = this.plugin.settings.includeFrontmatter;
        fmGroup.createEl("label", { text: "Include frontmatter" });

        this.statusEl = row2.createDiv({ cls: "mutextum-status" });

        this.renderQueue();
    }

    // ──────────────────────────────────────────
    // Drag and drop
    // ──────────────────────────────────────────

    private setupDragAndDrop(el: HTMLElement): void {
        el.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            el.addClass("is-dragover");
        });
        el.addEventListener("dragleave", (e) => {
            if (!el.contains(e.relatedTarget as Node)) {
                el.removeClass("is-dragover");
            }
        });
        el.addEventListener("drop", (e) => {
            e.preventDefault();
            el.removeClass("is-dragover");
            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;
            void this.handleDroppedFiles(files);
        });
    }

    private async handleDroppedFiles(files: FileList): Promise<void> {
        let added = 0;
        let rejected = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
            if (!SUPPORTED_EXTENSIONS.includes(ext)) {
                rejected++;
                continue;
            }

            const bytes = new Uint8Array(await file.arrayBuffer());
            const basename = file.name.replace(/\.[^.]+$/, "");

            if (this.queue.some((q) => q.fileName === file.name)) {
                continue;
            }

            this.queue.push({
                fileName: file.name,
                basename,
                vaultFile: null,
                bytes,
            });
            added++;
        }

        this.renderQueue();

        if (added > 0) {
            this.statusEl.setText("");
            new Notice(`Added ${added} file${added === 1 ? "" : "s"} to the queue.`);
        }
        if (rejected > 0) {
            new Notice(
                `${rejected} file${rejected === 1 ? "" : "s"} skipped: unsupported format.`
            );
        }
    }

    // ──────────────────────────────────────────
    // Vault picker
    // ──────────────────────────────────────────

    private openPicker(): void {
        new FilePickerModal(this.app, (file) => {
            this.addVaultFile(file);
        }).open();
    }

    private addVaultFile(file: TFile): void {
        if (this.queue.some((q) => q.vaultFile?.path === file.path)) {
            new Notice(`${file.name} is already in the queue.`);
            return;
        }
        this.queue.push({
            fileName: file.name,
            basename: file.basename,
            vaultFile: file,
            bytes: null,
        });
        this.statusEl.setText("");
        this.renderQueue();
    }

    // ──────────────────────────────────────────
    // Queue rendering
    // ──────────────────────────────────────────

    private removeFromQueue(index: number): void {
        this.queue.splice(index, 1);
        this.renderQueue();
    }

    private renderQueue(): void {
        this.listEl.empty();
        if (this.queue.length === 0) {
            this.listEl.createEl("p", {
                text: "No files queued.",
                cls: "mutextum-empty",
            });
            this.convertBtn.disabled = true;
            return;
        }

        this.queue.forEach((item, index) => {
            const row = this.listEl.createDiv({ cls: "mutextum-queue-item" });
            row.createSpan({ text: item.fileName });

            const delBtn = row.createDiv({ cls: "clickable-icon mutextum-delete-btn" });
            setIcon(delBtn, "x");
            delBtn.setAttribute("aria-label", "Remove from queue");
            delBtn.onclick = () => this.removeFromQueue(index);
        });

        this.convertBtn.disabled = false;
    }

    // ──────────────────────────────────────────
    // Conversion
    // ──────────────────────────────────────────

    private async startConversion(): Promise<void> {
        if (this.isConverting || this.queue.length === 0) return;

        this.isConverting = true;
        this.convertBtn.disabled = true;
        this.browseBtn.disabled = true;
        this.convertBtn.hide();
        this.progressBar.show();
        this.progressBar.value = 0;
        this.statusEl.setText("");

        const total = this.queue.length;
        let success = 0;
        let failed = 0;

        for (let i = 0; i < total; i++) {
            const item = this.queue[i];
            this.statusEl.setText(
                `Converting ${item.fileName} (${i + 1}/${total})\u2026`
            );

            try {
                const bytes = item.vaultFile
                    ? new Uint8Array(await this.app.vault.readBinary(item.vaultFile))
                    : item.bytes!;
                const handle = convertBytes(bytes);
                const result = await handle.result;

                if (result.cancelled) {
                    this.statusEl.setText("Conversion cancelled.");
                    break;
                }

                if (!result.ok) {
                    new Notice(`Failed: ${item.fileName} \u2014 ${result.errorMessage}`);
                    failed++;
                } else {
                    await writeOutputFromPanel(
                        this.plugin,
                        { basename: item.basename, fileName: item.fileName },
                        result.markdown ?? "",
                        this.includeFmToggle.checked
                    );
                    success++;
                }
            } catch (e) {
                console.error("mutextum:", e);
                new Notice(`Failed: ${item.fileName}`);
                failed++;
            }

            this.progressBar.value = ((i + 1) / total) * 100;
        }

        this.statusEl.setText(`Done. Success: ${success}, Failed: ${failed}`);
        this.isConverting = false;
        this.progressBar.hide();
        this.convertBtn.show();
        this.convertBtn.disabled = false;
        this.browseBtn.disabled = false;
        this.queue = [];
        this.renderQueue();
    }
}