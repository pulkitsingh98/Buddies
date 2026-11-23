import { describe, expect, it } from 'vitest';
import { gridLayout, unionBounds } from './atlas';

const img = (w: number, h: number, on: [number, number][]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of on) data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
};

describe('unionBounds', () => {
  it('covers every frame so poses keep a shared framing', () => {
    expect(unionBounds([img(10, 10, [[2, 3]]), img(10, 10, [[7, 8]])])).toEqual({
      x: 2,
      y: 3,
      w: 6,
      h: 6,
    });
  });
  it('is null when everything is transparent', () => {
    expect(unionBounds([img(4, 4, [])])).toBeNull();
  });
});

describe('gridLayout', () => {
  it('packs cells row-major', () => {
    const g = gridLayout(8, 10, 20, 6);
    expect([g.width, g.height]).toEqual([60, 40]);
    expect(g.rects[7]).toEqual({ x: 10, y: 20, w: 10, h: 20 });
  });
});
