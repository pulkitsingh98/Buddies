import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
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
      input: { settings: resolve(import.meta.dirname, 'settings.html') },
    },
  },
  test: { environment: 'node' },
});
