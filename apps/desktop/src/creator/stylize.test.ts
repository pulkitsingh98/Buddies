import { describe, expect, it } from 'vitest';
import { adjustEdge, distanceTransform, outline, pad, trim, type RawImage } from './stylize';

/** w×h transparent image with an opaque red square [x0,x1)×[y0,y1). */
function square(w: number, h: number, x0: number, y0: number, x1: number, y1: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) data.set([255, 0, 0, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const alpha = (img: RawImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3] ?? 0;

describe('distanceTransform', () => {
  it('computes exact euclidean distances', () => {
    const f = new Uint8Array(25);
    f[12] = 1; // centre of 5×5
    const d = distanceTransform(f, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[18]).toBeCloseTo(Math.SQRT2);
    expect(d[0]).toBeCloseTo(Math.sqrt(8));
  });
});

describe('outline', () => {
  it('adds a white ring of the requested thickness and keeps the subject on top', () => {
    const img = outline(pad(square(10, 10, 0, 0, 10, 10), 6), 3);
    // inside: still red
    expect(
      Array.from(img.data.subarray((8 * img.width + 8) * 4, (8 * img.width + 8) * 4 + 4)),
    ).toEqual([255, 0, 0, 255]);
    // 2px outside the left edge: white & opaque
    const i = (10 * img.width + 4) * 4;
    expect(Array.from(img.data.subarray(i, i + 4))).toEqual([255, 255, 255, 255]);
    // 5px outside: transparent
    expect(alpha(img, 1, 10)).toBe(0);
  });
});

describe('adjustEdge', () => {
  it('grows and shrinks the mask', () => {
    const base = square(20, 20, 5, 5, 15, 15);
    expect(alpha(adjustEdge(base, 2), 3, 10)).toBe(255);
    expect(alpha(base, 3, 10)).toBe(0);
    expect(alpha(adjustEdge(base, -2), 6, 10)).toBe(0);
    expect(alpha(adjustEdge(base, -2), 10, 10)).toBe(255);
  });
});

describe('trim', () => {
  it('crops to the opaque bounding box', () => {
    const t = trim(square(30, 20, 4, 6, 14, 9));
    expect(t && [t.width, t.height]).toEqual([10, 3]);
  });
  it('returns null for an empty image', () => {
    expect(trim(square(5, 5, 0, 0, 0, 0))).toBeNull();
  });
});
