import { error as logError } from '@tauri-apps/plugin-log';

/** Sends uncaught webview errors to the Rust log file (helps debug friends' machines). */
export function forwardErrors(context: string) {
  window.addEventListener('error', (e) => void logError(`[${context}] ${e.message}`));
  window.addEventListener(
    'unhandledrejection',
    (e) => void logError(`[${context}] unhandled: ${String(e.reason)}`),
  );
}
