// src/ui.ts

import { App, Menu, TFile, TFolder, Notice } from "obsidian";
import type MutextumPlugin from "../main";
import { convertBytes } from "./converter";
import { ConversionProgressModal, ConversionErrorModal, ConflictModal, ConflictChoice } from "./modal";

declare const PLUGIN_VERSION: string;

// All formats anydoc handles:
const SUPPORTED_EXTENSIONS = [ "doc", "docx", "odt", "pdf", "ppt", "pptx", "rtf", "epub", "xlsx", "ods", "odp", "csv", ];

// ──────────────────────────────────────────────
// File menu registration
// ──────────────────────────────────────────────

export function registerFileMenu(plugin: MutextumPlugin): void {
    plugin.registerEvent(
        // @ts-ignore — `file-menu` is a valid event but may be missing from typings
        plugin.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
            if (!SUPPORTED_EXTENSIONS.includes(file.extension.toLowerCase())) {
                return;
            }

            menu.addItem((item) => {
                item
                    .setTitle("mu/TEX/tum → Markdown")
                    .setIcon("file-symlink")
                    .onClick(() => {
                        void convertFile(plugin, file);
                    });
            });
        })
    );
}

// ──────────────────────────────────────────────
// Conversion orchestration
// ──────────────────────────────────────────────

export async function convertFile(plugin: MutextumPlugin, file: TFile): Promise<void> {
    let bytes: Uint8Array;
    try {
        const arrayBuffer = await plugin.app.vault.readBinary(file);
        bytes = new Uint8Array(arrayBuffer);
    } catch (e) {
        console.error("mutextum: failed to read file:", e);
        new ConversionErrorModal(plugin.app, file.name, "io", String(e)).open();
        return;
    }

    let handle: ReturnType<typeof convertBytes>;
    let progressModal: ConversionProgressModal;

    try {
        handle = convertBytes(bytes);
    } catch (e) {
        console.error("mutextum: failed to spawn worker:", e);
        new ConversionErrorModal(plugin.app, file.name, "worker", String(e)).open();
        return;
    }

    progressModal = new ConversionProgressModal(plugin.app, file.name, () => {
        handle.cancel();
    });
    progressModal.open();

    const result = await handle.result;

    progressModal.close();

    if (result.cancelled) {
        new Notice("Conversion cancelled.");
        return;
    }

    if (!result.ok) {
        new ConversionErrorModal(
            plugin.app,
            file.name,
            result.errorCode ?? "unknown",
            result.errorMessage ?? "No additional details."
        ).open();
        return;
    }

    try {
        await writeOutput(plugin, file, result.markdown ?? "");
    } catch (e) {
        console.error("mutextum: failed to write output:", e);
        new ConversionErrorModal(plugin.app, file.name, "io", String(e)).open();
    }
}

// ──────────────────────────────────────────────
// Link stripping
// ──────────────────────────────────────────────

function cleanMarkdown(markdown: string): string {
    return markdown
        // Strip jw.org hyperlinks
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\.jw\.org\/[^)]+\)/g, "$1")
        // Strip internal anchor links (keep text)
        .replace(/\[([^\]]+)\]\(#[^)]+\)/g, "$1")
        // Strip bare HTML anchor tags like <a id="..."></a>
        .replace(/<a\s[^>]*id="[^"]*"[^>]*><\/a>/g, "")
        // Merge adjacent bold spans separated by whitespace into one
        .replace(/\*\*\s+\*\*/g, " ")
        // Merge adjacent italic spans separated by whitespace into one
        .replace(/(?<!\*)\*(?!\*)\s+(?<!\*)\*(?!\*)/g, " ")
        // Collapse truly-adjacent markers (no space between)
        .replace(/\*\*\*\*/g, "")
        .replace(/____/g, "");
}

// ──────────────────────────────────────────────
// Output writing
// ──────────────────────────────────────────────

interface Chapter {
    title: string;
    body: string;
}

async function writeOutput(
    plugin: MutextumPlugin,
    sourceFile: TFile,
    markdown: string
): Promise<void> {
    const settings = plugin.settings;
    const output = cleanMarkdown(markdown);
    const baseName = sourceFile.basename;
    const destFolder = await ensureFolder(plugin.app, settings.destinationFolder);
    const chapters = splitOnH1(output);

    // ── Fallback: single note (no H1 headings) ──
    if (chapters.length === 0) {
        const proposed = `${destFolder.path}/${baseName}.md`;
        const choice = await resolveConflict(plugin.app, proposed, false);

        if (choice.kind === "skip") {
            new Notice(`Skipped: ${proposed} already exists.`);
            return;
        }

        await writeNote(plugin, choice.path, output, sourceFile);
        new Notice(
            `No H1 headings found \u2014 wrote single note: ${choice.path}`
        );
        return;
    }

    // ── Multi-note mode ──
    const subfolderName = sanitizeFilename(baseName);
    const proposedSubfolder = `${destFolder.path}/${subfolderName}`;
    const folderChoice = await resolveConflict(plugin.app, proposedSubfolder, true);

    if (folderChoice.kind === "skip") {
        new Notice(`Skipped: ${proposedSubfolder} already exists.`);
        return;
    }

    const subfolder = await ensureFolder(plugin.app, folderChoice.path);
    const chapterLinks: string[] = [];
    let written = 0;

    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const safeTitle = sanitizeFilename(chapter.title);
        const paddedIndex = String(i + 1).padStart(2, "0");
        const notePath = `${subfolder.path}/${paddedIndex} - ${safeTitle}.md`;

        await writeNote(plugin, notePath, chapter.body, sourceFile);
        written++;

        const noteBasename = notePath.replace(/^.*\//, "").replace(/\.md$/, "");
        chapterLinks.push(`- [[${noteBasename}|${chapter.title}]]`);
    }

    const indexBody = chapterLinks.join("\n");
    const indexPath = `${subfolder.path}/00 - Index.md`;
    await writeNote(plugin, indexPath, indexBody, sourceFile);

    new Notice(
        `Converted: ${sourceFile.name} \u2014 ${written} chapter` +
        `${written === 1 ? "" : "s"} \u2192 ${subfolder.path}`
    );
}

