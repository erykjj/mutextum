// src/converter.ts

declare const WORKER_SOURCE: string;

export interface ConversionResult {
    ok: boolean;
    markdown?: string;
    errorCode?: string;
    errorMessage?: string;
    cancelled?: boolean;
}

export interface ConversionHandle {
    result: Promise<ConversionResult>;
    cancel: () => void;
}

interface WorkerMessage {
    id: number;
    ok: boolean;
    markdown?: string;
    code?: string;
    message?: string;
}

export function convertBytes(bytes: Uint8Array): ConversionHandle {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    let settled = false;
    let resolveResult!: (r: ConversionResult) => void;

    const result = new Promise<ConversionResult>((resolve) => {
        resolveResult = resolve;
    });

    const cleanup = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(blobUrl);
    };

    let worker: Worker;
    try {
        worker = new Worker(blobUrl);
    } catch (e) {
        URL.revokeObjectURL(blobUrl);
        const msg = e instanceof Error ? e.message : String(e);
        return {
            result: Promise.resolve({
                ok: false,
                errorCode: "worker",
                errorMessage: msg || "Worker failed to start.",
            }),
            cancel: () => {},
        };
    }

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const data = event.data;
        if (settled) return;

        if (data.ok) {
            cleanup();
            worker.terminate();
            resolveResult({ ok: true, markdown: data.markdown });
        } else {
            cleanup();
            worker.terminate();
            resolveResult({
                ok: false,
                errorCode: data.code,
                errorMessage: data.message,
            });
        }
    };

    worker.onerror = (event: ErrorEvent) => {
        if (settled) return;
        cleanup();
        worker.terminate();
        resolveResult({
            ok: false,
            errorCode: "worker",
            errorMessage: event.message || "Worker failed to start.",
        });
    };

    worker.postMessage({ id: 1, bytes });

    const cancel = () => {
        if (settled) return;
        cleanup();
        worker.terminate();
        resolveResult({ ok: false, cancelled: true });
    };

    return { result, cancel };
}