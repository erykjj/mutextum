// src/modal.ts

import { App, Modal, Notice } from "obsidian";

// ──────────────────────────────────────────────
// Progress modal
// ──────────────────────────────────────────────

export class ConversionProgressModal extends Modal {
    private readonly fileName: string;
    private readonly onCancel: () => void;
    private cancelled = false;

    constructor(app: App, fileName: string, onCancel: () => void) {
        super(app);
        this.fileName = fileName;
        this.onCancel = onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        this.setTitle("Converting\u2026");

        contentEl.createEl("p", { text: this.fileName });

        const spinnerEl = contentEl.createDiv({ cls: "mutextum-spinner" });
        spinnerEl.createDiv({ cls: "mutextum-spinner-ring" });

        const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
        btnContainer.createEl("button", { text: "Cancel" })
            .addEventListener("click", () => {
                if (this.cancelled) return;
                this.cancelled = true;
                this.onCancel();
                this.close();
            });
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.cancelled) {
            this.cancelled = true;
            this.onCancel();
        }
    }
}

// ──────────────────────────────────────────────
// Conflict modal
// ──────────────────────────────────────────────

export type ConflictChoice = "overwrite" | "rename" | "skip";

export class ConflictModal extends Modal {
    private readonly conflictPath: string;
    private readonly isFolder: boolean;
    private readonly resolve: (choice: ConflictChoice) => void;
    private resolved = false;

    constructor(
        app: App,
        conflictPath: string,
        isFolder: boolean,
        resolve: (choice: ConflictChoice) => void
    ) {
        super(app);
        this.conflictPath = conflictPath;
        this.isFolder = isFolder;
        this.resolve = resolve;
    }

    private finish(choice: ConflictChoice): void {
        if (this.resolved) return;
        this.resolved = true;
        this.resolve(choice);
        this.close();
    }

    onOpen(): void {
        const { contentEl } = this;
        this.setTitle("Conflict");

        const kind = this.isFolder ? "folder" : "note";
        contentEl.createEl("p", {
            text: `The ${kind} "${this.conflictPath}" already exists. What would you like to do?`,
        });

        if (this.isFolder) {
            contentEl.createEl("p", {
                text: "Overwrite will replace any files in the existing folder that match the new conversion. Other files in that folder will be left untouched.",
                cls: "mod-muted",
            });
        }

        const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });

        btnContainer.createEl("button", { text: "Overwrite" })
            .addEventListener("click", () => this.finish("overwrite"));

        btnContainer.createEl("button", { text: "Rename" })
            .addEventListener("click", () => this.finish("rename"));

        btnContainer.createEl("button", { text: "Skip" })
            .addEventListener("click", () => this.finish("skip"));
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) {
            this.resolved = true;
            this.resolve("skip");
        }
    }
}

// ──────────────────────────────────────────────
// Error modal
// ──────────────────────────────────────────────

const FRIENDLY_MESSAGES: Record<string, string> = {
    encrypted: "This file is encrypted and cannot be converted.",
    unsupported: "This file format isn't supported.",
    malformed: "This file appears to be damaged or incomplete.",
    needsOcr: "This PDF is image-only. OCR isn't supported yet.",
    resourceLimit: "This file is too large or complex to convert.",
    missingPart: "This file is missing required components.",
    worker: "The conversion engine failed to start.",
    unknown: "An unexpected error occurred during conversion.",
};

export class ConversionErrorModal extends Modal {
    private readonly fileName: string;
    private readonly errorCode: string;
    private readonly errorMessage: string;

    constructor(app: App, fileName: string, errorCode: string, errorMessage: string) {
        super(app);
        this.fileName = fileName;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
    }

    onOpen(): void {
        const { contentEl } = this;
        this.setTitle("Conversion Failed");

        contentEl.createEl("p", {
            text: `${this.fileName} could not be converted.`,
        });

        const friendly = FRIENDLY_MESSAGES[this.errorCode] ?? FRIENDLY_MESSAGES.unknown;
        contentEl.createEl("p", { text: friendly });

        const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });

        btnContainer.createEl("button", { text: "Copy details" })
            .addEventListener("click", () => {
                const details = JSON.stringify(
                    {
                        file: this.fileName,
                        code: this.errorCode,
                        message: this.errorMessage,
                    },
                    null,
                    2
                );
                void navigator.clipboard.writeText(details);
                new Notice("Error details copied to clipboard.");
            });

        btnContainer.createEl("button", { text: "OK", cls: "mod-cta" })
            .addEventListener("click", () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}