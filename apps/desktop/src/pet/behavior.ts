/**
 * The pet's behaviour state machine. Pure and deterministic given an RNG, so it is unit-tested
 * without a window. Positions are in logical screen pixels: `x` is the pet window's left edge,
 * `lift` is how far the window is above its resting place on the "floor" (bottom of the work area).
 */

export type PetState =
  'idle' | 'walk' | 'sit' | 'sleep' | 'wake' | 'drag' | 'fall' | 'land' | 'petted' | 'celebrate';

export interface BehaviorConfig {
  /** Seconds of user inactivity before the pet falls asleep. */
  sleepAfterSec: number;
  /** Local hour from which the pet is sleepy (until 05:00). */
  bedtimeHour: number;
  reducedMotion: boolean;
  /** Walking speed in px/s. */
  walkSpeed: number;
  /** Stay sitting beside the user (focus sessions). */
  stayPut?: boolean;
}

export interface World {
  minX: number;
  maxX: number;
  userIdleSec: number;
  /** Local hour 0–23. */
  hour: number;
}

export type BehaviorEvent =
  | { type: 'dragStart' }
  | { type: 'dragMove'; x: number; lift: number }
  | { type: 'dragEnd' }
  | { type: 'pet' }
  | { type: 'celebrate' };

/** One-shot side effects for the renderer/UI to act on. */
export type Effect = 'hearts' | 'bedtimeNudge' | 'land';

export const GRAVITY = 2600; // px/s²
const WAKE_SEC = 1.2;
const LAND_SEC = 0.35;
const PETTED_SEC = 1.6;
const CELEBRATE_SEC = 2.4;

export function isLate(hour: number, bedtimeHour: number): boolean {
  return hour >= bedtimeHour || hour < 5;
}

export class Behavior {
  state: PetState = 'idle';
  /** Seconds spent in the current state. */
  stateTime = 0;
  x: number;
  lift = 0;
  dir: 1 | -1 = 1;
  targetX: number | null = null;
  /** Smoothed horizontal drag velocity (px/s), for wobble. */
  dragVelocity = 0;
  sleepy = false;

  private duration = 0;
  private vy = 0;
  private lastDragX: number | null = null;
  private effects: Effect[] = [];
  private cfg: BehaviorConfig;
  private readonly rng: () => number;

  constructor(cfg: BehaviorConfig, x: number, rng: () => number = Math.random) {
    this.cfg = cfg;
    this.x = x;
    this.rng = rng;
    this.enter('idle');
  }

  setConfig(cfg: BehaviorConfig) {
    this.cfg = cfg;
  }

  drainEffects(): Effect[] {
    const out = this.effects;
    this.effects = [];
    return out;
  }

  tick(dt: number, world: World) {
    this.stateTime += dt;
    const late = isLate(world.hour, this.cfg.bedtimeHour);
    if (late && !this.sleepy && this.state !== 'sleep') this.effects.push('bedtimeNudge');
    this.sleepy = late;
    const userAway = world.userIdleSec >= this.cfg.sleepAfterSec;

    switch (this.state) {
      case 'idle':
      case 'sit':
        if (userAway) this.enter('sleep');
        else if (this.stateTime >= this.duration) this.chooseNext(world);
        break;
      case 'walk':
        if (userAway) this.enter('sleep');
        else this.walk(dt, world);
        break;
      case 'sleep':
        if (world.userIdleSec < 2) this.enter('wake');
        break;
      case 'wake':
        if (this.stateTime >= WAKE_SEC) this.enter('idle');
        break;
      case 'drag':
        if (this.lastDragX !== null && dt > 0) {
          const v = (this.x - this.lastDragX) / dt;
          this.dragVelocity += (v - this.dragVelocity) * Math.min(1, dt * 12);
        }
        this.lastDragX = this.x;
        break;
      case 'fall':
        this.vy += GRAVITY * dt;
        this.lift -= this.vy * dt;
        if (this.lift <= 0) {
          this.lift = 0;
          this.effects.push('land');
          this.enter('land');
        }
        break;
      case 'land':
      case 'petted':
      case 'celebrate':
        if (this.stateTime >= this.duration) this.enter('idle');
        break;
    }

    if (this.state !== 'drag') this.x = clamp(this.x, world.minX, Math.max(world.minX, world.maxX));
  }

  dispatch(ev: BehaviorEvent) {
    switch (ev.type) {
      case 'dragStart':
        this.lastDragX = null;
        this.dragVelocity = 0;
        this.enter('drag');
        break;
      case 'dragMove':
        if (this.state === 'drag') {
          this.x = ev.x;
          this.lift = Math.max(0, ev.lift);
        }
        break;
      case 'dragEnd':
        if (this.state !== 'drag') break;
        this.vy = 0;
        this.enter(this.lift > 1 ? 'fall' : 'land');
        break;
      case 'pet':
        if (this.state === 'sleep') this.enter('wake');
        else if (!this.isBusy()) {
          this.effects.push('hearts');
          this.enter('petted');
        }
        break;
      case 'celebrate':
        if (!this.isBusy()) this.enter('celebrate');
        break;
    }
  }

  /** Being held or falling can't be interrupted. */
  private isBusy() {
    return this.state === 'drag' || this.state === 'fall';
  }

  private enter(state: PetState) {
    this.state = state;
    this.stateTime = 0;
    this.targetX = null;
    this.duration = this.durationFor(state);
  }

  private durationFor(state: PetState): number {
    switch (state) {
      case 'idle':
        return 5 + this.rng() * 10;
      case 'sit':
        return 10 + this.rng() * 20;
      case 'land':
        return LAND_SEC;
      case 'petted':
        return PETTED_SEC;
      case 'celebrate':
        return CELEBRATE_SEC;
      case 'wake':
        return WAKE_SEC;
      default:
        return Infinity;
    }
  }

  private chooseNext(world: World) {
    if (this.cfg.stayPut) {
      this.enter('sit');
      return;
    }
    const r = this.rng();
    const walkChance = this.cfg.reducedMotion ? 0 : this.sleepy ? 0.1 : 0.35;
    const sitChance = this.sleepy ? 0.5 : 0.3;
    if (r < walkChance && this.pickTarget(world)) return;
    if (r < walkChance + sitChance) this.enter(this.state === 'sit' ? 'idle' : 'sit');
    else this.enter('idle');
  }

  private pickTarget(world: World): boolean {
    const span = world.maxX - world.minX;
    if (span < 80) return false;
    for (let i = 0; i < 5; i++) {
      const t = world.minX + this.rng() * span;
      if (Math.abs(t - this.x) >= 60) {
        this.enter('walk');
        this.targetX = t;
        this.dir = t > this.x ? 1 : -1;
        return true;
      }
    }
    return false;
  }

  private walk(dt: number, world: World) {
    const target = clamp(this.targetX ?? this.x, world.minX, world.maxX);
    // Ease in over the first 0.4s and ease out over the last ~40px, so walks don't glide.
    const remaining = Math.abs(target - this.x);
    const ease = Math.min(1, 0.15 + this.stateTime / 0.4) * Math.min(1, 0.3 + remaining / 40);
    const speed = this.cfg.walkSpeed * (this.sleepy ? 0.6 : 1) * ease;
    const step = Math.max(speed * dt, Math.min(remaining, 0.5));
    if (Math.abs(target - this.x) <= step) {
      this.x = target;
      this.enter('idle');
    } else {
      this.dir = target > this.x ? 1 : -1;
      this.x += this.dir * step;
    }
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
