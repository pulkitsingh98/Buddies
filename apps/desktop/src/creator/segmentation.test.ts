import { describe, expect, it } from 'vitest';
import { toAlphaMask, toModelInput } from './segmentation';

describe('segmentation pre/post-processing', () => {
  it('produces NCHW planes normalised by the image max minus 0.5', () => {
    const rgba = new Uint8Array([200, 100, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const t = toModelInput(rgba, 2);
    expect(t.length).toBe(12);
    expect(t[0]).toBeCloseTo(0.5); // R of px0: 200/200 - 0.5
    expect(t[4]).toBeCloseTo(0); // G plane, px0: 100/200 - 0.5
    expect(t[8]).toBeCloseTo(-0.5); // B plane
  });

  it('min-max normalises the output to 0..255', () => {
    expect(Array.from(toAlphaMask([2, 4, 6, 4], 2))).toEqual([0, 128, 255, 128]);
  });
});
