import { emit, listen } from '@tauri-apps/api/event';
import { MESSAGE_MAX_LEN } from '@deskpals/shared';
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { ipc, type Settings } from '../lib/ipc';
import { forwardErrors } from '../lib/log';
import {
  EVENTS,
  HANGOUT,
  HANGOUT_ACCEPT,
  send,
  visitingPetId,
  type HangoutMove,
  type IncomingEvent,
  type PetSpot,
} from '../lib/social';
import {
  CHORES_DONE,
  choresPetName,
  runTidy,
  today,
  undoTidy,
  type ChoresDone,
} from '../lib/chores';
import { Behavior, type BehaviorConfig, type PetState } from './behavior';
import { Expressions, type Reaction } from './expressions';
import { FocusTimer } from './focus';
import {
  COMPLIMENTS,
  EYE_LINES,
  GOOD_MESSAGES,
  pick,
  REACTIONS,
  STRETCH_TIPS,
  WATER_LINES,
} from './messages';
import {
  breathingSteps,
  JOKES,
  MOODS,
  moodFromText,
  type Mood,
  type MoodOption,
  type MoodStep,
} from './moods';
import { tickHz } from './pose';
import { MASK_COLS, MASK_ROWS, PetView, type BubbleAction } from './view';
import {
  emptyState,
  localDay,
  Wellbeing,
  type Prompt,
  type WellbeingConfig,
  type WellbeingState,
} from './wellbeing';

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
  /** Highest the pet can be perched (keeps it on screen). */
  maxLift: number;
}

/** Where the user last put this pet, remembered across restarts. */
const posKey = (id: string) => `deskpals:pos:${id}`;
function loadPosition(id: string): { x: number; lift: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(posKey(id)) ?? 'null') as {
      x: number;
      lift: number;
    } | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.lift) ? v : null;
  } catch {
    return null;
  }
}
function savePosition(id: string, x: number, lift: number) {
  try {
    localStorage.setItem(posKey(id), JSON.stringify({ x: Math.round(x), lift: Math.round(lift) }));
  } catch {
    // storage unavailable: the pet just starts somewhere new next time
  }
}

function behaviorConfig(s: Settings, stayPut: boolean): BehaviorConfig {
  return {
    sleepAfterSec: s.sleepAfterMin * 60,
    bedtimeHour: s.bedtimeHour,
    reducedMotion: s.reducedMotion,
    walkSpeed: Math.max(30, s.petSize * 0.35),
    stayPut,
  };
}

function wellbeingConfig(s: Settings): WellbeingConfig {
  return {
    reminders: {
      water: { enabled: s.waterEnabled, everyMin: s.waterEveryMin },
      stretch: { enabled: s.stretchEnabled, everyMin: s.stretchEveryMin },
      eye: { enabled: s.eyeEnabled, everyMin: s.eyeEveryMin },
    },
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    dailyMessage: s.dailyMessage,
    compliments: s.compliments,
    moodCheckin: s.moodCheckin,
  };
}

async function geometry(): Promise<Geometry> {
  const m = (await currentMonitor()) ?? (await primaryMonitor());
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!m) return { minX: 0, maxX: 800, floorTop: 600, maxLift: 500 };
  const sf = m.scaleFactor;
  const left = m.workArea.position.x / sf;
  const top = m.workArea.position.y / sf;
  const width = m.workArea.size.width / sf;
  const height = m.workArea.size.height / sf;
  // The window has transparent margins, so let it overhang the edges a little.
  const floorTop = top + height - h;
  return {
    minX: left - w * 0.2,
    maxX: left + width - w * 0.8,
    floorTop,
    // let the transparent top margin go off-screen, but keep the pet itself visible
    maxLift: Math.max(0, floorTop - top + h * 0.35),
  };
}

const yesterday = () => localDay(new Date(Date.now() - 86_400_000));

