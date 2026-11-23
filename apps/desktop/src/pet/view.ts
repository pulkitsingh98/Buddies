import type { PetManifest } from '@deskpals/shared';
import type { PetState } from './behavior';
import { poseTransform, restPose, type RestPose } from './pose';

/** Hit grid resolution reported to Rust for click-through. */
export const MASK_COLS = 24;
export const MASK_ROWS = 28;
const ALPHA_GRID = 64;
const FLOOR_MARGIN = 10;

/**
 * DOM/CSS view of a single-cutout pet. JS only sets the state (a data attribute + a static pose
 * transform); all continuous motion is CSS animation, run by the compositor without waking JS.
 */
export class PetView {
  private readonly stage = byId('stage');
  private readonly pose = byId('pose');
  private readonly flip = byId('flip');
  private readonly spriteEl = byId('sprite');
  private readonly shadow = byId('shadow');
  private readonly bubble = byId('bubble');
  private readonly alphaGrids = new Map<string, Uint8Array>();
  private readonly frames: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Cutout pets are posed procedurally; cartoon pets have drawn poses instead. */
  private readonly procedural: boolean;
  private frame = '';
  private box = { left: 0, top: 0, w: 0, h: 0 };
  private current: RestPose = restPose('idle', false);
  private flipped = false;
  private bubbleTimer: number | undefined;

  constructor(
    private readonly sprite: ImageBitmap,
    spriteUrl: string,
    private readonly manifest: PetManifest,
  ) {
    const cellW = manifest.sprite.width;
    const cellH = manifest.sprite.height;
    this.frames = Object.fromEntries(
      Object.entries(manifest.sprite.frames ?? { neutral: [{ x: 0, y: 0, w: cellW, h: cellH }] })
        .map(([k, rects]) => [k, rects[0]])
        .filter((e): e is [string, { x: number; y: number; w: number; h: number }] => !!e[1]),
    );
    this.procedural = manifest.style === 'cutout';
    Object.assign(this.spriteEl.style, {
      backgroundImage: `url(${spriteUrl})`,
      backgroundSize: `${(sprite.width / cellW) * 100}% ${(sprite.height / cellH) * 100}%`,
    });
    this.setFrame('neutral');
    this.bubble.addEventListener('click', () => this.hideBubble());
  }

  /** The element pointer events should be attached to. */
  get target(): HTMLElement {
    return this.spriteEl;
  }

  /** Frame ids this pet has. */
  get frameIds(): Set<string> {
    return new Set(Object.keys(this.frames));
  }

  /** Shows a sprite-sheet frame; returns true if the clickable shape may have changed. */
  setFrame(id: string): boolean {
    const r = this.frames[id] ?? this.frames.neutral;
    if (!r || id === this.frame) return false;
    this.frame = this.frames[id] ? id : 'neutral';
    const { width: W, height: H } = this.sprite;
    const px = W === r.w ? 0 : (r.x / (W - r.w)) * 100;
    const py = H === r.h ? 0 : (r.y / (H - r.h)) * 100;
    this.spriteEl.style.backgroundPosition = `${px}% ${py}%`;
    return true;
  }

  private alphaGrid(): Uint8Array {
    let g = this.alphaGrids.get(this.frame);
    const r = this.frames[this.frame];
    if (!g && r) {
      g = buildAlphaGrid(this.sprite, r);
      this.alphaGrids.set(this.frame, g);
    }
    return g ?? new Uint8Array(ALPHA_GRID * ALPHA_GRID);
  }

