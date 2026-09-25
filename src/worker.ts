// src/worker.ts

declare const ANYDOC_WASM_BASE64: string;

import init, { toMarkdownBytes } from '@firecrawl/anydoc-wasm';

let initialized = false;

async function decodeAndDecompressWasm(): Promise<Uint8Array> {
    // 1. Base64 → gzipped bytes
    const binaryString = atob(ANYDOC_WASM_BASE64);
    const gzippedBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        gzippedBytes[i] = binaryString.charCodeAt(i);
    }

    // 2. Gzipped bytes → decompressed bytes via DecompressionStream
    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Blob([gzippedBytes]).stream().pipeThrough(ds);
    const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
    return new Uint8Array(decompressedBuffer);
}

async function ensureInitialized(): Promise<void> {
    if (initialized) return;

    const bytes = await decodeAndDecompressWasm();
    const module = new WebAssembly.Module(bytes as BufferSource);
    await init({ module_or_path: module });

    initialized = true;
}

interface ConvertRequest {
    id: number;
    bytes: Uint8Array;
}

interface ConvertSuccess {
    id: number;
    ok: true;
    markdown: string;
}

interface ConvertError {
    id: number;
    ok: false;
    code: string;
    message: string;
}

type WorkerResponse = ConvertSuccess | ConvertError;

self.onmessage = async (event: MessageEvent<ConvertRequest>) => {
    const { id, bytes } = event.data;

    try {
        await ensureInitialized();
        const markdown = toMarkdownBytes(bytes);
        const response: WorkerResponse = { id, ok: true, markdown };
        self.postMessage(response);
    } catch (error) {
        const err = error as { code?: string; message?: string };
        const response: WorkerResponse = {
            id,
            ok: false,
            code: err.code ?? 'unknown',
            message: err.message ?? String(error),
        };
        self.postMessage(response);
    }
};