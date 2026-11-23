/**
 * Wellbeing scheduler: water/stretch/eye reminders, the daily kind message, a daily mood
 * check-in and occasional compliments. Pure (time is passed in) so it is unit-tested; the pet
 * page delivers prompts as speech bubbles and persists {@link WellbeingState}.
 */

export type ReminderKind = 'water' | 'stretch' | 'eye';
export const REMINDER_KINDS: ReminderKind[] = ['water', 'stretch', 'eye'];

export interface WellbeingConfig {
  reminders: Record<ReminderKind, { enabled: boolean; everyMin: number }>;
  quietStart: number;
  quietEnd: number;
  dailyMessage: boolean;
  compliments: boolean;
  moodCheckin: boolean;
}

export interface WellbeingState {
  /** Local date (YYYY-MM-DD) the daily counters belong to. */
  day: string;
  waterGlasses: number;
  /** Epoch ms each reminder is next due. */
  next: Partial<Record<ReminderKind, number>>;
  goodMessageDay?: string;
  moodDay?: string;
  /** Day of the (sometimes) evening check-in decision. */
  moodEveningDay?: string;
  mood?: string;
  nextCompliment?: number;
  focusSessionsToday: number;
  focusStreak: number;
  lastFocusDay?: string;
}

export type Prompt =
  | { type: 'reminder'; kind: ReminderKind }
  | { type: 'goodMessage' }
  | { type: 'mood' }
  | { type: 'compliment' };

export interface Context {
  now: number;
  /** Local hour 0–23. */
  hour: number;
  /** Local date YYYY-MM-DD. */
  day: string;
  userIdleSec: number;
  /** Something else is going on (bubble open, being dragged, focus session, full-screen app). */
  busy: boolean;
}

const MIN = 60_000;
/** Away this long counts as a break: stretch/eye timers restart when you return. */
const AWAY_RESET_SEC = 5 * 60;
/** Don't talk to someone who isn't at the computer. */
const ACTIVE_IDLE_SEC = 60;
/** While a prompt is showing, don't re-fire it for this long. */
const IN_FLIGHT_MS = 2 * MIN;

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyState(day: string): WellbeingState {
  return { day, waterGlasses: 0, next: {}, focusSessionsToday: 0, focusStreak: 0 };
}

export class Wellbeing {
  constructor(
    public cfg: WellbeingConfig,
    public state: WellbeingState,
    private readonly rng: () => number = Math.random,
  ) {}

  /** The prompt to show now, if any. Mutates state (marks it in flight); caller persists. */
  next(ctx: Context): Prompt | null {
    this.rollDay(ctx.day);
    const { now } = ctx;
    // Fill in schedules for newly enabled reminders.
    for (const k of REMINDER_KINDS) {
      const r = this.cfg.reminders[k];
      if (r.enabled && this.state.next[k] === undefined)
        this.state.next[k] = now + r.everyMin * MIN;
      if (!r.enabled) this.state.next[k] = undefined;
    }
    this.state.nextCompliment ??= now + this.complimentGap();

    if (ctx.userIdleSec >= AWAY_RESET_SEC) {
      for (const k of ['stretch', 'eye'] as const) {
        const r = this.cfg.reminders[k];
        if (r.enabled)
          this.state.next[k] = Math.max(this.state.next[k] ?? 0, now + r.everyMin * MIN);
      }
      return null;
    }
    if (ctx.busy || ctx.userIdleSec >= ACTIVE_IDLE_SEC) return null;
    if (inQuietHours(ctx.hour, this.cfg.quietStart, this.cfg.quietEnd)) return null;

    for (const k of REMINDER_KINDS) {
      const due = this.state.next[k];
      if (this.cfg.reminders[k].enabled && due !== undefined && now >= due) {
        this.state.next[k] = now + IN_FLIGHT_MS;
        return { type: 'reminder', kind: k };
      }
    }
    if (this.cfg.dailyMessage && this.state.goodMessageDay !== ctx.day && ctx.hour >= 7) {
      this.state.goodMessageDay = ctx.day;
      return { type: 'goodMessage' };
    }
    if (this.cfg.moodCheckin && this.state.moodDay !== ctx.day && ctx.hour >= 12) {
      this.state.moodDay = ctx.day;
      return { type: 'mood' };
    }
    // Sometimes the pet checks in again in the evening (about half the days).
    if (this.cfg.moodCheckin && this.state.moodEveningDay !== ctx.day && ctx.hour >= 18) {
      this.state.moodEveningDay = ctx.day;
      if (this.rng() < 0.5) return { type: 'mood' };
    }
    if (this.cfg.compliments && now >= (this.state.nextCompliment ?? Infinity)) {
      this.state.nextCompliment = now + this.complimentGap();
      return { type: 'compliment' };
    }
    return null;
  }

  done(kind: ReminderKind, now: number) {
    if (kind === 'water') this.state.waterGlasses++;
    this.state.next[kind] = now + this.cfg.reminders[kind].everyMin * MIN;
  }

  snooze(kind: ReminderKind, now: number, minutes = 10) {
    this.state.next[kind] = now + minutes * MIN;
  }

  setMood(mood: string) {
    this.state.mood = mood;
  }

  /** A focus session finished: count it and extend the daily streak. */
  focusCompleted(day: string, yesterday: string) {
    this.rollDay(day);
    this.state.focusSessionsToday++;
    if (this.state.lastFocusDay !== day) {
      this.state.focusStreak =
        this.state.lastFocusDay === yesterday ? this.state.focusStreak + 1 : 1;
      this.state.lastFocusDay = day;
    }
  }

  private rollDay(day: string) {
    if (this.state.day === day) return;
    this.state.day = day;
    this.state.waterGlasses = 0;
    this.state.focusSessionsToday = 0;
  }

  /** 2–4 hours between compliments. */
  private complimentGap() {
    return (120 + this.rng() * 120) * MIN;
  }
}
