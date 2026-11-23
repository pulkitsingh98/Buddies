/**
 * A friend's pet visiting this screen (window label `visit-<interaction id>`): it walks in from
 * a screen edge, says the friend's message (with Reply / wave-back buttons), then waves and walks
 * off, and the window closes itself.
 */
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { MESSAGE_MAX_LEN } from '@deskpals/shared';
import { ipc } from '../lib/ipc';
import { friendPet, listFriends, markDelivered, send } from '../lib/social';
import { supabase } from '../lib/supabase';
import { Expressions } from './expressions';
import { MASK_COLS, MASK_ROWS, PetView } from './view';

const STAY_MS = 30_000;
const SPEED = 110; // px/s

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
  const friends = await listFriends().catch(() => []);
  const name = friends.find((f) => f.user_id === it.sender_id)?.display_name ?? 'A friend';
  const settings = await ipc.getSettings();

  const sprite = await createImageBitmap(pet.sprite);
  const view = new PetView(sprite, URL.createObjectURL(pet.sprite), pet.manifest);
  view.layout(settings.petSize);
  const expr = view.frameIds.size > 1 ? new Expressions(view.frameIds) : null;

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

  // Walk in from the left or right edge of the work area.
  const m = (await currentMonitor()) ?? (await primaryMonitor());
  const W = window.innerWidth;
  const H = window.innerHeight;
  const sf = m?.scaleFactor ?? 1;
  const left = (m?.workArea.position.x ?? 0) / sf;
  const width = (m?.workArea.size.width ?? 1200) / sf;
  const floorTop = ((m?.workArea.position.y ?? 0) + (m?.workArea.size.height ?? 800)) / sf - H;
  const fromLeft = Math.random() < 0.5;
  const outside = fromLeft ? left - W : left + width;
  const spot = fromLeft ? left + width * 0.2 : left + width * 0.8 - W;

  let x = outside;
  let phase: 'enter' | 'talk' | 'leave' = 'enter';
  let target = spot;
  let leaveAt = 0;
  const t0 = performance.now();

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

  const talk = () => {
    phase = 'talk';
    leaveAt = performance.now() + STAY_MS;
    void markDelivered(id, true);
    view.setState('idle', false, settings.reducedMotion);
    expr?.react('greet', performance.now() / 1000);
    view.pop();
    const text = it.body ? `${name}: “${it.body}”` : `${name} sent me to say hi! 👋`;
    view.showBubble(text, {
      ms: STAY_MS,
      actions: [
        { label: 'Reply', onClick: () => void replyTo() },
        {
          label: '👋 Wave back',
          onClick: () => {
            void send(it.sender_id, 'heart').catch(() => {});
            view.addHearts();
            expr?.react('hover', performance.now() / 1000);
            leaveAt = performance.now() + 2500;
          },
        },
      ],
      onTimeout: () => (leaveAt = 0),
    });
  };

  const leave = () => {
    phase = 'leave';
    target = outside;
    expr?.react('greet', performance.now() / 1000);
    window.setTimeout(() => view.setState('walk', false, settings.reducedMotion), 900);
  };

  // Click the visitor: hearts and a happy face.
  view.target.addEventListener('click', () => {
    view.addHearts();
    expr?.react('click', performance.now() / 1000);
    view.pop();
  });

  view.setState('walk', false, settings.reducedMotion);
  void win.setPosition(new LogicalPosition(Math.round(x), Math.round(floorTop)));
  await win.show();

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (phase === 'enter' || phase === 'leave') {
      const dir = Math.sign(target - x) || 1;
      x += dir * Math.min(Math.abs(target - x), SPEED * dt);
      view.setFlip(dir < 0);
      void win.setPosition(new LogicalPosition(Math.round(x), Math.round(floorTop)));
      if (Math.abs(target - x) < 0.5) {
        if (phase === 'enter') talk();
        else return close();
      }
    } else if (phase === 'talk' && now >= leaveAt && !view.bubbleOpen) {
      leave();
    } else if (phase === 'talk' && now >= leaveAt + 1000) {
      leave();
    }
    if (expr) {
      const f = expr.frame(
        {
          state: phase === 'talk' ? 'idle' : 'walk',
          sleepy: false,
          sinceInteraction: 0,
          userIdle: 0,
        },
        (now - t0) / 1000,
      );
      if (view.setFrame(f)) sendMask();
    }
    sendMask();
    window.setTimeout(frame, phase === 'talk' ? 125 : 33);
  };
  frame();
}
