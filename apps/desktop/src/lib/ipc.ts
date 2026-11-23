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
};
