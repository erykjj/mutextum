// src/ui.ts

import { App, TFile, TFolder } from "obsidian";
import type MutextumPlugin from "../main";

declare const PLUGIN_VERSION: string;

// All formats anydoc handles:
const SUPPORTED_EXTENSIONS = [
    "doc", "docx", "odt", "pdf", "ppt", "pptx", "rtf", "epub", "xlsx", "ods", "odp", "csv",
];

export { SUPPORTED_EXTENSIONS };

// ──────────────────────────────────────────────
// Link stripping
// ──────────────────────────────────────────────

export function cleanMarkdown(markdown: string): string {
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
        .replace(/____/g, "__ __");
}

// ──────────────────────────────────────────────
// Output writing (called from the panel)
// ──────────────────────────────────────────────

interface Chapter {
    title: string;
    body: string;
}

export interface SourceInfo {
    basename: string;
    fileName: string;
}

export async function writeOutputFromPanel(
    plugin: MutextumPlugin,
    source: SourceInfo,
    markdown: string,
    includeFrontmatterOverride: boolean
): Promise<void> {
    const settings = plugin.settings;
    const output = cleanMarkdown(markdown);
    const baseName = source.basename;
    const destFolder = await ensureFolder(plugin.app, settings.destinationFolder);
    const chapters = splitOnH1(output);

    // ── Fallback: single note (no H1 headings) ──
    if (chapters.length === 0) {
        const proposed = `${destFolder.path}/${baseName}.md`;
        const finalPath = await resolveConflict(plugin.app, proposed, false);

        await writeNote(plugin, finalPath, output, source, includeFrontmatterOverride);
        return;
    }

    // ── Multi-note mode ──
    const subfolderName = sanitizeFilename(baseName);
    const proposedSubfolder = `${destFolder.path}/${subfolderName}`;
    const finalSubfolderPath = await resolveConflict(plugin.app, proposedSubfolder, true);

    const subfolder = await ensureFolder(plugin.app, finalSubfolderPath);
    const chapterLinks: string[] = [];

    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const safeTitle = sanitizeFilename(chapter.title);
        const paddedIndex = String(i + 1).padStart(2, "0");
        const notePath = `${subfolder.path}/${paddedIndex} - ${safeTitle}.md`;

        await writeNote(plugin, notePath, chapter.body, source, includeFrontmatterOverride);

        const noteBasename = notePath.replace(/^.*\//, "").replace(/\.md$/, "");
        chapterLinks.push(`- [[${noteBasename}|${chapter.title}]]`);
    }

    const indexBody = chapterLinks.join("\n");
    const indexPath = `${subfolder.path}/00 - Index.md`;
    await writeNote(plugin, indexPath, indexBody, source, includeFrontmatterOverride);
}

// ──────────────────────────────────────────────
// H1 splitting
// ──────────────────────────────────────────────

export function splitOnH1(markdown: string): Chapter[] {
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
// Conflict resolution (always rename)
// ──────────────────────────────────────────────

async function resolveConflict(
    app: App,
    proposedPath: string,
    _isFolder: boolean
): Promise<string> {
    const exists = await pathExists(app, proposedPath);
    if (!exists) return proposedPath;
    return await uniquePath(app, proposedPath);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

export function sanitizeFilename(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || "Untitled";
}

export async function ensureFolder(app: App, path: string): Promise<TFolder> {
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
    source: SourceInfo,
    includeFrontmatter: boolean
): Promise<void> {
    let content = markdown;

    if (includeFrontmatter) {
        const frontmatter = buildFrontmatter(source);
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

function buildFrontmatter(source: SourceInfo): string {
    const now = new Date();
    const localIso = formatLocalIso(now);
    return [
        "---",
        `source: ${source.fileName}`,
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