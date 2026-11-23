import type { PetKind, PetManifest, PetStyle } from '@deskpals/shared';
import { outline, pad, trim, type RawImage } from './stylize';

export interface PetGeneratorInput {
  name: string;
  kind: PetKind;
  consentConfirmed: boolean;
  /** The framed, background-removed subject (alpha = subject). */
  cutout: RawImage;
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
  generate(input: PetGeneratorInput): Promise<GeneratedPet>;
}

/** Max sprite height in px: enough for the largest pet size on a 2× display. */
const MAX_SPRITE_H = 512;
const MAX_SPRITE_W = 640;

/** Phase 1 style: the cutout itself, with a sticker outline and a chibi squash at render time. */
export class CutoutGenerator implements PetGenerator {
  readonly style = 'cutout' as const;

  async generate(input: PetGeneratorInput): Promise<GeneratedPet> {
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
      sprite: { file: 'sprite.png', width: styled.width, height: styled.height },
      render: { squash: 0.94 },
    };
    return { manifest, sprite };
  }
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
