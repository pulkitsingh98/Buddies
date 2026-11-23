import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/** Checks GitHub Releases for a signed update; installs and relaunches if found. */
export async function checkForUpdate(): Promise<string> {
  try {
    const update = await check();
    if (!update) return 'You are up to date.';
    await update.downloadAndInstall();
    await relaunch();
    return `Updated to ${update.version}.`;
  } catch (e) {
    return `Update check failed: ${String(e)}`;
  }
}
