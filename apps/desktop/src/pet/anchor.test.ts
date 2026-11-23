import { describe, expect, it } from 'vitest';
import { alignOffset, frameAnchor } from './anchor';

/** w×h alpha with an opaque rectangle. */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const a = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * w + x] = 255;
  return a;
}

describe('frameAnchor / alignOffset', () => {
  it('finds the feet and lines a shifted frame up with the reference', () => {
    const ref = frameAnchor(rect(100, 100, 40, 10, 60, 90), 100, 100);
    const shifted = frameAnchor(rect(100, 100, 46, 6, 66, 86), 100, 100);
    expect(ref).toEqual({ x: 49.5, bottom: 89 });
    expect(shifted && ref && alignOffset(ref, shifted, 100, 100)).toEqual({ dx: -6, dy: 4 });
  });

  it('ignores decorations above the feet (hearts, confetti)', () => {
    const a = rect(100, 100, 40, 30, 60, 90);
    for (let x = 0; x < 10; x++) a[5 * 100 + x] = 255; // a "heart" far left near the top
    expect(frameAnchor(a, 100, 100)?.x).toBeCloseTo(49.5);
  });

  it('caps large offsets', () => {
    expect(alignOffset({ x: 50, bottom: 90 }, { x: 0, bottom: 10 }, 100, 100)).toEqual({
      dx: 15,
      dy: 15,
    });
  });
});
