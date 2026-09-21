#!/usr/bin/env python3
"""
build.py
Build script for muTEXtum.

Steps:
  1. Bundle src/worker.ts into a standalone IIFE worker script.
  2. Read the worker script and inject it as a string constant into the main build.
  3. Read the anydoc WASM binary and inject it as a base64 string.
  4. Bundle main.ts into main.js.
"""

import base64
import json
import subprocess
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).parent.resolve()
NODE_MODULES = PLUGIN_DIR / "node_modules"


def run_cmd(cmd, description, cwd=None):
    print(f"  {description}...")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        print(f"  ERROR: {description} failed")
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        sys.exit(1)
    return result.stdout


def main():
    print("=" * 50)
    print("muTEXtum Build Script")
    print("=" * 50)

    # ──────────────────────────────────────────
    # Step 1: Read the anydoc WASM binary
    # ──────────────────────────────────────────
    wasm_path = (
        NODE_MODULES
        / "@firecrawl"
        / "anydoc-wasm"
        / "anydoc_wasm_bg.wasm"
    )
    if not wasm_path.exists():
        print(f"ERROR: anydoc WASM not found at {wasm_path}")
        print("Run `npm install` first.")
        sys.exit(1)

    wasm_size = wasm_path.stat().st_size
    print(f"\n[1/4] Inlining anydoc WASM: {wasm_size / 1024:.0f} KB")
    wasm_base64 = base64.b64encode(wasm_path.read_bytes()).decode("ascii")

    # ──────────────────────────────────────────
    # Step 2: Read versions from manifest.json and anydoc package.json
    # ──────────────────────────────────────────
    manifest_path = PLUGIN_DIR / "manifest.json"
    if not manifest_path.exists():
        print(f"ERROR: {manifest_path} not found")
        sys.exit(1)
    manifest_data = json.loads(manifest_path.read_text())
    plugin_version = manifest_data["version"]

    anydoc_pkg_path = (
        NODE_MODULES
        / "@firecrawl"
        / "anydoc-wasm"
        / "package.json"
    )
    if not anydoc_pkg_path.exists():
        print(f"ERROR: {anydoc_pkg_path} not found")
        sys.exit(1)
    anydoc_data = json.loads(anydoc_pkg_path.read_text())
    anydoc_version = anydoc_data["version"]

    print(f"\n[2/4] Versions: plugin v{plugin_version}, anydoc v{anydoc_version}")

    # ──────────────────────────────────────────
    # Step 3: Bundle the worker with the base64 injected
    # ──────────────────────────────────────────
    worker_entry = PLUGIN_DIR / "src" / "worker.ts"
    worker_bundle = PLUGIN_DIR / "worker-bundle.js"

    if not worker_entry.exists():
        print(f"ERROR: {worker_entry} not found")
        sys.exit(1)

    print("\n[3/4] Bundling worker...")

    worker_defines = {"ANYDOC_WASM_BASE64": wasm_base64}
    worker_defines_js = json.dumps(worker_defines)

    worker_temp_config = PLUGIN_DIR / ".esbuild-worker-temp.mjs"
    worker_temp_config.write_text(f'''
import esbuild from 'esbuild';

const defines = {worker_defines_js};
const stringified = Object.fromEntries(
  Object.entries(defines).map(([k, v]) => [k, JSON.stringify(v)])
);

await esbuild.build({{
  entryPoints: ['src/worker.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'worker-bundle.js',
  minify: true,
  define: stringified,
}});
''')

    run_cmd(f'node "{worker_temp_config}"', "esbuild worker bundle", cwd=PLUGIN_DIR)
    worker_temp_config.unlink()

    worker_size = worker_bundle.stat().st_size
    print(f"  Worker bundle: {worker_size / 1024:.0f} KB")

    # ──────────────────────────────────────────
    # Step 4: Read worker script and build main.js
    # ──────────────────────────────────────────
    worker_source = worker_bundle.read_text()
    print("\n[4/4] Bundling main.js...")

    main_defines = {
        "WORKER_SOURCE": worker_source,
        "PLUGIN_VERSION": plugin_version,
        "ANYDOC_VERSION": anydoc_version,
    }
    main_defines_js = json.dumps(main_defines)

    temp_config = PLUGIN_DIR / ".esbuild-temp.mjs"
    temp_config.write_text(f'''
import esbuild from 'esbuild';

const defines = {main_defines_js};
const stringified = Object.fromEntries(
  Object.entries(defines).map(([k, v]) => [k, JSON.stringify(v)])
);

await esbuild.build({{
  entryPoints: ['main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  external: ['obsidian'],
  sourcemap: false,
  treeShaking: true,
  logLevel: 'info',
  outfile: 'main.js',
  define: stringified,
}});
''')

    run_cmd(f'node "{temp_config}"', "esbuild main bundle", cwd=PLUGIN_DIR)
    temp_config.unlink()

    main_js = PLUGIN_DIR / "main.js"
    if not main_js.exists():
        print("\nERROR: build produced no main.js")
        sys.exit(1)

    main_size = main_js.stat().st_size
    print("\n\u2713 Build complete")
    print(f"  Output: {main_js}")
    print(f"  Size:   {main_size / 1024:.0f} KB")

    worker_bundle.unlink()


if __name__ == "__main__":
    main()