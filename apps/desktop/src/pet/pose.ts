import type { PetState } from './behavior';

/**
 * Static ("rest") pose per state. Continuous motion — breathing, hops, bounces, wobble — is done
 * by CSS animations on the compositor so the CPU sleeps; this is the transform they play on top of,
 * and what the click-through hit mask is computed from.
 */
export interface RestPose {
  scaleX: number;
  scaleY: number;
  /** Radians, clockwise. */
  rotation: number;
  opacity: number;
}

/** Lying down: rotate ~80° onto the side. */
export const LIE_ANGLE = -1.4;

export function restPose(state: PetState, sleepy: boolean, lean = 0): RestPose {
  const p: RestPose = { scaleX: 1, scaleY: 1, rotation: sleepy ? 0.05 : 0, opacity: 1 };
  switch (state) {
    case 'sit':
      return { ...p, scaleX: 1.06, scaleY: 0.9 };
    case 'sleep':
      return { ...p, rotation: LIE_ANGLE, opacity: 0.8 };
    case 'drag':
      return { ...p, scaleX: 0.97, scaleY: 1.05, rotation: Math.max(-0.5, Math.min(0.5, lean)) };
    case 'fall':
      return { ...p, scaleX: 0.94, scaleY: 1.08, rotation: 0 };
    default:
      return p;
  }
}

/**
 * Vertical offset (px, + = down) that keeps the lowest point of the posed box on the floor when
 * the pose transform is applied about the box centre.
 */
export function floorOffset(pose: RestPose, w: number, h: number): number {
  const c = Math.abs(Math.cos(pose.rotation));
  const s = Math.abs(Math.sin(pose.rotation));
  const halfV = (c * h * pose.scaleY + s * w * pose.scaleX) / 2;
  return h / 2 - halfV;
}

/** CSS transform for a rest pose (applied with `transform-origin: center`). */
export function poseTransform(pose: RestPose, w: number, h: number): string {
  return `translateY(${floorOffset(pose, w, h).toFixed(2)}px) rotate(${pose.rotation}rad) scale(${pose.scaleX}, ${pose.scaleY})`;
}

/**
 * How often the behaviour loop needs to run (Hz). Only states that move the window need frames;
 * the rest just need to notice timed transitions.
 */
export function tickHz(state: PetState): number {
  switch (state) {
    case 'walk':
      return 24;
    case 'drag':
    case 'fall':
      return 30;
    case 'land':
    case 'petted':
    case 'celebrate':
    case 'wake':
      return 5;
    default:
      return 1;
  }
}
