/**
 * Where a frame's character "stands": the lowest opaque row, and the alpha-weighted horizontal
 * centre of the lower 30% of the figure (feet/legs — ignores hearts, confetti or raised arms).
 * Used to line every frame up with the neutral pose so switching faces doesn't make it jump.
 */
export interface Anchor {
  x: number;
  bottom: number;
}

export function frameAnchor(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  threshold = 40,
): Anchor | null {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if ((alpha[y * w + x] ?? 0) > threshold) n++;
    if (n > 2) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  if (bottom < 0) return null;
  const from = Math.round(bottom - (bottom - top) * 0.3);
  let sum = 0;
  let weight = 0;
  for (let y = from; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x] ?? 0;
      if (a > threshold) {
        sum += x * a;
        weight += a;
      }
    }
  }
  return { x: weight ? sum / weight : w / 2, bottom };
}

/** Offset (px) that moves `frame`'s anchor onto `reference`'s, capped to ±`maxFrac` of the cell. */
export function alignOffset(
  reference: Anchor,
  frame: Anchor,
  w: number,
  h: number,
  maxFrac = 0.15,
) {
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return {
    dx: clamp(reference.x - frame.x, w * maxFrac),
    dy: clamp(reference.bottom - frame.bottom, h * maxFrac),
  };
}
