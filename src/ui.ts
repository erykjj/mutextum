// src/ui.ts

import { App, TFolder } from "obsidian";
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
    const baseName = sanitizeFilename(source.basename);
    const destFolder = await ensureFolder(plugin.app, settings.destinationFolder);
    const { preamble, chapters } = splitOnH1(output);

    // ── Fallback: single note (no H1 headings) ──
    if (chapters.length === 0) {
        const proposed = `${destFolder.path}/${baseName}.md`;
        const finalPath = await uniquePath(plugin.app, proposed, false);

        await writeNote(plugin, finalPath, output, source, includeFrontmatterOverride);
        return;
    }

    // ── Multi-note mode ──
    const proposedSubfolder = `${destFolder.path}/${baseName}`;
    const finalSubfolderPath = await uniquePath(plugin.app, proposedSubfolder, true);

    const subfolder = await ensureFolder(plugin.app, finalSubfolderPath);
    const chapterLinks: string[] = [];

    if (preamble !== null) {
        const preamblePath = `${subfolder.path}/00 - Preamble.md`;
        const actualPreamblePath = await writeNote(
            plugin, preamblePath, preamble, source, includeFrontmatterOverride
        );
        chapterLinks.push(
            `- [[${linkTargetFromPath(actualPreamblePath)}|Preamble]]`
        );
    }

    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const safeTitle = sanitizeFilename(chapter.title);
        const paddedIndex = String(i + 1).padStart(2, "0");
        const notePath = `${subfolder.path}/${paddedIndex} - ${safeTitle}.md`;

        const actualNotePath = await writeNote(
            plugin, notePath, chapter.body, source, includeFrontmatterOverride
        );

        chapterLinks.push(
            `- [[${linkTargetFromPath(actualNotePath)}|${escapeAlias(chapter.title)}]]`
        );
    }

    const indexBody = chapterLinks.join("\n");
    const indexPath = `${subfolder.path}/_Index.md`;
    await writeNote(plugin, indexPath, indexBody, source, includeFrontmatterOverride);
}

// ──────────────────────────────────────────────
// H1 splitting + preamble detection
// ──────────────────────────────────────────────

export function splitOnH1(markdown: string): { preamble: string | null; chapters: Chapter[] } {
    const lines = markdown.split("\n");
    const chapters: Chapter[] = [];
    const preambleLines: string[] = [];
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
        } else {
            preambleLines.push(line);
        }
    }

    if (currentTitle !== null) {
        chapters.push({
            title: currentTitle,
            body: currentBody.join("\n").trim(),
        });
    }

    const preamble = isSubstantive(preambleLines.join("\n"))
        ? preambleLines.join("\n").trim()
        : null;

    return { preamble, chapters };
}

function isSubstantive(text: string): boolean {
    const lines = text.split("\n");
    let inFrontmatter = false;
    let frontmatterSettled = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (i === 0 && trimmed === "---") {
            inFrontmatter = true;
            continue;
        }
        if (inFrontmatter) {
            if (trimmed === "---") {
                inFrontmatter = false;
                frontmatterSettled = true;
            }
            continue;
        }
        if (!frontmatterSettled && trimmed === "") continue;
        if (trimmed === "") continue;
        if (/^([-*_])\s*\1\s*\1[\s\S]*$/.test(trimmed)) continue; // hr
        return true;
    }
    return false;
}

// ──────────────────────────────────────────────
// Conflict resolution (always rename; self-contained)
// ──────────────────────────────────────────────

export async function uniquePath(app: App, path: string, isFolder: boolean): Promise<string> {
    if (!(await pathExists(app, path))) return path;

    const { base, ext } = isFolder
        ? { base: path, ext: "" }
        : (() => {
            const dot = path.lastIndexOf(".");
            return dot >= 0
                ? { base: path.slice(0, dot), ext: path.slice(dot) }
                : { base: path, ext: "" };
        })();

    let counter = 1;
    let candidate = `${base} (${counter})${ext}`;
    while (await pathExists(app, candidate)) {
        counter++;
        candidate = `${base} (${counter})${ext}`;
    }
    return candidate;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]|CONIN\$|CONOUT\$)$/i;

export function sanitizeFilename(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "");
    if (!cleaned) return "Untitled";
    if (WINDOWS_RESERVED.test(cleaned)) return `_${cleaned}`;
    return cleaned;
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
): Promise<string> {
    let content = markdown;

    if (includeFrontmatter) {
        const frontmatter = buildFrontmatter(source);
        content = frontmatter + "\n\n" + markdown;
    }

    const finalPath = await uniquePath(plugin.app, path, false);

    try {
        await plugin.app.vault.create(finalPath, content);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already exists")) {
            const retryPath = await uniquePath(plugin.app, finalPath, false);
            await plugin.app.vault.adapter.write(retryPath, content);
            return retryPath;
        }
        throw e;
    }

    return finalPath;
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

function linkTargetFromPath(path: string): string {
    return path.replace(/\.md$/, "");
}

function escapeAlias(alias: string): string {
    return alias.replace(/[|[\]\\]/g, "");
}

async function pathExists(app: App, path: string): Promise<boolean> {
    try {
        return await app.vault.adapter.exists(path);
    } catch {
        return app.vault.getAbstractFileByPath(path) !== null;
    }
}