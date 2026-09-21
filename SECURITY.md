# mu/TEX/tum Security and Privacy

## Network Use

**This plugin makes no network requests.** All document conversion happens entirely on-device via an embedded WebAssembly engine. **No telemetry, tracking, or third-party services** are used. **No HTML web-scraping** is involved. **No API keys** are required.

---

## Privacy

This plugin **does not read or write the system clipboard**. The only clipboard interaction is the "Copy details" button in the error dialog, which writes diagnostic information to the clipboard at the user's explicit request.

**No document content is collected, stored, or transmitted.** Converted documents are written only to the user's own vault, at the configured destination folder.

---

## WASM Module

This plugin includes a WebAssembly (WASM) conversion engine compiled from Rust. The WASM module is **embedded** and is not loaded from any external source. The engine is [anydoc](https://github.com/firecrawl/anydoc), an open-source document converter (MIT License).

The WASM module:
- Does not make any network requests
- Does not access the file system directly (all file I/O goes through Obsidian's Vault API)
- Does not read or modify the DOM directly
- Runs in an isolated Web Worker and is terminated after each conversion

All conversion is performed locally inside the Web Worker. No document content is sent to any external service.

---

## File Handling

**Source files are never modified or deleted** — they remain exactly as they were before conversion.

---

## TypeScript Warnings

The plugin source contains some TypeScript strictness warnings inherent to JavaScript interop. **These warnings are cosmetic and do not affect functionality or security**.