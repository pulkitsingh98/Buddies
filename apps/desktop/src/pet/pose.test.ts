import { describe, expect, it } from 'vitest';
import { floorOffset, LIE_ANGLE, restPose, tickHz } from './pose';

describe('restPose', () => {
  it('lies down and dims when asleep', () => {
    const p = restPose('sleep', false);
    expect(p.rotation).toBe(LIE_ANGLE);
    expect(p.opacity).toBeLessThan(1);
  });

  it('clamps the drag lean', () => {
    expect(restPose('drag', false, 5).rotation).toBe(0.5);
    expect(restPose('drag', false, -5).rotation).toBe(-0.5);
  });

  it('droops slightly when sleepy', () => {
    expect(restPose('idle', true).rotation).toBeGreaterThan(0);
  });
});

describe('floorOffset', () => {
  it('is zero for an upright, unscaled pose', () => {
    expect(floorOffset(restPose('idle', false), 100, 150)).toBeCloseTo(0);
  });

  it('pushes a squashed (sitting) pet back down onto the floor', () => {
    // 10% shorter about the centre → bottom rises 7.5px on a 150px pet; offset brings it back.
    expect(floorOffset(restPose('sit', false), 100, 150)).toBeCloseTo(7.5);
  });

  it('keeps a lying pet on the floor', () => {
    const w = 100;
    const h = 150;
    const p = restPose('sleep', false);
    const halfV = (Math.abs(Math.cos(p.rotation)) * h + Math.abs(Math.sin(p.rotation)) * w) / 2;
    // centre + offset + half the rotated height = the floor (box bottom)
    expect(h / 2 + floorOffset(p, w, h) + halfV).toBeCloseTo(h);
  });
});

describe('tickHz', () => {
  it('only runs fast while the window has to move', () => {
    expect(tickHz('idle')).toBe(1);
    expect(tickHz('sit')).toBe(1);
    expect(tickHz('sleep')).toBe(1);
    expect(tickHz('walk')).toBeGreaterThanOrEqual(20);
    expect(tickHz('drag')).toBe(30);
  });
});
