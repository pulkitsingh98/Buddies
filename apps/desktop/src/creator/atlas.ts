import type { RawImage } from './stylize';

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Atlas {
  image: RawImage;
  cellW: number;
  cellH: number;
  frames: Record<string, FrameRect>;
}

/** Union bounding box of non-transparent pixels across same-sized frames. */
export function unionBounds(frames: RawImage[], threshold = 16): FrameRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if ((f.data[(y * f.width + x) * 4 + 3] ?? 0) > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Grid layout for `n` cells of size cellW×cellH: returns each cell's rect and the sheet size. */
export function gridLayout(n: number, cellW: number, cellH: number, cols = 6) {
  const c = Math.min(cols, n);
  const rows = Math.ceil(n / c);
  const rects: FrameRect[] = [];
  for (let i = 0; i < n; i++) {
    rects.push({ x: (i % c) * cellW, y: Math.floor(i / c) * cellH, w: cellW, h: cellH });
  }
  return { rects, width: c * cellW, height: rows * cellH };
}
