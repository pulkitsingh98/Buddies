import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const host = process.env.TAURI_DEV_HOST;

/**
 * onnxruntime-web's bundle references its 15 MB wasm via `new URL(..., import.meta.url)`.
 * We never load that copy (Rust downloads a hash-pinned one and passes it as `wasmBinary`),
 * so keep it out of the installer.
 */
function dropOrtWasm(): Plugin {
  return {
    name: 'drop-ort-wasm',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(name)) Reflect.deleteProperty(bundle, name);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), dropOrtWasm()],
  clearScreen: false,
  envDir: '../..',
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    // One entry per window type so the lightweight pet window never loads settings code.
    rollupOptions: {
      input: {
        settings: resolve(import.meta.dirname, 'settings.html'),
        creator: resolve(import.meta.dirname, 'creator.html'),
        pet: resolve(import.meta.dirname, 'pet.html'),
      },
    },
  },
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
  test: { environment: 'node' },
});
