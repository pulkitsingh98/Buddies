import { describe, expect, it } from 'vitest';
import { bubblePalette, dominantHue } from './palette';

const pixels = (...colors: [number, number, number, number][]) => {
  const out: number[] = [];
  for (const c of colors) for (let i = 0; i < 30; i++) out.push(...c);
  return out;
};

describe('dominantHue', () => {
  it('finds the main colour and ignores outlines, white and transparency', () => {
    const rgba = pixels(
      [250, 140, 160, 255], // pink (most)
      [250, 140, 160, 255],
      [20, 20, 20, 255], // outline
      [255, 255, 255, 255], // white
      [40, 200, 40, 0], // transparent green
    );
    const h = dominantHue(rgba, 1) ?? -1;
    expect(h > 330 || (h >= 0 && h < 10)).toBe(true);
  });

  it('is null for a greyscale pet', () => {
    expect(dominantHue(pixels([120, 120, 120, 255]), 1)).toBeNull();
  });
});

describe('bubblePalette', () => {
  it('derives light background and dark text in the same hue', () => {
    const p = bubblePalette(200);
    expect(p.bg).toBe('hsl(200 100% 97%)');
    expect(p.text).toBe('hsl(200 35% 22%)');
    expect(bubblePalette(null).hue).toBe(22);
  });
});
