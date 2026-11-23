import { describe, expect, it } from 'vitest';
import { Behavior, type BehaviorConfig, type World, isLate } from './behavior';

const cfg: BehaviorConfig = {
  sleepAfterSec: 300,
  bedtimeHour: 23,
  reducedMotion: false,
  walkSpeed: 60,
};
const world = (over: Partial<World> = {}): World => ({
  minX: 0,
  maxX: 1000,
  userIdleSec: 0,
  hour: 14,
  ...over,
});

/** Deterministic RNG cycling through the given values. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

const run = (b: Behavior, seconds: number, w = world(), dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) b.tick(dt, w);
};

describe('Behavior', () => {
  it('starts idle and eventually walks to a target inside the bounds', () => {
    // rng: idle duration 0 → 5s; choose walk (0.1 < 0.35); target 0.9 → x=900
    const b = new Behavior(cfg, 100, seq(0, 0.1, 0.9));
    expect(b.state).toBe('idle');
    run(b, 5.1);
    expect(b.state).toBe('walk');
    expect(b.targetX).toBeCloseTo(900);
    expect(b.dir).toBe(1);
    run(b, 800 / 60 + 0.1); // 800px at 60px/s
    expect(b.x).toBeCloseTo(900);
    expect(b.state).not.toBe('walk');
  });

  it('never walks with reduced motion', () => {
    const b = new Behavior({ ...cfg, reducedMotion: true }, 100, seq(0.01));
    for (let i = 0; i < 100; i++) {
      run(b, 1);
      expect(b.state).not.toBe('walk');
    }
  });

  it('falls asleep when the user is idle and wakes when they return', () => {
    const b = new Behavior(cfg, 100, seq(0.5));
    b.tick(0.1, world({ userIdleSec: 301 }));
    expect(b.state).toBe('sleep');
    run(b, 10, world({ userIdleSec: 400 }));
    expect(b.state).toBe('sleep');
    b.tick(0.1, world({ userIdleSec: 0.5 }));
    expect(b.state).toBe('wake');
    run(b, 1.3);
    expect(b.state).toBe('idle');
  });

  it('petting a sleeping pet wakes it; petting an awake pet makes hearts', () => {
    const b = new Behavior(cfg, 100, seq(0.5));
    b.tick(0.1, world({ userIdleSec: 999 }));
    b.dispatch({ type: 'pet' });
    expect(b.state).toBe('wake');
    run(b, 1.3);
    b.drainEffects();
    b.dispatch({ type: 'pet' });
    expect(b.state).toBe('petted');
    expect(b.drainEffects()).toEqual(['hearts']);
  });

  it('drag → drop in the air → falls under gravity → lands → idle', () => {
    const b = new Behavior(cfg, 100, seq(0.5));
    b.dispatch({ type: 'dragStart' });
    b.dispatch({ type: 'dragMove', x: 400, lift: 300 });
    b.tick(1 / 30, world());
    expect(b.state).toBe('drag');
    expect(b.x).toBe(400);
    b.dispatch({ type: 'dragEnd' });
    expect(b.state).toBe('fall');
    run(b, 0.6);
    expect(b.lift).toBe(0);
    expect(b.drainEffects()).toContain('land');
    run(b, 0.5);
    expect(b.state).toBe('idle');
  });

  it('cannot be interrupted by petting or celebrating while held', () => {
    const b = new Behavior(cfg, 100);
    b.dispatch({ type: 'dragStart' });
    b.dispatch({ type: 'pet' });
    b.dispatch({ type: 'celebrate' });
    expect(b.state).toBe('drag');
  });

  it('celebrates for a while and then returns to idle', () => {
    const b = new Behavior(cfg, 100, seq(0.5));
    b.dispatch({ type: 'celebrate' });
    expect(b.state).toBe('celebrate');
    run(b, 2.5);
    expect(b.state).toBe('idle');
  });

  it('stays within screen bounds when the monitor shrinks', () => {
    const b = new Behavior(cfg, 1800, seq(0.99));
    b.tick(0.1, world({ maxX: 1000 }));
    expect(b.x).toBeLessThanOrEqual(1000);
  });

  it('nudges about bedtime once per night', () => {
    const b = new Behavior(cfg, 100, seq(0.99));
    b.tick(0.1, world({ hour: 22 }));
    expect(b.drainEffects()).toEqual([]);
    b.tick(0.1, world({ hour: 23 }));
    expect(b.drainEffects()).toEqual(['bedtimeNudge']);
    run(b, 5, world({ hour: 23 }));
    b.tick(0.1, world({ hour: 1 }));
    expect(b.drainEffects()).toEqual([]);
    expect(b.sleepy).toBe(true);
  });

  it('knows what counts as late', () => {
    expect(isLate(23, 23)).toBe(true);
    expect(isLate(2, 23)).toBe(true);
    expect(isLate(5, 23)).toBe(false);
    expect(isLate(22, 23)).toBe(false);
  });
});
