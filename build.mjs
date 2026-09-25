#!/usr/bin/env node
// build.mjs

import { build } from 'esbuild';
import { readFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = __dirname;
const NODE_MODULES = resolve(PLUGIN_DIR, 'node_modules');

const banner = '='.repeat(50);
console.log(banner);
console.log('muTEXtum Build Script');
console.log(banner);

// ──────────────────────────────────────────
// Step 1: Read the anydoc WASM binary
// ──────────────────────────────────────────
const wasmPath = resolve(NODE_MODULES, '@firecrawl', 'anydoc-wasm', 'anydoc_wasm_bg.wasm');
if (!existsSync(wasmPath)) {
    console.error(`ERROR: anydoc WASM not found at ${wasmPath}`);
    console.error('Run `npm install` first.');
    process.exit(1);
}

const wasmSize = statSync(wasmPath).size;
console.log(`\n[1/4] Inlining anydoc WASM: ${(wasmSize / 1024).toFixed(0)} KB`);
const wasmBase64 = gzipSync(readFileSync(wasmPath), { level: 9 }).toString('base64');

// ──────────────────────────────────────────
// Step 2: Read versions
// ──────────────────────────────────────────
const manifestPath = resolve(PLUGIN_DIR, 'manifest.json');
if (!existsSync(manifestPath)) {
    console.error(`ERROR: ${manifestPath} not found`);
    process.exit(1);
}
const manifestData = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pluginVersion = manifestData.version;

const anydocPkgPath = resolve(NODE_MODULES, '@firecrawl', 'anydoc-wasm', 'package.json');
if (!existsSync(anydocPkgPath)) {
    console.error(`ERROR: ${anydocPkgPath} not found`);
    process.exit(1);
}
const anydocData = JSON.parse(readFileSync(anydocPkgPath, 'utf8'));
const anydocVersion = anydocData.version;

console.log(`\n[2/4] Versions: plugin v${pluginVersion}, anydoc v${anydocVersion}`);

// ──────────────────────────────────────────
// Step 3: Bundle the worker with the WASM inlined
// ──────────────────────────────────────────
const workerEntry = resolve(PLUGIN_DIR, 'src', 'worker.ts');
const workerBundle = resolve(PLUGIN_DIR, 'worker-bundle.js');

if (!existsSync(workerEntry)) {
    console.error(`ERROR: ${workerEntry} not found`);
    process.exit(1);
}

console.log('\n[3/4] Bundling worker...');

await build({
    entryPoints: [workerEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: workerBundle,
    minify: true,
    define: {
        ANYDOC_WASM_BASE64: JSON.stringify(wasmBase64),
    },
});

const workerSize = statSync(workerBundle).size;
console.log(`  Worker bundle: ${(workerSize / 1024).toFixed(0)} KB`);

// ──────────────────────────────────────────
// Step 4: Bundle main.js with the worker source inlined
// ──────────────────────────────────────────
const workerSource = readFileSync(workerBundle, 'utf8');

console.log('\n[4/4] Bundling main.js...');

await build({
    entryPoints: [resolve(PLUGIN_DIR, 'main.ts')],
    bundle: true,
    format: 'cjs',
    target: 'es2020',
    platform: 'browser',
    external: ['obsidian'],
    sourcemap: false,
    treeShaking: true,
    logLevel: 'info',
    outfile: resolve(PLUGIN_DIR, 'main.js'),
    define: {
        WORKER_SOURCE: JSON.stringify(workerSource),
        PLUGIN_VERSION: JSON.stringify(pluginVersion),
        ANYDOC_VERSION: JSON.stringify(anydocVersion),
    },
});

const mainJs = resolve(PLUGIN_DIR, 'main.js');
if (!existsSync(mainJs)) {
    console.error('\nERROR: build produced no main.js');
    process.exit(1);
}

const mainSize = statSync(mainJs).size;
console.log('\n\u2713 Build complete');
console.log(`  Output: ${mainJs}`);
console.log(`  Size:   ${(mainSize / 1024).toFixed(0)} KB`);

// Cleanup
unlinkSync(workerBundle);