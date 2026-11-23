/**
 * Pure image operations for the cutout style. Operate on plain RGBA buffers so they are
 * unit-testable in Node; the creator wraps them with canvases.
 */
export interface RawImage {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray;
}

const INF = 1e20;

/**
 * Euclidean distance transform (Felzenszwalb & Huttenlocher): for every pixel, the distance to
 * the nearest pixel where `feature` is true. O(w·h).
 */
export function distanceTransform(feature: Uint8Array, w: number, h: number): Float32Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = feature[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (len: number, get: (i: number) => number, set: (i: number, x: number) => void) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s: number;
      for (;;) {
        const p = v[k] ?? 0;
        s = ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
        if (s <= (z[k] ?? 0) && k > 0) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while ((z[k + 1] ?? INF) < q) k++;
      const p = v[k] ?? 0;
      d[q] = (q - p) * (q - p) + (f[p] ?? 0);
    }
    for (let i = 0; i < len; i++) set(i, d[i] ?? 0);
  };
  for (let x = 0; x < w; x++) {
    pass(
      h,
      (y) => grid[y * w + x] ?? 0,
      (y, val) => (grid[y * w + x] = val),
    );
  }
  for (let y = 0; y < h; y++) {
    pass(
      w,
      (x) => grid[y * w + x] ?? 0,
      (x, val) => (grid[y * w + x] = val),
    );
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i] ?? 0);
  return out;
}

function solid(img: RawImage, threshold = 128): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = (img.data[i * 4 + 3] ?? 0) >= threshold ? 1 : 0;
  return out;
}

/**
 * Grows (px > 0) or shrinks (px < 0) the alpha edge, keeping colours. Soft model edges
 * (hair, fur) are preserved where they aren't overridden.
 */
export function adjustEdge(img: RawImage, px: number): RawImage {
  if (px === 0) return img;
  const { width: w, height: h } = img;
  const data = new Uint8ClampedArray(img.data);
  const inside = solid(img);
  if (px > 0) {
    const dist = distanceTransform(inside, w, h);
    for (let i = 0; i < w * h; i++) {
      const grown = Math.max(0, Math.min(1, px - (dist[i] ?? 0) + 1)) * 255;
      data[i * 4 + 3] = Math.max(data[i * 4 + 3] ?? 0, grown);
    }
  } else {
    const outside = inside.map((v) => 1 - v);
    const dist = distanceTransform(outside, w, h);
    for (let i = 0; i < w * h; i++) {
      const kept = Math.max(0, Math.min(1, (dist[i] ?? 0) + px)) * 255;
      data[i * 4 + 3] = Math.min(data[i * 4 + 3] ?? 0, kept);
    }
  }
  return { width: w, height: h, data };
}

/** Adds a transparent border so outlines and shadows have room. */
export function pad(img: RawImage, p: number): RawImage {
  const w = img.width + 2 * p;
  const h = img.height + 2 * p;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < img.height; y++) {
    data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + p) * w + p) * 4);
  }
  return { width: w, height: h, data };
}

/** Sticker-style soft white outline behind the subject. */
export function outline(img: RawImage, thickness: number, color = [255, 255, 255]): RawImage {
  const { width: w, height: h } = img;
  const dist = distanceTransform(solid(img, 96), w, h);
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < w * h; i++) {
    const oa = Math.max(0, Math.min(1, thickness - (dist[i] ?? 0) + 0.5));
    const sa = (img.data[i * 4 + 3] ?? 0) / 255;
    // source-over: subject on top of the outline colour
    const a = sa + oa * (1 - sa);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const src = img.data[i * 4 + c] ?? 0;
      data[i * 4 + c] = (src * sa + (color[c] ?? 255) * oa * (1 - sa)) / a;
    }
    data[i * 4 + 3] = a * 255;
  }
  return { width: w, height: h, data };
}

/** Crops to the bounding box of pixels with alpha above `threshold`. */
export function trim(img: RawImage, threshold = 8): RawImage | null {
  const { width: w, height: h } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((img.data[(y * w + x) * 4 + 3] ?? 0) > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    data.set(img.data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1 + 1) * 4), y * cw * 4);
  }
  return { width: cw, height: ch, data };
}

/** Fraction of pixels that are mostly opaque (used to warn about empty/failed cutouts). */
export function coverage(img: RawImage): number {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if ((img.data[i] ?? 0) > 127) n++;
  return n / (img.width * img.height);
}

/**
 * Removes a solid "green screen" background: estimates the backdrop colour from the image border,
 * flood-fills everything similar that touches the border, softens the edge by one pixel and
 * removes green spill. Interior regions are kept even if similar, since they don't touch the border.
 */
export function removeKeyedBackground(img: RawImage, tolerance = 90): RawImage {
  const { width: w, height: h, data: src } = img;
  const n = w * h;
  // Backdrop colour = per-channel median of border pixels.
  const border: number[][] = [[], [], []];
  const sample = (i: number) => {
    for (let c = 0; c < 3; c++) border[c]?.push(src[i * 4 + c] ?? 0);
  };
  for (let x = 0; x < w; x++) {
    sample(x);
    sample((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    sample(y * w);
    sample(y * w + w - 1);
  }
  const key = border.map((ch) => {
    ch.sort((a, b) => a - b);
    return ch[ch.length >> 1] ?? 0;
  });
  const dist = (i: number) =>
    Math.hypot(
      (src[i * 4] ?? 0) - (key[0] ?? 0),
      (src[i * 4 + 1] ?? 0) - (key[1] ?? 0),
      (src[i * 4 + 2] ?? 0) - (key[2] ?? 0),
    );

  const bg = new Uint8Array(n);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!bg[i] && dist(i) < tolerance) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop() ?? 0;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }

  const data = new Uint8ClampedArray(src);
  const greenKey = (key[1] ?? 0) > (key[0] ?? 0) && (key[1] ?? 0) > (key[2] ?? 0);
  for (let i = 0; i < n; i++) {
    if (bg[i]) {
      data[i * 4 + 3] = 0;
      continue;
    }
    const x = i % w;
    const nearBg =
      (x > 0 && bg[i - 1]) ||
      (x < w - 1 && bg[i + 1]) ||
      (i >= w && bg[i - w]) ||
      (i < n - w && bg[i + w]);
    if (!nearBg) continue;
    // Edge pixel: partially transparent if it is still close to the backdrop colour.
    const a = Math.max(0, Math.min(1, (dist(i) - tolerance) / tolerance));
    data[i * 4 + 3] = Math.round((0.35 + 0.65 * a) * 255);
    if (greenKey) {
      const r = data[i * 4] ?? 0;
      const b = data[i * 4 + 2] ?? 0;
      data[i * 4 + 1] = Math.min(data[i * 4 + 1] ?? 0, Math.max(r, b));
    }
  }
  return { width: w, height: h, data };
}
