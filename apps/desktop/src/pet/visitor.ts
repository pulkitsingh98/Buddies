/**
 * A friend's pet on this screen (window label `visit-<interaction id>`).
 *
 * - Visit: walks in from a screen edge, says the friend's message (Reply / wave back), then
 *   waves and walks off, and the window closes itself.
 * - Hang-out (an accepted `hangout_invite`): walks up next to your own pet and the two play
 *   together for ten minutes — jumping, swapping hearts, waving, laughing, a game of tag —
 *   coordinated with your pet over local `hangout://` events.
 */
import { emit, listen } from '@tauri-apps/api/event';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { MESSAGE_MAX_LEN } from '@deskpals/shared';
import { ipc } from '../lib/ipc';
import {
  friendPet,
  HANGOUT,
  listFriends,
  markDelivered,
  send,
  type HangoutMove,
  type PetSpot,
} from '../lib/social';
import { supabase } from '../lib/supabase';
import { Expressions, type Reaction } from './expressions';
import { MASK_COLS, MASK_ROWS, PetView } from './view';

const VISIT_MS = 30_000;
const HANGOUT_MS = 10 * 60_000;
const SPEED = 110; // px/s
const PLAY_LINES: Record<HangoutMove, string[]> = {
  jump: ['Wheee! 🎉', 'Jump with me!', 'Boing boing!'],
  hearts: ['Best friends 💕', 'Love you, buddy!'],
  wave: ['Hiii! 👋', 'Hello there!'],
  laugh: ['Hahaha 😆', 'You’re so funny!'],
  tag: ["Tag, you're it! 🏃", 'Catch me!'],
};

/** Asks your own pet where it is (for hang-outs). */
async function ownPetSpot(): Promise<PetSpot | null> {
  return new Promise((resolve) => {
    let done = false;
    void listen<PetSpot>(HANGOUT.here, (e) => {
      if (!done) {
        done = true;
        resolve(e.payload);
      }
    });
    void emit(HANGOUT.where);
    window.setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, 1200);
  });
}

