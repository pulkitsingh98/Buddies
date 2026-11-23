import { CARTOON_FRAMES, type PetKind, type PetManifest, type PetStyle } from '@deskpals/shared';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { gridLayout, unionBounds } from './atlas';
import { outline, pad, trim, type RawImage } from './stylize';

export interface PetGeneratorInput {
  name: string;
  kind: PetKind;
  consentConfirmed: boolean;
  /** The framed, background-removed subject (alpha = subject). Used by the cutout style. */
  cutout?: RawImage;
  /** The original photo, for styles that redraw it (Phase 5). Never stored. */
  photo?: ImageBitmap;
}

export interface GeneratedPet {
  manifest: PetManifest;
  sprite: Blob;
}

/**
 * Turns a user's photo into a renderable pet. New styles (e.g. an Edge-Function-backed
 * "stylized" redraw producing a sprite sheet) implement this and keep the same manifest contract.
 */
export interface PetGenerator {
  readonly style: PetStyle;
  generate(
    input: PetGeneratorInput,
    onProgress?: (p: GenerationProgress) => void,
  ): Promise<GeneratedPet>;
}

export interface GenerationProgress {
  total: number;
  /** Frame id → data URL, as each image arrives. */
  previews: Record<string, string>;
  failed: string[];
}

/** Max sprite height in px: enough for the largest pet size on a 2× display. */
const MAX_SPRITE_H = 512;
const MAX_SPRITE_W = 640;

/** Phase 1 style: the cutout itself, with a sticker outline and a chibi squash at render time. */
export class CutoutGenerator implements PetGenerator {
  readonly style = 'cutout' as const;

  async generate(input: PetGeneratorInput): Promise<GeneratedPet> {
    if (!input.cutout) throw new Error('No cutout to make a pet from.');
    const trimmed = trim(input.cutout);
    if (!trimmed) throw new Error('The cutout is empty — try adjusting the edges or framing.');
    const scaled = resize(
      trimmed,
      Math.min(1, MAX_SPRITE_H / trimmed.height, MAX_SPRITE_W / trimmed.width),
    );
    const thickness = Math.max(3, Math.round(scaled.height * 0.022));
    const styled = trim(outline(pad(scaled, thickness + 2), thickness)) ?? scaled;
    const sprite = await toPng(styled);
    const manifest: PetManifest = {
      version: 1,
      id: crypto.randomUUID(),
      name: input.name.trim().slice(0, 40),
      kind: input.kind,
      style: this.style,
      createdAt: new Date().toISOString(),
      consentConfirmed: input.consentConfirmed,
      sprite: {
        file: 'sprite.png',
        width: styled.width,
        height: styled.height,
        frames: { neutral: [{ x: 0, y: 0, w: styled.width, h: styled.height }] },
      },
      render: { squash: 0.94 },
    };
    return { manifest, sprite };
  }
}

/** Frame cell height in the sprite sheet (px): crisp at the largest pet size on a 2× display. */
const CELL_H = 384;
const PARALLEL = 4;
const RETRIES = 2;

/**
 * Cartoon style: an image model redraws the photo as a character, then draws it again in every
 * expression/pose of {@link CARTOON_FRAMES}, using the first drawing as the reference.
 * Runs in the `generate-pet` Edge Function (the API key never reaches the app).
 */
export class CartoonGenerator implements PetGenerator {
  readonly style = 'stylized' as const;

  async generate(
    input: PetGeneratorInput,
    onProgress?: (p: GenerationProgress) => void,
  ): Promise<GeneratedPet> {
    if (!input.photo) throw new Error('No photo to make a pet from.');
    const progress: GenerationProgress = { total: CARTOON_FRAMES.length, previews: {}, failed: [] };
    const report = () => onProgress?.({ ...progress, previews: { ...progress.previews } });
    report();

    const base = await callGenerator({
      mode: 'character',
      kind: input.kind,
      photo: photoDataUrl(input.photo),
    });
    progress.previews.neutral = base;
    report();

    // Remaining frames, a few at a time, each referencing the base drawing.
    const queue: string[] = CARTOON_FRAMES.filter((f) => f !== 'neutral');
    let fatal: Error | null = null;
    const worker = async () => {
      for (let frame = queue.shift(); frame && !fatal; frame = queue.shift()) {
        for (let attempt = 0; ; attempt++) {
          try {
            progress.previews[frame] = await callGenerator({
              mode: 'frame',
              frame,
              reference: base,
            });
            break;
          } catch (e) {
            if (e instanceof QuotaError) fatal = e;
            if (e instanceof QuotaError || attempt >= RETRIES) {
              progress.failed.push(frame);
              break;
            }
          }
        }
        report();
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (fatal) throw fatal;

    // Shared framing for every frame, then pack into one sprite sheet.
    const ids = Object.keys(progress.previews);
    const images = await Promise.all(ids.map((id) => decodeDataUrl(progress.previews[id] ?? '')));
    const bounds = unionBounds(images);
    if (!bounds) throw new Error('The generated images were empty. Please try again.');
    const scale = Math.min(1, CELL_H / bounds.h);
    const cellW = Math.round(bounds.w * scale);
    const cellH = Math.round(bounds.h * scale);
    const layout = gridLayout(ids.length, cellW, cellH);
    const sheet = new OffscreenCanvas(layout.width, layout.height);
    const ctx = sheet.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    const frames: Record<string, { x: number; y: number; w: number; h: number }[]> = {};
    ids.forEach((id, i) => {
      const r = layout.rects[i];
      const img = images[i];
      if (!r || !img) return;
      ctx.drawImage(toCanvas(img), bounds.x, bounds.y, bounds.w, bounds.h, r.x, r.y, r.w, r.h);
      frames[id] = [r];
    });

    const manifest: PetManifest = {
      version: 1,
      id: crypto.randomUUID(),
      name: input.name.trim().slice(0, 40),
      kind: input.kind,
      style: this.style,
      createdAt: new Date().toISOString(),
      consentConfirmed: input.consentConfirmed,
      sprite: { file: 'sprite.png', width: cellW, height: cellH, frames },
      render: { squash: 1 },
    };
    return { manifest, sprite: await sheet.convertToBlob({ type: 'image/png' }) };
  }
}

export class QuotaError extends Error {}

async function callGenerator(body: Record<string, string>): Promise<string> {
  if (!supabase) throw new Error('Not connected to the server.');
  const { data, error } = await supabase.functions.invoke<{ image: string }>('generate-pet', {
    body,
  });
  if (error) {
    let message = error.message;
    let status = 0;
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      status = res.status;
      message =
        ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? message;
    }
    throw status === 429 ? new QuotaError(message) : new Error(message);
  }
  if (!data?.image) throw new Error('No image returned.');
  return data.image;
}

/** JPEG data URL of the photo, at most 1024px on its long side. */
function photoDataUrl(photo: ImageBitmap): string {
  const s = Math.min(1, 1024 / Math.max(photo.width, photo.height));
  const c = document.createElement('canvas');
  c.width = Math.round(photo.width * s);
  c.height = Math.round(photo.height * s);
  c.getContext('2d')?.drawImage(photo, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

async function decodeDataUrl(url: string): Promise<RawImage> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

export function toCanvas(img: RawImage): OffscreenCanvas {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')?.putImageData(
    new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
    0,
    0,
  );
  return c;
}

export function resize(img: RawImage, scale: number): RawImage {
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(toCanvas(img), 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

export function toPng(img: RawImage): Promise<Blob> {
  return toCanvas(img).convertToBlob({ type: 'image/png' });
}
