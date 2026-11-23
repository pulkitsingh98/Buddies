/**
 * Pure pre/post-processing for the ISNet background-removal model.
 * No DOM or onnxruntime imports here so it can be unit-tested in Node.
 *
 * Matches rembg's ISNet session: RGB scaled by the image max, minus 0.5 mean, std 1.0,
 * NCHW float32 at 1024×1024; output is a single-channel saliency map that we min-max normalise.
 */
export const MODEL_INPUT_SIZE = 1024;

/** RGBA pixels (size×size) → NCHW float32 tensor data. */
export function toModelInput(rgba: ArrayLike<number>, size = MODEL_INPUT_SIZE): Float32Array {
  const plane = size * size;
  let max = 1;
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    max = Math.max(max, rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0);
  }
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    out[i] = (rgba[o] ?? 0) / max - 0.5;
    out[plane + i] = (rgba[o + 1] ?? 0) / max - 0.5;
    out[2 * plane + i] = (rgba[o + 2] ?? 0) / max - 0.5;
  }
  return out;
}

/** Model output (first size×size values) → 8-bit alpha mask. */
export function toAlphaMask(output: ArrayLike<number>, size = MODEL_INPUT_SIZE): Uint8ClampedArray {
  const n = size * size;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = output[i] ?? 0;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  const mask = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) mask[i] = (((output[i] ?? 0) - lo) / range) * 255;
  return mask;
}