// ──────────────────────────────────────────────
// H1 splitting
// ──────────────────────────────────────────────

function splitOnH1(markdown: string): Chapter[] {
    const lines = markdown.split("\n");
    const chapters: Chapter[] = [];
    let currentTitle: string | null = null;
    let currentBody: string[] = [];

    for (const line of lines) {
        if (/^# (?!#)/.test(line)) {
            if (currentTitle !== null) {
                chapters.push({
                    title: currentTitle,
                    body: currentBody.join("\n").trim(),
                });
            }
            currentTitle = line.slice(2).trim();
            currentBody = [];
        } else if (currentTitle !== null) {
            currentBody.push(line);
        }
    }

    if (currentTitle !== null) {
        chapters.push({
            title: currentTitle,
            body: currentBody.join("\n").trim(),
        });
    }

    return chapters;
}

// ──────────────────────────────────────────────
// Conflict resolution
// ──────────────────────────────────────────────

type ConflictResult =
    | { kind: "write"; path: string }
    | { kind: "skip" };

async function resolveConflict(
    app: App,
    proposedPath: string,
    isFolder: boolean
): Promise<ConflictResult> {
    let exists: boolean;
    try {
        exists = await app.vault.adapter.exists(proposedPath);
    } catch {
        exists = app.vault.getAbstractFileByPath(proposedPath) !== null;
    }

    if (!exists) {
        return { kind: "write", path: proposedPath };
    }

    const choice = await new Promise<ConflictChoice>((resolve) => {
        new ConflictModal(app, proposedPath, isFolder, resolve).open();
    });

    if (choice === "skip") {
        return { kind: "skip" };
    }

    if (choice === "rename") {
        const renamed = await uniquePath(app, proposedPath);
        return { kind: "write", path: renamed };
    }

    return { kind: "write", path: proposedPath };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function sanitizeFilename(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || "Untitled";
}

async function ensureFolder(app: App, path: string): Promise<TFolder> {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    if (!normalized) {
        return app.vault.getRoot();
    }

    const existing = app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) {
        return existing;
    }
    if (existing) {
        throw new Error(`Path exists but is not a folder: ${normalized}`);
    }

    return await app.vault.createFolder(normalized);
}

async function writeNote(
    plugin: MutextumPlugin,
    path: string,
    markdown: string,
    sourceFile: TFile
): Promise<void> {
    const settings = plugin.settings;
    let content = markdown;

    if (settings.includeFrontmatter) {
        const frontmatter = buildFrontmatter(sourceFile);
        content = frontmatter + "\n\n" + markdown;
    }

    const existing = plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
        await plugin.app.vault.modify(existing, content);
        return;
    }

    try {
        await plugin.app.vault.create(path, content);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already exists")) {
            await plugin.app.vault.adapter.write(path, content);
        } else {
            throw e;
        }
    }
}

function buildFrontmatter(sourceFile: TFile): string {
    const now = new Date();
    const localIso = formatLocalIso(now);
    return [
        "---",
        `source: ${sourceFile.name}`,
        `converted: ${localIso}`,
        `created by: mu/TEX/tum v${PLUGIN_VERSION}`,
        "---",
    ].join("\n");
}

function formatLocalIso(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const absOffset = Math.abs(offset);
    const offsetHours = pad(Math.floor(absOffset / 60));
    const offsetMinutes = pad(absOffset % 60);
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `${sign}${offsetHours}:${offsetMinutes}`
    );
}

async function uniquePath(app: App, path: string): Promise<string> {
    const dotIndex = path.lastIndexOf(".");
    const base = dotIndex >= 0 ? path.slice(0, dotIndex) : path;
    const ext = dotIndex >= 0 ? path.slice(dotIndex) : "";

    let candidate = path;
    let counter = 1;

    let taken = await pathExists(app, candidate);
    while (taken) {
        candidate = `${base} (${counter})${ext}`;
        counter++;
        taken = await pathExists(app, candidate);
    }
    return candidate;
}

async function pathExists(app: App, path: string): Promise<boolean> {
    try {
        return await app.vault.adapter.exists(path);
    } catch {
        return app.vault.getAbstractFileByPath(path) !== null;
    }
}