import { emit } from '@tauri-apps/api/event';
import { ipc, type ChoreFolder, type TidyReport, type UndoReport } from './ipc';

export const CHORES_DONE = 'chores://done';
export const CHORES_UNDONE = 'chores://undone';

export interface ChoresDone {
  folder: ChoreFolder;
  report: TidyReport;
}

export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Name used in "Tidied by <name>": the first pet that's out. */
export async function choresPetName(): Promise<string> {
  const [pets, s] = await Promise.all([ipc.listPets(), ipc.getSettings()]);
  const id = s.activePets.find((a) => pets.some((p) => p.id === a));
  return pets.find((p) => p.id === id)?.name ?? pets[0]?.name ?? 'DeskPals';
}

/** Tidies a folder and lets the pet celebrate. */
export async function runTidy(folder: ChoreFolder): Promise<TidyReport> {
  const report = await ipc.tidyApply(folder, await choresPetName(), today());
  if (report.moved > 0) await emit(CHORES_DONE, { folder, report } satisfies ChoresDone);
  return report;
}

export async function undoTidy(): Promise<UndoReport | null> {
  const r = await ipc.undoLastTidy();
  if (r) await emit(CHORES_UNDONE, r);
  return r;
}

export const CATEGORY_ICONS: Record<string, string> = {
  Images: '🖼️',
  Screenshots: '📸',
  Documents: '📄',
  Videos: '🎬',
  Archives: '🗜️',
  Code: '💻',
  Other: '📦',
};
