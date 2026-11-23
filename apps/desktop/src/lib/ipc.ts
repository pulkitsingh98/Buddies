import { Channel, invoke } from '@tauri-apps/api/core';
import type { PetManifest } from '@deskpals/shared';

/** Mirrors `settings::Settings` in Rust. */
export interface Settings {
  activePets: string[];
  petsVisible: boolean;
  petSize: number;
  reducedMotion: boolean;
  sleepAfterMin: number;
  bedtimeHour: number;
  waterEnabled: boolean;
  waterEveryMin: number;
  stretchEnabled: boolean;
  stretchEveryMin: number;
  eyeEnabled: boolean;
  eyeEveryMin: number;
  quietStart: number;
  quietEnd: number;
  focusMin: number;
  breakMin: number;
  dailyMessage: boolean;
  compliments: boolean;
  moodCheckin: boolean;
  doNotDisturb: boolean;
  shareMood: boolean;
  tidyDesktop: boolean;
  sortDownloads: boolean;
  onboarded: boolean;
}

export type ChoreFolder = 'desktop' | 'downloads';
export interface TidyPlan {
  moves: { from: string; to: string; category: string }[];
  skipped: { name: string; reason: string }[];
  dest: string;
}
export interface TidyReport {
  batchId: string;
  moved: number;
  failed: { name: string; reason: string }[];
  dest: string;
}
export interface UndoReport {
  restored: number;
  renamed: string[];
  missing: string[];
}
export interface TidyBatch {
  id: string;
  folder: string;
  dest: string;
  at: number;
  count: number;
  undone: boolean;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export const ipc = {
  getSettings: () => invoke<Settings>('get_settings'),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>('update_settings', { patch }),

  getWellbeingState: () => invoke<unknown>('get_wellbeing_state'),
  setWellbeingState: (state: unknown) => invoke('set_wellbeing_state', { state }),

  listPets: () => invoke<PetManifest[]>('list_pets'),
  getPet: (id: string) => invoke<PetManifest>('get_pet', { id }),
  getPetSprite: async (id: string) =>
    new Blob([await invoke<ArrayBuffer>('get_pet_sprite', { id })], { type: 'image/png' }),
  savePet: async (manifest: PetManifest, sprite: Blob) => {
    await invoke('save_pet_sprite', new Uint8Array(await sprite.arrayBuffer()), {
      headers: { 'pet-id': manifest.id },
    });
    await invoke('save_pet_manifest', { manifest });
  },
  deletePet: (id: string) => invoke('delete_pet', { id }),

  setHitMask: (cols: number, rows: number, bits: number[]) =>
    invoke('set_hit_mask', { cols, rows, bits }),
  userIdleSeconds: () => invoke<number>('get_user_idle_seconds'),

  ensureSegmentationAssets: (onProgress: (p: DownloadProgress) => void) => {
    const channel = new Channel<DownloadProgress>();
    channel.onmessage = onProgress;
    return invoke('ensure_segmentation_assets', { onProgress: channel });
  },
  readSegmentationAsset: (name: string) => invoke<ArrayBuffer>('read_segmentation_asset', { name }),

  openCreator: () => invoke('open_creator'),
  openSettings: () => invoke('open_settings'),
  openFriends: () => invoke('open_friends'),
  openChores: () => invoke('open_chores'),
  installUpdate: () => invoke('install_update'),
  tidyPreview: (folderId: ChoreFolder, petName: string, date: string) =>
    invoke<TidyPlan>('chores_preview', { folderId, petName, date }),
  tidyApply: (folderId: ChoreFolder, petName: string, date: string) =>
    invoke<TidyReport>('chores_apply', { folderId, petName, date }),
  undoLastTidy: () => invoke<UndoReport | null>('chores_undo_last'),
  tidyHistory: () => invoke<TidyBatch[]>('chores_history'),
  quickFolder: (name: string) => invoke<string>('quick_folder', { name }),
  quickNote: (title: string, body: string) => invoke<string>('quick_note', { title, body }),
  reveal: (path: string) => invoke('reveal', { path }),
  petsOut: () => invoke<number>('pets_out'),
  spawnVisitor: (id: string) => invoke('spawn_visitor', { id }),
};