async function main() {
  const [manifest, spriteBlob, initialSettings, savedWellbeing] = await Promise.all([
    ipc.getPet(petId),
    ipc.getPetSprite(petId),
    ipc.getSettings(),
    ipc.getWellbeingState().catch(() => null),
  ]);
  let settings = initialSettings;
  const sprite = await createImageBitmap(spriteBlob);
  const view = new PetView(sprite, URL.createObjectURL(spriteBlob), manifest);
  view.layout(settings.petSize);

  let geom = await geometry();
  const focus = new FocusTimer();
  const saved = loadPosition(petId);
  const behavior = new Behavior(
    behaviorConfig(settings, false),
    saved
      ? Math.min(geom.maxX, Math.max(geom.minX, saved.x))
      : geom.minX + Math.random() * (geom.maxX - geom.minX),
  );
  if (saved) behavior.lift = Math.min(geom.maxLift, Math.max(0, saved.lift));
  let hangingOut = false;
  const applyConfig = () =>
    behavior.setConfig(behaviorConfig(settings, focus.phase === 'focus' || hangingOut));

  // Only the first pet that's out runs reminders and the focus timer, so they don't double up.
  const isPrimary = () => settings.activePets[0] === petId;
  const wellbeing = new Wellbeing(
    wellbeingConfig(settings),
    (savedWellbeing as WellbeingState | null) ?? emptyState(localDay(new Date())),
  );
  let saveTimer: number | undefined;
  const saveWellbeing = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void ipc.setWellbeingState(wellbeing.state), 1000);
  };

  // Cartoon pets have many drawn expressions; cutout pets have one frame.
  const expr =
    view.frameIds.size > 1
      ? new Expressions(view.frameIds, Math.random, performance.now() / 1000)
      : null;
  let lastInteraction = performance.now();
  const interacted = () => (lastInteraction = performance.now());

  // --- speech: tasks (reminders, questions) are never overwritten by chit-chat ---
  let bubbleIsTask = false;
  const say = (text: string, ms = 3000) => {
    if (view.bubbleOpen && bubbleIsTask) return;
    bubbleIsTask = false;
    view.showBubble(text, { ms });
  };
  const ask = (text: string, actions: BubbleAction[], ms: number, onTimeout?: () => void) => {
    bubbleIsTask = true;
    view.showBubble(text, {
      ms,
      actions: actions.map((a) => ({
        ...a,
        onClick: () => {
          bubbleIsTask = false;
          a.onClick();
        },
      })),
      onTimeout: () => {
        bubbleIsTask = false;
        onTimeout?.();
      },
    });
  };
  const react = (kind: Reaction, line?: string, chance = 1) => {
    expr?.react(kind, performance.now() / 1000);
    view.pop();
    if (line && Math.random() < chance) say(line);
  };

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

  // Shake detection while dragging: several quick direction reversals.
  let lastVelSign = 0;
  let reversals: number[] = [];

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
    // The shadow only lifts away while the pet is held; perched, it stands on an invisible ledge.
    view.setLift(behavior.state === 'drag' ? behavior.lift + 200 : 0);

    if (expr) {
      const now = performance.now();
      if (behavior.state === 'drag') {
        const v = behavior.dragVelocity;
        const sign = Math.abs(v) > 600 ? Math.sign(v) : 0;
        if (sign && lastVelSign && sign !== lastVelSign) {
          reversals = [...reversals.filter((t) => now - t < 1200), now];
          if (reversals.length >= 3) {
            react('shake', pick(REACTIONS.shake));
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
          userIdle: userIdleSec(now),
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
  const userIdleSec = (now: number) => idleBase + (now - idleAt) / 1000;
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

  // --- noticing the cursor: wave when it comes close after being away ---
  let cursorFarSince = performance.now();
  let nextCursorCheck = 0;
  const checkCursor = (now: number) => {
    if (now < nextCursorCheck || behavior.state === 'sleep' || behavior.state === 'drag') return;
    nextCursorCheck = now + 500;
    void cursorPosition()
      .then((p) => {
        const sf = window.devicePixelRatio || 1;
        const cx = behavior.x + window.innerWidth / 2;
        const cy = geom.floorTop - behavior.lift + window.innerHeight * 0.6;
        const d = Math.hypot(p.x / sf - cx, p.y / sf - cy);
        const t = performance.now();
        if (d > 400) {
          if (cursorFarSince === 0) cursorFarSince = t;
        } else if (d < 180 && cursorFarSince && t - cursorFarSince > 20_000) {
          cursorFarSince = 0;
          if (behavior.state === 'idle' || behavior.state === 'sit') react('greet', 'Hi! 👋', 0.3);
        } else if (d <= 400) {
          cursorFarSince = 0;
        }
      })
      .catch(() => {});
  };

  // --- pointer: drag, click to pet, double-click to celebrate, hover to pet ---
  const target = view.target;
  let press: { sx: number; sy: number; x: number; lift: number; dragging: boolean } | null = null;
  let hoverTimer: number | undefined;
  let lastHoverPet = 0;
  let clicks: number[] = [];
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
        behavior.lift = Math.min(g.maxLift, Math.max(0, g.floorTop - top));
        if (behavior.lift < 24) behavior.lift = 0;
        savePosition(petId, behavior.x, behavior.lift);
      });
    } else {
      const now = performance.now();
      clicks = [...clicks.filter((t) => now - t < 3000), now];
      const wasAsleep = behavior.state === 'sleep';
      behavior.dispatch({ type: 'pet' });
      if (wasAsleep) say(pick(REACTIONS.wake));
      else if (clicks.length >= 5) {
        react('spam', pick(REACTIONS.spam));
        clicks = [];
      } else react('click', pick(REACTIONS.click), 0.35);
    }
    wake();
  });
  target.addEventListener('dblclick', () => {
    behavior.dispatch({ type: 'celebrate' });
    say(pick(REACTIONS.celebrate), 2000);
    wake();
  });
  target.addEventListener('pointerenter', () => {
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (press || performance.now() - lastHoverPet < 6000) return;
      lastHoverPet = performance.now();
      interacted();
      behavior.dispatch({ type: 'pet' });
      react('hover', pick(REACTIONS.hover), 0.25);
      wake();
    }, 900);
  });
  target.addEventListener('pointerleave', () => clearTimeout(hoverTimer));

  // --- wellbeing prompts (primary pet only) ---
  const deliver = (p: Prompt) => {
    switch (p.type) {
      case 'reminder': {
        const kind = p.kind;
        const text =
          kind === 'water'
            ? pick(WATER_LINES)
            : kind === 'stretch'
              ? `Stretch time! 🙆 ${pick(STRETCH_TIPS)}`
              : pick(EYE_LINES);
        react('greet');
        ask(
          text,
          [
            {
              label: kind === 'water' ? 'Done 💧' : 'Done ✓',
              onClick: () => {
                wellbeing.done(kind, Date.now());
                saveWellbeing();
                behavior.dispatch({ type: 'celebrate' });
                say(
                  kind === 'water'
                    ? `Yay! ${wellbeing.state.waterGlasses} glass${wellbeing.state.waterGlasses === 1 ? '' : 'es'} today 💧`
                    : 'Nice! Your body says thanks 🎉',
                );
                wake();
              },
            },
            {
              label: 'Snooze 10m',
              onClick: () => {
                wellbeing.snooze(kind, Date.now(), 10);
                saveWellbeing();
              },
            },
          ],
          60_000,
          () => {
            wellbeing.snooze(kind, Date.now(), 15);
            saveWellbeing();
          },
        );
        break;
      }
      case 'goodMessage':
        react('greet');
        ask(pick(GOOD_MESSAGES), [{ label: '💛', onClick: () => react('hover') }], 20_000);
        break;
      case 'compliment':
        react('hover', pick(COMPLIMENTS));
        break;
      case 'mood':
        askMood();
        break;
    }
    saveWellbeing();
  };

  // --- mood check-in: a small decision tree (see moods.ts) ---
  const later = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
  const breathe = async () => {
    for (const step of breathingSteps()) {
      view.setBreath(step.phase);
      bubbleIsTask = true;
      view.showBubble(step.text, { ms: step.seconds * 1000 + 400 });
      await later(step.seconds * 1000);
    }
    view.setBreath(null);
    bubbleIsTask = false;
    say('Well done 💛', 2500);
    await later(2600);
  };
  const runAction = async (option: MoodOption) => {
    switch (option.action) {
      case 'celebrate':
        behavior.dispatch({ type: 'celebrate' });
        break;
      case 'hearts':
      case 'stayClose':
        view.addHearts(8);
        react('hover');
        break;
      case 'breathe':
        await breathe();
        return;
      case 'stretch':
        say(`Stretch with me 🙆 ${pick(STRETCH_TIPS)}`, 9000);
        await later(9000);
        return;
      case 'break':
        startBreak();
        break;
      case 'focus':
        if (focus.phase === 'idle') startFocus();
        break;
      case 'water':
        view.addHearts(3);
        break;
      case 'joke':
        react('click');
        say(pick(JOKES), 9000);
        await later(9000);
        return;
      case 'friends':
        void ipc.openFriends();
        break;
      case 'compliment':
        react('hover');
        say(pick(COMPLIMENTS), 6000);
        await later(6000);
        return;
      default:
        break;
    }
    wake();
  };
  const askStep = (mood: Mood, step: MoodStep) => {
    ask(
      step.question,
      step.options.map((o) => ({
        label: o.label,
        onClick: () =>
          void (async () => {
            interacted();
            if (o.reply) {
              say(o.reply, 5000);
              await later(o.action || o.next ? 2800 : 0);
            }
            await runAction(o);
            if (o.next) askStep(mood, o.next);
          })(),
      })),
      45_000,
    );
  };
  const askMood = () => {
    ask(
      'How are you feeling?',
      MOODS.map((m) => ({
        label: m.emoji,
        onClick: () => {
          interacted();
          wellbeing.setMood(m.emoji);
          saveWellbeing();
          void emit(EVENTS.mood, { emoji: m.emoji, label: m.label });
          expr?.hold(m.frame, performance.now() / 1000, 6);
          view.pop();
          if (m.valence === 'positive') behavior.dispatch({ type: 'celebrate' });
          say(m.reaction, 2600);
          window.setTimeout(() => askStep(m, m.step), 2700);
          wake();
        },
      })),
      60_000,
    );
  };
  void listen('tray://mood', () => {
    if (isPrimary()) askMood();
  });

  let nextWellbeingCheck = 0;
  let lastLonelyLine = 0;
  const checkWellbeing = (now: number) => {
    if (!isPrimary() || now < nextWellbeingCheck) return;
    nextWellbeingCheck = now + 5000;
    const d = new Date();
    const prompt = wellbeing.next({
      now: Date.now(),
      hour: d.getHours(),
      day: localDay(d),
      userIdleSec: userIdleSec(now),
      busy:
        view.bubbleOpen ||
        focus.phase === 'focus' ||
        behavior.state === 'drag' ||
        behavior.state === 'sleep',
    });
    if (prompt) deliver(prompt);
    // Lonely: ignored for half an hour while the user is at the computer.
    if (
      now - lastInteraction > 30 * 60_000 &&
      userIdleSec(now) < 60 &&
      now - lastLonelyLine > 30 * 60_000 &&
      !view.bubbleOpen
    ) {
      lastLonelyLine = now;
      say(pick(REACTIONS.lonely), 5000);
    }
  };

  // --- focus timer (tray "Start Focus Timer") ---
  const startFocus = () => {
    focus.startFocus(Date.now(), settings.focusMin);
    applyConfig();
    behavior.dispatch({ type: 'celebrate' });
    say(`Focus time! I'll sit right here with you 🍅 (${settings.focusMin} min)`, 4000);
    wake();
  };
  const startBreak = () => {
    focus.startBreak(Date.now(), settings.breakMin);
    applyConfig();
    say(`Break time! Stretch, sip, look away 🌿 (${settings.breakMin} min)`, 5000);
    wake();
  };
  const stopFocus = () => {
    focus.stop();
    applyConfig();
    view.setBadge(null);
  };
  const updateFocus = () => {
    const ev = focus.tick(Date.now());
    if (ev === 'focusDone') {
      wellbeing.focusCompleted(localDay(new Date()), yesterday());
      saveWellbeing();
      applyConfig();
      behavior.dispatch({ type: 'celebrate' });
      react('click');
      const n = wellbeing.state.focusSessionsToday;
      const streak = wellbeing.state.focusStreak;
      ask(
        `Focus session done! 🎉 ${n} today${streak > 1 ? ` · ${streak}-day streak 🔥` : ''}. Take a ${settings.breakMin}-min break?`,
        [
          { label: 'Start break', onClick: startBreak },
          { label: 'Skip', onClick: () => {} },
        ],
        120_000,
      );
    } else if (ev === 'breakDone') {
      ask(
        "Break's over! Another round? 🍅",
        [
          { label: 'Start focus', onClick: startFocus },
          { label: 'Later', onClick: () => {} },
        ],
        120_000,
      );
    }
    if (focus.phase === 'idle' || view.bubbleOpen) view.setBadge(null);
    else
      view.setBadge(`${focus.phase === 'focus' ? '🍅' : '🌿'} ${focus.remaining(Date.now())}`, () =>
        ask(
          focus.phase === 'focus' ? 'Stop this focus session?' : 'End the break?',
          [
            { label: 'Stop', onClick: stopFocus },
            { label: 'Keep going', onClick: () => {} },
          ],
          15_000,
        ),
      );
  };
  void listen('tray://focus', () => {
    if (!isPrimary()) return;
    if (focus.phase === 'idle') startFocus();
    else
      ask(
        'A session is running. Stop it?',
        [
          { label: 'Stop', onClick: stopFocus },
          { label: 'Keep going', onClick: () => {} },
        ],
        15_000,
      );
  });

  // --- friends: nudges, hearts and messages arrive at your own (first) pet ---
  const replyTo = async (to: string, name: string) => {
    await win.setFocusable(true).catch(() => {});
    await win.setFocus().catch(() => {});
    view.showInput(
      `Reply to ${name}`,
      MESSAGE_MAX_LEN,
      (text) =>
        void send(to, 'message', text)
          .then(() => say('Sent! 💌', 2000))
          .catch((e: unknown) => say(e instanceof Error ? e.message : String(e), 4000)),
      () => void win.setFocusable(false).catch(() => {}),
    );
  };
  const sendBack = (to: string, kind: 'nudge' | 'heart', done: string) =>
    void send(to, kind)
      .then(() => say(done, 2000))
      .catch((e: unknown) => say(e instanceof Error ? e.message : String(e), 4000));
  void listen<IncomingEvent>(EVENTS.incoming, (e) => {
    if (!isPrimary()) return;
    const { interaction: it, senderName: name } = e.payload;
    interacted();
    if (behavior.state === 'sleep') behavior.dispatch({ type: 'pet' });
    switch (it.type) {
      case 'nudge':
        behavior.dispatch({ type: 'celebrate' });
        react('nudge');
        ask(
          `${name} nudged you! 👉`,
          [
            {
              label: '👉 Nudge back',
              onClick: () => sendBack(it.sender_id, 'nudge', 'Nudged back!'),
            },
          ],
          20_000,
        );
        break;
      case 'heart':
        view.addHearts(8);
        react('hover');
        ask(
          `${name} is thinking of you 💕`,
          [
            {
              label: '💕 Send one back',
              onClick: () => sendBack(it.sender_id, 'heart', 'Love sent 💕'),
            },
          ],
          20_000,
        );
        break;
      case 'message':
        react('greet');
        ask(
          `${name}: “${it.body ?? ''}”`,
          [
            { label: 'Reply', onClick: () => void replyTo(it.sender_id, name) },
            { label: '💕', onClick: () => sendBack(it.sender_id, 'heart', 'Love sent 💕') },
          ],
          60_000,
        );
        break;
      case 'mood': {
        const mood = moodFromText(it.body ?? '');
        const feeling = it.body ?? 'something';
        if (mood?.valence === 'negative') {
          expr?.hold('sad', performance.now() / 1000, 4);
          ask(
            `${name} is feeling ${feeling} 💛 Send some love?`,
            [
              {
                label: '🫂 Send a hug',
                onClick: () => sendBack(it.sender_id, 'heart', 'Hug sent 🫂'),
              },
              { label: '✉️ Message', onClick: () => void replyTo(it.sender_id, name) },
            ],
            60_000,
          );
        } else {
          react(mood?.valence === 'positive' ? 'click' : 'greet');
          ask(
            `${name} is feeling ${feeling}!`,
            [
              {
                label: mood?.valence === 'positive' ? '🎉 Cheer' : '💕 Send love',
                onClick: () => sendBack(it.sender_id, 'heart', 'Sent 💕'),
              },
              { label: '✉️ Message', onClick: () => void replyTo(it.sender_id, name) },
            ],
            30_000,
          );
        }
        break;
      }
      case 'hangout_invite':
        react('greet');
        ask(
          `${name} wants to hang out! 🎈 Your pets can play together for 10 minutes.`,
          [
            {
              label: 'Yes! 🎉',
              onClick: () =>
                void (async () => {
                  const pet = await visitingPetId();
                  await send(it.sender_id, 'hangout_invite', HANGOUT_ACCEPT, pet ?? undefined);
                  await ipc.spawnVisitor(it.id);
                })().catch((err: unknown) =>
                  say(err instanceof Error ? err.message : String(err), 4000),
                ),
            },
            { label: 'Not now', onClick: () => {} },
          ],
          60_000,
        );
        break;
      default:
        break;
    }
    wake();
  });

  // --- hang-out: a friend's pet is visiting and wants to play with this one ---
  void listen(HANGOUT.where, () => {
    if (!isPrimary()) return;
    void emit(HANGOUT.here, {
      x: Math.round(behavior.x),
      y: Math.round(geom.floorTop - behavior.lift),
      width: window.innerWidth,
    } satisfies PetSpot);
  });
  void listen(HANGOUT.start, () => {
    if (!isPrimary()) return;
    hangingOut = true;
    applyConfig();
    if (behavior.state === 'sleep') behavior.dispatch({ type: 'pet' });
    wake();
  });
  void listen(HANGOUT.end, () => {
    hangingOut = false;
    applyConfig();
  });
  void listen<{ move: HangoutMove; dir: 1 | -1 }>(HANGOUT.move, (e) => {
    if (!isPrimary()) return;
    interacted();
    switch (e.payload.move) {
      case 'jump':
        behavior.dispatch({ type: 'celebrate' });
        break;
      case 'hearts':
        view.addHearts(5);
        react('hover');
        break;
      case 'wave':
        react('greet');
        break;
      case 'laugh':
        react('click');
        break;
      case 'tag':
        // Turn to look at where the visitor ran off to.
        behavior.dir = e.payload.dir;
        react('nudge');
        break;
    }
    wake();
  });

  // --- updates: the pet tells you when a new version is ready ---
  void listen<string>('update://available', (e) => {
    if (!isPrimary()) return;
    const key = 'deskpals:update-asked';
    const day = new Date().toDateString();
    if (localStorage.getItem(key) === day) return;
    localStorage.setItem(key, day);
    react('greet');
    ask(
      `A new version of DeskPals (v${e.payload}) is ready ✨`,
      [
        {
          label: 'Update now',
          onClick: () => {
            say('Updating… see you in a moment! 👋', 10_000);
            void ipc.installUpdate().catch((err: unknown) => say(String(err), 5000));
          },
        },
        { label: 'Later', onClick: () => {} },
      ],
      120_000,
    );
  });

  // --- chores: celebrate a tidy, and now and then offer one ---
  void listen<ChoresDone>(CHORES_DONE, (e) => {
    if (!isPrimary()) return;
    const { report } = e.payload;
    behavior.dispatch({ type: 'celebrate' });
    view.addHearts(4);
    ask(
      `All tidy! ✨ I put ${report.moved} file${report.moved === 1 ? '' : 's'} in “${report.dest.split(/[\\/]/).slice(-2).join('/')}”.`,
      [
        {
          label: '↩️ Undo',
          onClick: () => void undoTidy().then(() => say('Put everything back 👍', 3000)),
        },
        { label: '👍 Thanks', onClick: () => react('hover') },
      ],
      30_000,
    );
    wake();
  });
  let nextTidyCheck = performance.now() + 10 * 60_000;
  const offerTidy = (now: number) => {
    if (now < nextTidyCheck || !settings.tidyDesktop || view.bubbleOpen || focus.phase !== 'idle')
      return;
    nextTidyCheck = now + 2 * 3600_000;
    const key = 'deskpals:tidy-offered';
    if (localStorage.getItem(key) === today()) return;
    void choresPetName()
      .then((name) => ipc.tidyPreview('desktop', name, today()))
      .then((plan) => {
        if (plan.moves.length < 15 || userIdleSec(performance.now()) > 60) return;
        localStorage.setItem(key, today());
        react('greet');
        ask(
          `Your Desktop has ${plan.moves.length} loose files. Want me to tidy up? 🧹`,
          [
            {
              label: 'Tidy up!',
              onClick: () =>
                void runTidy('desktop').catch((err: unknown) => say(String(err), 5000)),
            },
            { label: 'Preview first', onClick: () => void ipc.openChores() },
            { label: 'Not now', onClick: () => {} },
          ],
          60_000,
        );
      })
      .catch(() => {});
  };

  // --- settings, resize, suspension ---
  void listen<Settings>('settings://changed', (e) => {
    settings = e.payload;
    applyConfig();
    wellbeing.cfg = wellbeingConfig(settings);
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

  // --- behaviour loop: fast only while the window moves; a few Hz at rest ---
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
      userIdleSec: userIdleSec(now),
      hour: new Date().getHours(),
    });
    for (const fx of behavior.drainEffects()) {
      if (fx === 'hearts') view.addHearts();
      if (fx === 'land') view.pop();
      if (fx === 'bedtimeNudge') say(pick(BEDTIME_LINES), 10_000);
    }
    if (prevState === 'wake' && behavior.state === 'idle')
      react('greet', pick(REACTIONS.greet), 0.6);
    if (prevState === 'walk' && behavior.state !== 'walk')
      savePosition(petId, behavior.x, behavior.lift);
    prevState = behavior.state;

    syncView();
    if (!press?.dragging) syncPosition();
    checkCursor(now);
    if (isPrimary()) {
      updateFocus();
      checkWellbeing(now);
      offerTidy(now);
    }

    if (!shown) {
      shown = true;
      void win.show();
    }
    // Cartoon pets tick a little faster at rest so blinks and quirks land on time.
    const hz = Math.max(tickHz(behavior.state), expr ? 8 : 2);
    timer = window.setTimeout(frame, 1000 / hz);
  }
  wake();
}

forwardErrors(win.label);
(win.label.startsWith('visit-') ? import('./visitor').then((m) => m.runVisitor()) : main()).catch(
  (e: unknown) => {
    throw e;
  },
);
