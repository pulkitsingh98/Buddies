import { listen } from '@tauri-apps/api/event';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { ipc, type Settings } from '../lib/ipc';
import { forwardErrors } from '../lib/log';
import { Behavior, type BehaviorConfig, type PetState } from './behavior';
import { Expressions } from './expressions';
import { tickHz } from './pose';
import { MASK_COLS, MASK_ROWS, PetView } from './view';

const win = getCurrentWindow();
const petId = win.label.slice('pet-'.length);

const BEDTIME_LINES = [
  "It's getting late… bed soon? 🌙",
  'Yawn… sleep is a superpower 😴',
  'Tomorrow-you will thank you for sleeping 💤',
];

interface Geometry {
  minX: number;
  maxX: number;
  /** Window top (logical px) when the pet stands on the floor. */
  floorTop: number;
}

function behaviorConfig(s: Settings): BehaviorConfig {
  return {
    sleepAfterSec: s.sleepAfterMin * 60,
    bedtimeHour: s.bedtimeHour,
    reducedMotion: s.reducedMotion,
    walkSpeed: Math.max(30, s.petSize * 0.35),
  };
}

async function geometry(): Promise<Geometry> {
  const m = (await currentMonitor()) ?? (await primaryMonitor());
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!m) return { minX: 0, maxX: 800, floorTop: 600 };
  const sf = m.scaleFactor;
  const left = m.workArea.position.x / sf;
  const top = m.workArea.position.y / sf;
  const width = m.workArea.size.width / sf;
  const height = m.workArea.size.height / sf;
  // The window has transparent margins, so let it overhang the edges a little.
  return { minX: left - w * 0.2, maxX: left + width - w * 0.8, floorTop: top + height - h };
}

