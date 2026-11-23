import type { CartoonFrame } from '@deskpals/shared';
import type { PetState } from './behavior';

/** Interactions that trigger a short-lived reaction face. */
export type Reaction = 'click' | 'hover' | 'shake' | 'spam' | 'nudge' | 'greet';

export interface ExpressionInput {
  state: PetState;
  sleepy: boolean;
  /** Seconds since the user last interacted with the pet. */
  sinceInteraction: number;
  /** Seconds since the user last touched the computer at all. */
  userIdle: number;
}

const LONELY_AFTER = 30 * 60;

/**
 * Chooses which cartoon frame to show. Base frame comes from the behaviour state; reactions
 * override it briefly; blinks, idle quirks and the walk cycle are timed here. Pure apart from
 * the injected clock/RNG, so it is unit-tested.
 */
export class Expressions {
  private reaction: { frame: CartoonFrame; until: number } | null = null;
  private blinkUntil = 0;
  private nextBlink: number;
  private nextQuirk: number;
  private clicks: number[] = [];
  private lastShake = -Infinity;

  constructor(
    private readonly available: ReadonlySet<string>,
    private readonly rng: () => number = Math.random,
    now = 0,
  ) {
    this.nextBlink = now + 2 + rng() * 4;
    this.nextQuirk = now + 20 + rng() * 25;
  }

  react(kind: Reaction, now: number) {
    const pick = (...frames: CartoonFrame[]) =>
      frames[Math.floor(this.rng() * frames.length)] ?? 'happy';
    switch (kind) {
      case 'click': {
        this.clicks = [...this.clicks.filter((t) => now - t < 3), now];
        if (this.clicks.length >= 5) return this.set('grumpy', now, 2.2);
        return this.set(pick('laugh', 'happy', 'laugh'), now, 1.6);
      }
      case 'hover':
        return this.set(pick('love', 'blush'), now, 2);
      case 'shake':
        this.lastShake = now;
        return this.set('dizzy', now, 2);
      case 'spam':
        return this.set('grumpy', now, 2.2);
      case 'nudge':
        return this.set('surprised', now, 1.5);
      case 'greet':
        return this.set('wave', now, 2);
    }
  }

  /** Frame to show at time `now` (seconds). */
  frame(input: ExpressionInput, now: number): CartoonFrame {
    if (this.reaction && now < this.reaction.until) return this.reaction.frame;
    this.reaction = null;

    const base = this.baseFrame(input, now);
    // Blinks only on calm, open-eyed faces.
    if (base === 'neutral' || base === 'happy' || base === 'sad') {
      if (now >= this.nextBlink) {
        this.blinkUntil = now + 0.15;
        this.nextBlink = now + 2.5 + this.rng() * 4.5;
      }
      if (now < this.blinkUntil) return this.ok('blink', base);
    }
    return base;
  }

  private baseFrame(input: ExpressionInput, now: number): CartoonFrame {
    switch (input.state) {
      case 'walk':
        return this.ok(Math.floor(now / 0.22) % 2 === 0 ? 'walk1' : 'walk2', 'neutral');
      case 'sit':
        return this.ok('sit', 'neutral');
      case 'sleep':
        return this.ok('asleep', 'sleepy');
      case 'wake':
        return this.ok('sleepy', 'neutral');
      case 'drag':
        return now - this.lastShake < 2
          ? this.ok('dizzy', 'surprised')
          : this.ok('surprised', 'neutral');
      case 'fall':
        return this.ok('surprised', 'neutral');
      case 'land':
        return now - this.lastShake < 3 ? this.ok('dizzy', 'neutral') : 'neutral';
      case 'petted':
        return this.ok('happy', 'neutral');
      case 'celebrate':
        return this.ok('celebrate', 'happy');
      case 'idle':
        break;
    }
    if (input.sleepy) return this.ok('sleepy', 'neutral');
    if (input.sinceInteraction > LONELY_AFTER && input.userIdle < 60) {
      // Lonely: mostly sad, now and then waving for attention.
      return Math.floor(now / 6) % 3 === 0 ? this.ok('wave', 'sad') : this.ok('sad', 'neutral');
    }
    if (now >= this.nextQuirk) {
      const quirks: CartoonFrame[] = ['wink', 'happy', 'wave', 'blush'];
      this.set(quirks[Math.floor(this.rng() * quirks.length)] ?? 'happy', now, 1.8);
      this.nextQuirk = now + 25 + this.rng() * 35;
      return this.reaction?.frame ?? 'neutral';
    }
    return 'neutral';
  }

  private set(frame: CartoonFrame, now: number, seconds: number) {
    if (this.available.has(frame)) this.reaction = { frame, until: now + seconds };
  }

  /** `frame` if the pet has it (a generation may have failed for some), else the fallback. */
  private ok(frame: CartoonFrame, fallback: CartoonFrame): CartoonFrame {
    return this.available.has(frame) ? frame : this.available.has(fallback) ? fallback : 'neutral';
  }
}
