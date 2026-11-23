import { describe, expect, it } from 'vitest';
import { FocusTimer } from './focus';

describe('FocusTimer', () => {
  it('runs a focus session then a break', () => {
    const t = new FocusTimer();
    t.startFocus(0, 25);
    expect(t.remaining(60_000)).toBe('24:00');
    expect(t.tick(25 * 60_000 - 1)).toBeNull();
    expect(t.tick(25 * 60_000)).toBe('focusDone');
    expect(t.phase).toBe('idle');
    t.startBreak(0, 5);
    expect(t.tick(5 * 60_000)).toBe('breakDone');
  });

  it('can be stopped early', () => {
    const t = new FocusTimer();
    t.startFocus(0, 25);
    t.stop();
    expect(t.tick(30 * 60_000)).toBeNull();
  });
});