async function main() {
  const [manifest, spriteBlob, initialSettings] = await Promise.all([
    ipc.getPet(petId),
    ipc.getPetSprite(petId),
    ipc.getSettings(),
  ]);
  let settings = initialSettings;
  const sprite = await createImageBitmap(spriteBlob);
  const view = new PetView(sprite, URL.createObjectURL(spriteBlob), manifest);
  view.layout(settings.petSize);

  let geom = await geometry();
  const behavior = new Behavior(
    behaviorConfig(settings),
    geom.minX + Math.random() * (geom.maxX - geom.minX),
  );

  // Cartoon pets have many drawn expressions; cutout pets have one frame.
  const expr =
    view.frameIds.size > 1
      ? new Expressions(view.frameIds, Math.random, performance.now() / 1000)
      : null;
  let lastInteraction = performance.now();
  const interacted = () => (lastInteraction = performance.now());
  // Shake detection while dragging: several quick direction reversals.
  let lastVelSign = 0;
  let reversals: number[] = [];

  // --- click-through mask: sent whenever the clickable shape changes ---
  let lastMaskKey = '';
  const sendMask = () => {
    const bits = view.hitMask();
    const key = bits.join(',');
    if (key === lastMaskKey) return;
    lastMaskKey = key;
    ipc.setHitMask(MASK_COLS, MASK_ROWS, bits).catch(() => {});
  };
  view.onMaskChange = sendMask;

  // --- view state follows the behaviour state ---
  let shownState: PetState | null = null;
  let shownSleepy = false;
  const syncView = () => {
    const lean = behavior.state === 'drag' ? -behavior.dragVelocity * 0.0012 : 0;
    if (
      behavior.state !== shownState ||
      behavior.sleepy !== shownSleepy ||
      behavior.state === 'drag'
    ) {
      const changed = behavior.state !== shownState;
      shownState = behavior.state;
      shownSleepy = behavior.sleepy;
      view.setState(behavior.state, behavior.sleepy, settings.reducedMotion, lean);
      if (changed) {
        sendMask();
        // Pose transitions take ~0.6s; refresh the mask once they settle.
        window.setTimeout(sendMask, 700);
      }
    }
    // Cartoon frames are drawn facing right when walking and facing the viewer otherwise.
    view.setFlip(behavior.dir < 0 && (!expr || behavior.state === 'walk'));
    view.setLift(behavior.lift);

    if (expr) {
      const now = performance.now();
      if (behavior.state === 'drag') {
        const v = behavior.dragVelocity;
        const sign = Math.abs(v) > 600 ? Math.sign(v) : 0;
        if (sign && lastVelSign && sign !== lastVelSign) {
          reversals = [...reversals.filter((t) => now - t < 1200), now];
          if (reversals.length >= 3) {
            expr.react('shake', now / 1000);
            reversals = [];
          }
        }
        if (sign) lastVelSign = sign;
      }
      const frame = expr.frame(
        {
          state: behavior.state,
          sleepy: behavior.sleepy,
          sinceInteraction: (now - lastInteraction) / 1000,
          userIdle: idleBase + (now - idleAt) / 1000,
        },
        now / 1000,
      );
      if (view.setFrame(frame)) sendMask();
    }
  };

  // --- window position sync (coalesced: at most one setPosition in flight) ---
  let applied = { x: NaN, y: NaN };
  let moving = false;
  const syncPosition = () => {
    const x = Math.round(behavior.x);
    const y = Math.round(geom.floorTop - behavior.lift);
    if (moving || (x === applied.x && y === applied.y)) return;
    moving = true;
    applied = { x, y };
    win
      .setPosition(new LogicalPosition(x, y))
      .catch(() => {})
      .finally(() => {
        moving = false;
        syncPosition(); // apply anything that changed while this move was in flight
      });
  };

  // --- user idle time: polled rarely, extrapolated in between ---
  let idleBase = 0;
  let idleAt = performance.now();
  let nextIdlePoll = 0;
  const markActive = () => {
    idleBase = 0;
    idleAt = performance.now();
  };
  const pollIdle = (now: number) => {
    if (now < nextIdlePoll) return;
    nextIdlePoll = now + (behavior.state === 'sleep' ? 1000 : 10000);
    ipc
      .userIdleSeconds()
      .then((s) => {
        idleBase = s;
        idleAt = performance.now();
      })
      .catch(() => {});
  };

  // --- pointer: drag, click to pet, double-click to celebrate, hover to pet ---
  const target = view.target;
  let press: { sx: number; sy: number; x: number; lift: number; dragging: boolean } | null = null;
  let hoverTimer: number | undefined;
  let lastHoverPet = 0;
  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    clearTimeout(hoverTimer);
    markActive();
    interacted();
    target.setPointerCapture(e.pointerId);
    press = { sx: e.screenX, sy: e.screenY, x: behavior.x, lift: behavior.lift, dragging: false };
  });
  target.addEventListener('pointermove', (e) => {
    if (!press) return;
    const dx = e.screenX - press.sx;
    const dy = e.screenY - press.sy;
    if (!press.dragging && Math.hypot(dx, dy) > 4) {
      press.dragging = true;
      behavior.dispatch({ type: 'dragStart' });
      wake();
    }
    if (press.dragging) {
      behavior.dispatch({ type: 'dragMove', x: press.x + dx, lift: press.lift - dy });
      syncPosition();
    }
  });
  target.addEventListener('pointerup', () => {
    if (!press) return;
    const wasDragging = press.dragging;
    press = null;
    if (wasDragging) {
      behavior.dispatch({ type: 'dragEnd' });
      // The pet may have been dropped on another monitor.
      void geometry().then((g) => {
        const top = geom.floorTop - behavior.lift;
        geom = g;
        behavior.lift = Math.max(0, g.floorTop - top);
      });
    } else {
      const wasAsleep = behavior.state === 'sleep';
      behavior.dispatch({ type: 'pet' });
      if (!wasAsleep) expr?.react('click', performance.now() / 1000);
    }
    wake();
  });
  target.addEventListener('dblclick', () => {
    behavior.dispatch({ type: 'celebrate' });
    wake();
  });
  target.addEventListener('pointerenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (press || performance.now() - lastHoverPet < 6000) return;
      lastHoverPet = performance.now();
      interacted();
      behavior.dispatch({ type: 'pet' });
      expr?.react('hover', performance.now() / 1000);
      wake();
    }, 900);
  });
  target.addEventListener('pointerleave', () => clearTimeout(hoverTimer));

  // --- settings, resize, suspension ---
  void listen<Settings>('settings://changed', (e) => {
    settings = e.payload;
    behavior.setConfig(behaviorConfig(settings));
    shownState = null; // re-apply reduced-motion class
    wake();
  });
  window.addEventListener('resize', () => {
    view.layout(settings.petSize);
    sendMask();
    void geometry().then((g) => (geom = g));
  });
  let suspended = false;
  void listen<boolean>('pets://suspend', (e) => {
    suspended = e.payload;
    wake();
  });
  document.addEventListener('visibilitychange', wake);

  // --- behaviour loop: fast only while the window moves; ~1 Hz at rest ---
  let timer: number | undefined;
  let last = performance.now();
  let shown = false;
  let prevState: PetState = behavior.state;
  function wake() {
    clearTimeout(timer);
    timer = window.setTimeout(frame, 0);
  }
  function frame() {
    timer = undefined;
    // Resumed by wake(). (The window starts hidden, so don't gate the very first frame.)
    if (shown && (suspended || document.hidden)) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    pollIdle(now);
    behavior.tick(dt, {
      minX: geom.minX,
      maxX: geom.maxX,
      userIdleSec: idleBase + (now - idleAt) / 1000,
      hour: new Date().getHours(),
    });
    for (const fx of behavior.drainEffects()) {
      if (fx === 'hearts') view.addHearts();
      if (fx === 'bedtimeNudge')
        view.showBubble(
          BEDTIME_LINES[Math.floor(Math.random() * BEDTIME_LINES.length)] ?? '',
          10000,
        );
    }
    if (prevState === 'wake' && behavior.state === 'idle') expr?.react('greet', now / 1000);
    prevState = behavior.state;
    syncView();
    if (!press?.dragging) syncPosition();

    if (!shown) {
      shown = true;
      void win.show();
    }
    // Cartoon pets tick a little faster at rest so blinks and quirks land on time.
    const hz = Math.max(tickHz(behavior.state), expr ? 8 : 0);
    timer = window.setTimeout(frame, 1000 / hz);
  }
  wake();
}

forwardErrors(win.label);
main().catch((e: unknown) => {
  throw e;
});