export async function runVisitor() {
  const win = getCurrentWindow();
  const id = win.label.slice('visit-'.length);
  const close = () => void win.close();
  if (!supabase) return close();

  const { data: it } = await supabase.from('interactions').select('*').eq('id', id).maybeSingle();
  const pet = it?.pet_id ? await friendPet(it.pet_id).catch(() => null) : null;
  if (!it || !pet) {
    if (it) await markDelivered(id, true);
    return close();
  }
  const hangout = it.type === 'hangout_invite';
  const friends = await listFriends().catch(() => []);
  const name = friends.find((f) => f.user_id === it.sender_id)?.display_name ?? 'A friend';
  const settings = await ipc.getSettings();

  const sprite = await createImageBitmap(pet.sprite);
  const view = new PetView(sprite, URL.createObjectURL(pet.sprite), pet.manifest);
  view.layout(settings.petSize);
  const expr = view.frameIds.size > 1 ? new Expressions(view.frameIds) : null;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const react = (kind: Reaction) => {
    expr?.react(kind, now());
    view.pop();
  };

  let lastMask = '';
  const sendMask = () => {
    const bits = view.hitMask();
    const key = bits.join(',');
    if (key !== lastMask) {
      lastMask = key;
      void ipc.setHitMask(MASK_COLS, MASK_ROWS, bits).catch(() => {});
    }
  };
  view.onMaskChange = sendMask;

  // Geometry: walk in from a screen edge, to a spot (next to your pet when hanging out).
  const m = (await currentMonitor()) ?? (await primaryMonitor());
  const W = window.innerWidth;
  const H = window.innerHeight;
  const sf = m?.scaleFactor ?? 1;
  const left = (m?.workArea.position.x ?? 0) / sf;
  const width = (m?.workArea.size.width ?? 1200) / sf;
  let y = ((m?.workArea.position.y ?? 0) + (m?.workArea.size.height ?? 800)) / sf - H;
  let fromLeft = Math.random() < 0.5;
  let spot = fromLeft ? left + width * 0.2 : left + width * 0.8 - W;
  let host: PetSpot | null = null;
  if (hangout) {
    host = await ownPetSpot();
    if (host) {
      y = host.y;
      // Come in from the nearer side and stand right next to the host pet.
      fromLeft = host.x - left < width / 2;
      spot = fromLeft ? host.x - W * 0.55 : host.x + host.width * 0.55;
      void emit(HANGOUT.start);
    }
  }
  const outside = fromLeft ? left - W : left + width;

  let x = outside;
  let phase: 'enter' | 'stay' | 'leave' = 'enter';
  let target = spot;
  let leaveAt = 0;
  let nextPlay = 0;

  const setPos = () => void win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));

  const replyTo = async () => {
    await win.setFocusable(true).catch(() => {});
    await win.setFocus().catch(() => {});
    leaveAt = performance.now() + 90_000;
    view.showInput(
      `Reply to ${name}`,
      MESSAGE_MAX_LEN,
      (text) => {
        void send(it.sender_id, 'message', text)
          .then(() => view.showBubble('Sent! 💌', { ms: 2000 }))
          .catch((e: unknown) =>
            view.showBubble(String(e instanceof Error ? e.message : e), { ms: 4000 }),
          );
        leaveAt = performance.now() + 2500;
      },
      () => {
        void win.setFocusable(false).catch(() => {});
        leaveAt = Math.min(leaveAt, performance.now() + 2500);
      },
    );
  };

  const arrive = () => {
    phase = 'stay';
    void markDelivered(id, true);
    view.setState('idle', false, settings.reducedMotion);
    react('greet');
    if (hangout) {
      leaveAt = performance.now() + HANGOUT_MS;
      nextPlay = performance.now() + 3000;
      view.showBubble(`${name}'s pet came to play! 🎈`, { ms: 4000 });
      void emit(HANGOUT.move, { move: 'wave', dir: fromLeft ? -1 : 1 });
      return;
    }
    leaveAt = performance.now() + VISIT_MS;
    const text = it.body ? `${name}: “${it.body}”` : `${name} sent me to say hi! 👋`;
    view.showBubble(text, {
      ms: VISIT_MS,
      actions: [
        { label: 'Reply', onClick: () => void replyTo() },
        {
          label: '👋 Wave back',
          onClick: () => {
            void send(it.sender_id, 'heart').catch(() => {});
            view.addHearts();
            react('hover');
            leaveAt = performance.now() + 2500;
          },
        },
      ],
      onTimeout: () => (leaveAt = 0),
    });
  };

  /** One round of play with the host pet (hang-outs). */
  const play = () => {
    const moves: HangoutMove[] = ['jump', 'hearts', 'wave', 'laugh', 'tag'];
    const move = moves[Math.floor(Math.random() * moves.length)] ?? 'wave';
    const lines = PLAY_LINES[move];
    if (Math.random() < 0.5)
      view.showBubble(lines[Math.floor(Math.random() * lines.length)] ?? '', { ms: 2500 });
    switch (move) {
      case 'jump':
        view.setState('celebrate', false, settings.reducedMotion);
        expr?.hold('celebrate', now(), 2.2);
        window.setTimeout(() => view.setState('idle', false, settings.reducedMotion), 2400);
        break;
      case 'hearts':
        view.addHearts(6);
        react('hover');
        break;
      case 'wave':
        react('greet');
        break;
      case 'laugh':
        react('click');
        break;
      case 'tag': {
        // Run to the other side of the host pet; it turns to look.
        if (host) {
          const otherSide = x < host.x ? host.x + host.width * 0.55 : host.x - W * 0.55;
          target = Math.min(left + width - W * 0.8, Math.max(left - W * 0.2, otherSide));
          phase = 'enter';
        }
        break;
      }
    }
    void emit(HANGOUT.move, { move, dir: target > x ? 1 : -1 });
  };

  const leave = () => {
    phase = 'leave';
    target = outside;
    react('greet');
    if (hangout) {
      view.showBubble('Bye! That was fun 🎈', { ms: 2500 });
      void emit(HANGOUT.move, { move: 'wave', dir: fromLeft ? -1 : 1 });
      void emit(HANGOUT.end);
    }
    window.setTimeout(() => view.setState('walk', false, settings.reducedMotion), 900);
  };

  // Click the visitor: hearts and a happy face.
  view.target.addEventListener('click', () => {
    view.addHearts();
    react('click');
  });

  view.setState('walk', false, settings.reducedMotion);
  setPos();
  await win.show();

  let last = performance.now();
  const frame = () => {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const moving = phase === 'enter' || phase === 'leave';
    if (moving) {
      const dir = Math.sign(target - x) || 1;
      x += dir * Math.min(Math.abs(target - x), SPEED * dt * (hangout && leaveAt ? 1.6 : 1));
      view.setFlip(dir < 0);
      setPos();
      if (Math.abs(target - x) < 0.5) {
        if (phase === 'leave') return close();
        if (leaveAt === 0) arrive();
        else {
          phase = 'stay'; // finished a game of tag
          view.setState('idle', false, settings.reducedMotion);
          react('click');
        }
      }
    } else if (phase === 'stay') {
      if (t >= leaveAt && (!view.bubbleOpen || t >= leaveAt + 1000)) leave();
      else if (hangout && t >= nextPlay && !view.bubbleOpen) {
        play();
        nextPlay = t + 6000 + Math.random() * 6000;
      }
    }
    if (expr) {
      const f = expr.frame(
        { state: moving ? 'walk' : 'idle', sleepy: false, sinceInteraction: 0, userIdle: 0 },
        now(),
      );
      if (view.setFrame(f)) sendMask();
    }
    sendMask();
    window.setTimeout(frame, moving ? 33 : 125);
  };
  frame();
}
