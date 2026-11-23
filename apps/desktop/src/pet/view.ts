import type { PetManifest } from '@deskpals/shared';
import type { PetState } from './behavior';
import { alignOffset, frameAnchor, type Anchor } from './anchor';
import { bubblePalette, dominantHue } from './palette';
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
  private readonly badge = byId('badge');
  private readonly motionPop = byId('pop');
  private readonly alphaGrids = new Map<string, Uint8Array>();
  /** Per-frame shift (sprite px) that lines the frame's feet up with the neutral pose. */
  private readonly offsets = new Map<string, { dx: number; dy: number }>();
  private readonly frames: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Cutout pets are posed procedurally; cartoon pets have drawn poses instead. */
  private readonly procedural: boolean;
  private frame = '';
  private box = { left: 0, top: 0, w: 0, h: 0 };
  private current: RestPose = restPose('idle', false);
  private flipped = false;
  private bubbleTimer: number | undefined;
  private leaveTimer: number | undefined;
  private typeTimer: number | undefined;

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
    this.analyseFrames();
    this.setFrame('neutral');
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
    const o = this.offsets.get(this.frame) ?? { dx: 0, dy: 0 };
    this.spriteEl.style.transform = `translate(${(o.dx / r.w) * 100}%, ${(o.dy / r.h) * 100}%)`;
    return true;
  }

  /** One pass over the sprite sheet: hit grids and alignment offsets for every frame. */
  private analyseFrames() {
    const { width: W, height: H } = this.sprite;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.sprite, 0, 0);
    const sheet = ctx.getImageData(0, 0, W, H).data;
    const anchors = new Map<string, Anchor>();
    // Bubble colours follow the pet's signature colour.
    const neutral = this.frames.neutral;
    if (neutral) {
      const px = ctx.getImageData(neutral.x, neutral.y, neutral.w, neutral.h).data;
      const pal = bubblePalette(dominantHue(px));
      const root = document.documentElement.style;
      root.setProperty('--bubble-bg', pal.bg);
      root.setProperty('--bubble-bg2', pal.bg2);
      root.setProperty('--bubble-border', pal.border);
      root.setProperty('--bubble-text', pal.text);
      root.setProperty('--bubble-button', pal.button);
      root.setProperty('--bubble-button-hover', pal.buttonHover);
      root.setProperty('--bubble-accent', pal.accent);
    }
    for (const [id, r] of Object.entries(this.frames)) {
      const alpha = new Uint8Array(r.w * r.h);
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++)
          alpha[y * r.w + x] = sheet[((r.y + y) * W + r.x + x) * 4 + 3] ?? 0;
      }
      this.alphaGrids.set(id, poolAlpha(alpha, r.w, r.h));
      const a = frameAnchor(alpha, r.w, r.h);
      if (a) anchors.set(id, a);
    }
    const ref = anchors.get('neutral');
    if (!ref) return;
    for (const [id, a] of anchors) {
      const r = this.frames[id];
      if (r && id !== 'neutral') this.offsets.set(id, alignOffset(ref, a, r.w, r.h));
    }
  }

  private alphaGrid(): Uint8Array {
    return this.alphaGrids.get(this.frame) ?? new Uint8Array(ALPHA_GRID * ALPHA_GRID).fill(255);
  }

  /** Short squash-and-pop on the sprite (used when the pet reacts). */
  pop() {
    this.motionPop.classList.remove('pop');
    void this.motionPop.offsetWidth; // restart the animation
    this.motionPop.classList.add('pop');
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

  /**
   * Speech bubble above the pet. Pops in from its tail, types the text, then shows any action
   * buttons; clicking the bubble dismisses it ("poof"). Returns a function that closes it.
   */
  showBubble(
    text: string,
    opts: { ms?: number; actions?: BubbleAction[]; onTimeout?: () => void } = {},
  ) {
    this.openBubble();
    const p = document.createElement('div');
    p.className = 'text';
    this.bubble.appendChild(p);
    let row: HTMLDivElement | null = null;
    if (opts.actions?.length) {
      row = document.createElement('div');
      row.className = 'actions';
      for (const a of opts.actions) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hideBubble();
          a.onClick();
        });
        row.appendChild(b);
      }
      this.bubble.appendChild(row);
    }
    this.typeText(p, text, () => row?.classList.add('shown'));
    this.bubble.onclick = () => this.hideBubble();
    this.bubbleTimer = window.setTimeout(() => {
      this.hideBubble();
      opts.onTimeout?.();
    }, opts.ms ?? 8000);
    this.onMaskChange?.();
    return () => this.hideBubble();
  }

  /**
   * Bubble with a text box (replying to a friend). The window must be made focusable by the
   * caller first — pet windows normally never take keyboard focus.
   */
  showInput(
    prompt: string,
    maxLength: number,
    onSend: (text: string) => void,
    onClose: () => void,
  ) {
    this.openBubble();
    const label = document.createElement('div');
    label.className = 'text';
    label.textContent = prompt;
    const form = document.createElement('form');
    form.className = 'reply';
    const input = document.createElement('input');
    input.maxLength = maxLength;
    input.placeholder = 'Type a reply…';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.textContent = 'Send';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '✕';
    form.append(input, sendBtn, cancel);
    this.bubble.append(label, form);
    const close = () => {
      this.hideBubble();
      onClose();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      close();
      onSend(text);
    };
    cancel.onclick = close;
    input.onkeydown = (e) => e.key === 'Escape' && close();
    this.bubble.onclick = null;
    this.bubbleTimer = window.setTimeout(close, 90_000);
    this.onMaskChange?.();
    setTimeout(() => input.focus(), 50);
  }

  /** Guided breathing: the pet slowly grows on the in-breath and settles on the out-breath. */
  setBreath(phase: 'in' | 'hold' | 'out' | null) {
    this.stage.classList.toggle('breath-in', phase === 'in' || phase === 'hold');
    this.stage.classList.toggle('breath-out', phase === 'out');
  }

  /** Small pill above the pet (focus countdown). `null` hides it. */
  setBadge(text: string | null, onClick?: () => void) {
    const visible = text !== null;
    if (visible) {
      this.badge.textContent = text;
      this.badge.style.bottom = `${window.innerHeight - this.box.top + 4}px`;
      this.badge.onclick = onClick ?? null;
    }
    if (this.badge.hidden === visible) {
      this.badge.hidden = !visible;
      this.onMaskChange?.();
    }
  }

  get bubbleOpen() {
    return !this.bubble.hidden && !this.bubble.classList.contains('leaving');
  }

  /** Clears the bubble and restarts its pop-in animation. */
  private openBubble() {
    clearTimeout(this.bubbleTimer);
    clearTimeout(this.leaveTimer);
    clearInterval(this.typeTimer);
    this.bubble.replaceChildren();
    this.bubble.classList.remove('leaving', 'entering');
    void this.bubble.offsetWidth; // restart the CSS animation
    this.bubble.classList.add('entering');
    this.bubble.hidden = false;
    this.bubble.style.bottom = `${window.innerHeight - this.box.top + 8}px`;
  }

  /** Types the text in over about a second (instantly with reduced motion). */
  private typeText(el: HTMLElement, text: string, done: () => void) {
    const chars = Array.from(text);
    const reduced =
      document.documentElement.classList.contains('reduced') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.textContent = text;
    if (reduced || chars.length < 3) {
      done();
      return;
    }
    // Reserve the final size so the bubble doesn't grow while typing.
    el.style.minHeight = `${el.offsetHeight}px`;
    el.style.minWidth = `${el.offsetWidth}px`;
    el.textContent = '';
    let i = 0;
    const perTick = Math.max(1, Math.ceil(chars.length / 40));
    this.typeTimer = window.setInterval(() => {
      i = Math.min(chars.length, i + perTick);
      el.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) {
        clearInterval(this.typeTimer);
        done();
      }
    }, 28);
  }

  /** Floats the bubble up and fades it ("poof"), then hides it. */
  private hideBubble() {
    clearTimeout(this.bubbleTimer);
    clearInterval(this.typeTimer);
    if (this.bubble.hidden || this.bubble.classList.contains('leaving')) return;
    this.bubble.classList.remove('entering');
    this.bubble.classList.add('leaving');
    this.leaveTimer = window.setTimeout(() => {
      this.bubble.hidden = true;
      this.bubble.classList.remove('leaving');
      this.onMaskChange?.();
    }, 260);
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
      .translateSelf(this.offsets.get(this.frame)?.dx ?? 0, this.offsets.get(this.frame)?.dy ?? 0)
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
    const overlays = [this.bubble, this.badge]
      .filter((el) => !el.hidden)
      .map((el) => el.getBoundingClientRect());
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
        if (!on && overlays.length) {
          const x = ((c + 0.5) * W) / cols;
          const y = ((r + 0.5) * H) / rows;
          on = overlays.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
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

export interface BubbleAction {
  label: string;
  onClick: () => void;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** Downsampled alpha of one frame, max-pooled so thin parts (tails, ears) stay grabbable. */
function poolAlpha(alpha: Uint8Array, w: number, h: number): Uint8Array {
  const grid = new Uint8Array(ALPHA_GRID * ALPHA_GRID);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor((y / h) * ALPHA_GRID);
    for (let x = 0; x < w; x++) {
      const gi = gy * ALPHA_GRID + Math.floor((x / w) * ALPHA_GRID);
      const a = alpha[y * w + x] ?? 0;
      if (a > (grid[gi] ?? 0)) grid[gi] = a;
    }
  }
  return grid;
}