  /** Lays out the sprite for the window size and pet height (CSS px). */
  layout(petSize: number) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sw = this.manifest.sprite.width;
    const sh = this.manifest.sprite.height;
    const squash = this.manifest.render.squash;
    const fit = Math.min(petSize / sh, (W * 0.9) / sw);
    const w = Math.round((sw * fit) / Math.sqrt(squash));
    const h = Math.round(sh * fit * squash);
    this.box = { left: (W - w) / 2, top: H - FLOOR_MARGIN - h, w, h };
    Object.assign(this.stage.style, {
      left: `${this.box.left}px`,
      top: `${this.box.top}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    Object.assign(this.shadow.style, {
      left: `${W / 2 - w * 0.38}px`,
      width: `${w * 0.76}px`,
      height: `${Math.max(4, w * 0.12)}px`,
      top: `${H - FLOOR_MARGIN - Math.max(2, w * 0.06)}px`,
    });
    this.applyPose();
  }

  setState(state: PetState, sleepy: boolean, reducedMotion: boolean, lean = 0) {
    this.stage.dataset.state = state;
    this.stage.classList.toggle('sleepy', sleepy);
    document.documentElement.classList.toggle('reduced', reducedMotion);
    this.current = this.procedural
      ? restPose(state, sleepy, lean)
      : restPose(state === 'drag' ? 'drag' : 'idle', false, lean);
    this.applyPose();
  }

  setFlip(flipped: boolean) {
    if (flipped === this.flipped) return;
    this.flipped = flipped;
    this.flip.style.transform = flipped ? 'scaleX(-1)' : '';
  }

  /** Fades the ground shadow as the pet is lifted off the floor. */
  setLift(lift: number) {
    this.shadow.style.opacity = String(Math.max(0, 1 - lift / 120));
  }

  private applyPose() {
    this.pose.style.transform = poseTransform(this.current, this.box.w, this.box.h);
    this.pose.style.opacity = String(this.current.opacity);
  }

  addHearts(count = 6) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'heart';
      el.textContent = '❤';
      el.style.left = `${this.box.left + this.box.w * (0.25 + Math.random() * 0.5)}px`;
      el.style.top = `${this.box.top + this.box.h * 0.15}px`;
      el.style.setProperty('--dx', `${(Math.random() - 0.5) * 50}px`);
      el.style.animationDelay = `${i * 0.08}s`;
      el.addEventListener('animationend', () => el.remove());
      document.body.appendChild(el);
    }
  }

  showBubble(text: string, ms = 8000) {
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    this.bubble.style.bottom = `${window.innerHeight - this.box.top + 8}px`;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hideBubble(), ms);
    this.onMaskChange?.();
  }

  private hideBubble() {
    this.bubble.hidden = true;
    this.onMaskChange?.();
  }

  /** Called when something other than the pose changes the clickable area. */
  onMaskChange?: () => void;

  /**
   * Coarse occupancy grid of the window from the rest pose: a cell is set if opaque sprite pixels
   * cover it (dilated one cell, which also absorbs the small CSS motions) or the bubble does.
   */
  hitMask(): number[] {
    const cols = MASK_COLS;
    const rows = MASK_ROWS;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const { left, top, w, h } = this.box;
    const sw = this.manifest.sprite.width;
    const sh = this.manifest.sprite.height;
    const alpha = this.alphaGrid();
    const cx = left + w / 2;
    const cy = top + h / 2;
    // window px → sprite px: inverse of (pose about centre) · (flip about centre) · (box placement)
    const m = new DOMMatrix()
      .translateSelf(cx, cy)
      .multiplySelf(new DOMMatrix(poseTransform(this.current, w, h)))
      .scaleSelf(this.flipped ? -1 : 1, 1)
      .translateSelf(-cx, -cy)
      .translateSelf(left, top)
      .scaleSelf(w / sw, h / sh)
      .inverse();

    const cells = new Uint8Array(cols * rows);
    if (this.current.opacity > 0.05) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = m.transformPoint(new DOMPoint(((c + 0.5) * W) / cols, ((r + 0.5) * H) / rows));
          if (p.x < 0 || p.y < 0 || p.x >= sw || p.y >= sh) continue;
          const gi =
            Math.floor((p.y / sh) * ALPHA_GRID) * ALPHA_GRID + Math.floor((p.x / sw) * ALPHA_GRID);
          if ((alpha[gi] ?? 0) > 40) cells[r * cols + c] = 1;
        }
      }
    }
    const bubble = this.bubble.hidden ? null : this.bubble.getBoundingClientRect();
    const bits = new Array<number>(Math.ceil((cols * rows) / 8)).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let on = false;
        for (let dr = -1; dr <= 1 && !on; dr++) {
          for (let dc = -1; dc <= 1 && !on; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            on = rr >= 0 && cc >= 0 && rr < rows && cc < cols && cells[rr * cols + cc] === 1;
          }
        }
        if (!on && bubble) {
          const x = ((c + 0.5) * W) / cols;
          const y = ((r + 0.5) * H) / rows;
          on = x >= bubble.left && x <= bubble.right && y >= bubble.top && y <= bubble.bottom;
        }
        if (on) {
          const i = r * cols + c;
          bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
        }
      }
    }
    return bits;
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** Downsampled alpha of one frame, max-pooled so thin parts (tails, ears) stay grabbable. */
function buildAlphaGrid(
  sprite: ImageBitmap,
  r: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const canvas = new OffscreenCanvas(r.w, r.h);
  const ctx = canvas.getContext('2d');
  const grid = new Uint8Array(ALPHA_GRID * ALPHA_GRID);
  if (!ctx) return grid.fill(255);
  ctx.drawImage(sprite, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  const { data } = ctx.getImageData(0, 0, r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const gy = Math.floor((y / r.h) * ALPHA_GRID);
    for (let x = 0; x < r.w; x++) {
      const gi = gy * ALPHA_GRID + Math.floor((x / r.w) * ALPHA_GRID);
      const a = data[(y * r.w + x) * 4 + 3] ?? 0;
      if (a > (grid[gi] ?? 0)) grid[gi] = a;
    }
  }
  return grid;
}
