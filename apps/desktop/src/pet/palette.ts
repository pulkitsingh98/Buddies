/**
 * Picks a pet's signature colour from its sprite (the most common saturated hue among opaque
 * pixels, ignoring outlines and near-white/near-black) and derives a soft bubble palette from it.
 */
export interface Palette {
  hue: number;
  bg: string;
  bg2: string;
  border: string;
  text: string;
  button: string;
  buttonHover: string;
  accent: string;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Dominant hue (degrees) of the opaque, reasonably colourful pixels; null if there are none. */
export function dominantHue(rgba: ArrayLike<number>, step = 3): number | null {
  const bins = new Float64Array(36);
  for (let i = 0; i < rgba.length; i += 4 * step) {
    if ((rgba[i + 3] ?? 0) < 200) continue;
    const [h, s, l] = rgbToHsl(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
    if (s < 0.25 || l < 0.18 || l > 0.9) continue;
    bins[Math.floor(h / 10) % 36] = (bins[Math.floor(h / 10) % 36] ?? 0) + s;
  }
  let best = -1;
  let bestW = 0;
  for (let i = 0; i < 36; i++) {
    // smooth over neighbours so a hue split across two bins still wins
    const w = (bins[(i + 35) % 36] ?? 0) * 0.5 + (bins[i] ?? 0) + (bins[(i + 1) % 36] ?? 0) * 0.5;
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  return best < 0 ? null : best * 10 + 5;
}

/** Soft, readable bubble colours in the pet's hue (warm peach when it has no clear colour). */
export function bubblePalette(hue: number | null): Palette {
  const h = Math.round(hue ?? 22);
  return {
    hue: h,
    bg: `hsl(${h} 100% 97%)`,
    bg2: `hsl(${(h + 25) % 360} 90% 93%)`,
    border: `hsl(${h} 70% 78%)`,
    text: `hsl(${h} 35% 22%)`,
    button: `hsl(${h} 90% 90%)`,
    buttonHover: `hsl(${h} 90% 84%)`,
    accent: `hsl(${h} 70% 55%)`,
  };
}
