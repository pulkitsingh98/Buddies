import { describe, expect, it } from 'vitest';
import {
  emptyState,
  inQuietHours,
  Wellbeing,
  type Context,
  type WellbeingConfig,
} from './wellbeing';

const MIN = 60_000;
const cfg = (over: Partial<WellbeingConfig> = {}): WellbeingConfig => ({
  reminders: {
    water: { enabled: true, everyMin: 60 },
    stretch: { enabled: true, everyMin: 45 },
    eye: { enabled: false, everyMin: 20 },
  },
  quietStart: 22,
  quietEnd: 8,
  dailyMessage: false,
  compliments: false,
  moodCheckin: false,
  ...over,
});
const ctx = (now: number, over: Partial<Context> = {}): Context => ({
  now,
  hour: 14,
  day: '2026-11-23',
  userIdleSec: 0,
  busy: false,
  ...over,
});

describe('Wellbeing reminders', () => {
  it('fires each reminder on its schedule, once', () => {
    const w = new Wellbeing(cfg(), emptyState('2026-11-23'));
    expect(w.next(ctx(0))).toBeNull();
    expect(w.next(ctx(44 * MIN))).toBeNull();
    expect(w.next(ctx(45 * MIN))).toEqual({ type: 'reminder', kind: 'stretch' });
    expect(w.next(ctx(45.5 * MIN))).toBeNull(); // in flight, not repeated
    expect(w.next(ctx(60 * MIN))).toEqual({ type: 'reminder', kind: 'water' });
  });

  it('done reschedules and counts water; snooze delays', () => {
    const w = new Wellbeing(cfg(), emptyState('2026-11-23'));
    w.next(ctx(0));
    expect(w.next(ctx(60 * MIN))?.type).toBe('reminder');
    w.done('water', 60 * MIN);
    expect(w.state.waterGlasses).toBe(1);
    expect(w.state.next.water).toBe(120 * MIN);
    w.snooze('stretch', 60 * MIN);
    expect(w.state.next.stretch).toBe(70 * MIN);
  });

  it('respects quiet hours, busy and an absent user', () => {
    const w = new Wellbeing(cfg(), emptyState('2026-11-23'));
    w.next(ctx(0));
    expect(w.next(ctx(50 * MIN, { hour: 23 }))).toBeNull();
    expect(w.next(ctx(50 * MIN, { busy: true }))).toBeNull();
    expect(w.next(ctx(50 * MIN, { userIdleSec: 120 }))).toBeNull();
    expect(w.next(ctx(50 * MIN))).toEqual({ type: 'reminder', kind: 'stretch' });
  });

  it('treats being away as a stretch/eye break', () => {
    const w = new Wellbeing(cfg(), emptyState('2026-11-23'));
    w.next(ctx(0));
    w.next(ctx(40 * MIN, { userIdleSec: 600 }));
    expect(w.state.next.stretch).toBe(85 * MIN);
    expect(w.state.next.water).toBe(60 * MIN);
  });

  it('only schedules enabled reminders', () => {
    const w = new Wellbeing(cfg(), emptyState('2026-11-23'));
    w.next(ctx(0));
    expect(w.state.next.eye).toBeUndefined();
  });
});

describe('daily things', () => {
  it('sends the kind message once a day after 7am, mood check-in after noon', () => {
    const w = new Wellbeing(
      cfg({ dailyMessage: true, moodCheckin: true }),
      emptyState('2026-11-23'),
    );
    expect(w.next(ctx(0, { hour: 6 }))).toBeNull();
    expect(w.next(ctx(1, { hour: 9 }))).toEqual({ type: 'goodMessage' });
    expect(w.next(ctx(2, { hour: 10 }))).toBeNull();
    expect(w.next(ctx(3, { hour: 13 }))).toEqual({ type: 'mood' });
    expect(w.next(ctx(4, { hour: 9, day: '2026-11-24' }))).toEqual({ type: 'goodMessage' });
  });

  it('sometimes checks in again in the evening', () => {
    const yes = new Wellbeing(cfg({ moodCheckin: true }), emptyState('2026-11-23'), () => 0.2);
    expect(yes.next(ctx(1, { hour: 13 }))).toEqual({ type: 'mood' });
    expect(yes.next(ctx(2, { hour: 19 }))).toEqual({ type: 'mood' });
    expect(yes.next(ctx(3, { hour: 20 }))).toBeNull();
    const no = new Wellbeing(cfg({ moodCheckin: true }), emptyState('2026-11-23'), () => 0.9);
    no.next(ctx(1, { hour: 13 }));
    expect(no.next(ctx(2, { hour: 19 }))).toBeNull();
  });

  it('resets water count at midnight and tracks a focus streak', () => {
    const w = new Wellbeing(cfg(), emptyState('2026-11-23'));
    w.done('water', 0);
    w.focusCompleted('2026-11-23', '2026-11-22');
    w.focusCompleted('2026-11-23', '2026-11-22');
    expect([w.state.focusSessionsToday, w.state.focusStreak]).toEqual([2, 1]);
    w.focusCompleted('2026-11-24', '2026-11-23');
    expect([w.state.focusSessionsToday, w.state.focusStreak, w.state.waterGlasses]).toEqual([
      1, 2, 0,
    ]);
    w.focusCompleted('2026-11-27', '2026-11-26');
    expect(w.state.focusStreak).toBe(1);
  });
});

describe('inQuietHours', () => {
  it('handles ranges that wrap midnight', () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(13, 0, 0)).toBe(false);
  });
});
