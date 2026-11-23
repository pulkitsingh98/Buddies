/**
 * Hidden window that owns the realtime connection for as long as the app runs:
 * presence (am I online / which friends are), incoming interactions (live, plus anything queued
 * while offline or in Do Not Disturb), and syncing pets to the cloud. Other windows talk to it
 * through Tauri events (see EVENTS).
 */
import { emit, listen } from '@tauri-apps/api/event';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { ipc, type Settings } from '../lib/ipc';
import { forwardErrors } from '../lib/log';
import {
  EVENTS,
  listFriends,
  markDelivered,
  myProfile,
  syncPets,
  clearMood,
  shareMood,
  type IncomingEvent,
  type Interaction,
  type SocialState,
} from '../lib/social';
import { supabase } from '../lib/supabase';

forwardErrors('social');

const state: SocialState = { signedIn: false, connected: false, me: null, friends: [], online: [] };
let settings: Settings | null = null;
let channels: RealtimeChannel[] = [];
let session: Session | null = null;
const delivering = new Set<string>();

const broadcast = () => void emit(EVENTS.state, state);

async function refreshFriends() {
  if (!session) return;
  try {
    state.me = await myProfile();
    state.friends = await listFriends();
    state.connected = true;
  } catch {
    state.connected = false;
  }
  broadcast();
  watchPresence();
}

/** Deliver one interaction, or leave it queued (DND, or no pet out to show it). */
async function deliver(it: Interaction) {
  if (delivering.has(it.id) || it.delivered_at) return;
  settings ??= await ipc.getSettings();
  if (settings.doNotDisturb) return;
  if ((await ipc.petsOut().catch(() => 0)) === 0) return;
  delivering.add(it.id);
  try {
    if (it.type === 'visit') {
      // The visitor window marks it delivered/seen itself once it has walked in.
      await ipc.spawnVisitor(it.id);
    } else {
      const sender = state.friends.find((f) => f.user_id === it.sender_id);
      const payload: IncomingEvent = {
        interaction: it,
        senderName: sender?.display_name ?? 'A friend',
      };
      await emit(EVENTS.incoming, payload);
      await markDelivered(it.id);
      if (it.type === 'mood') void refreshFriends(); // their mood changed in the list
    }
  } finally {
    // Allow a retry later if something failed before it was marked.
    setTimeout(() => delivering.delete(it.id), 60_000);
  }
}

/** Everything sent to me that hasn't been delivered yet (e.g. while I was offline). */
async function flushQueue() {
  if (!supabase || !session) return;
  const { data } = await supabase
    .from('interactions')
    .select('*')
    .eq('recipient_id', session.user.id)
    .is('delivered_at', null)
    .order('created_at')
    .limit(20);
  for (const it of data ?? []) {
    await deliver(it);
    await new Promise((r) => setTimeout(r, 1500)); // don't stampede the screen
  }
}

let presenceKey = '';
function watchPresence() {
  if (!supabase || !session) return;
  const friendIds = state.friends.filter((f) => f.status === 'accepted').map((f) => f.user_id);
  const key = friendIds.sort().join(',');
  if (key === presenceKey) return;
  presenceKey = key;
  const client = supabase;
  for (const ch of channels.filter(
    (c) => c.topic.includes('presence:') && !c.topic.endsWith(session?.user.id ?? ''),
  ))
    void client.removeChannel(ch);
  channels = channels.filter(
    (c) => !c.topic.includes('presence:') || c.topic.endsWith(session?.user.id ?? ''),
  );
  for (const id of friendIds) {
    const ch = client
      .channel(`presence:${id}`, { config: { private: true } })
      .on('presence', { event: 'sync' }, () => {
        const here = Object.keys(ch.presenceState()).length > 0;
        const was = state.online.includes(id);
        if (here !== was) {
          state.online = here ? [...state.online, id] : state.online.filter((x) => x !== id);
          broadcast();
        }
      })
      .subscribe();
    channels.push(ch);
  }
}

async function connect(s: Session | null) {
  if (!supabase) return;
  const client = supabase;
  for (const ch of channels) void client.removeChannel(ch);
  channels = [];
  presenceKey = '';
  session = s;
  state.signedIn = !!s;
  state.online = [];
  if (!s) {
    state.me = null;
    state.friends = [];
    state.connected = false;
    broadcast();
    return;
  }
  await client.realtime.setAuth(s.access_token);
  const uid = s.user.id;

  // Announce myself to friends.
  const me = client.channel(`presence:${uid}`, {
    config: { private: true, presence: { key: uid } },
  });
  me.subscribe((status) => {
    state.connected = status === 'SUBSCRIBED';
    broadcast();
    if (status === 'SUBSCRIBED') {
      void me.track({ at: Date.now() });
      void flushQueue(); // reconnected: pick up anything that arrived meanwhile
    }
  });
  channels.push(me);

  // My private channel: the database broadcasts new interactions and friend-list changes here.
  const inbox = client
    .channel(`user:${uid}`, { config: { private: true } })
    .on('broadcast', { event: 'interaction' }, (m) => void deliver(m.payload as Interaction))
    .on('broadcast', { event: 'friends_changed' }, () => void refreshFriends())
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void flushQueue();
    });
  channels.push(inbox);

  await refreshFriends();
  void syncPets().catch((e: unknown) => console.warn('pet sync failed', e));
}

if (supabase) {
  const client = supabase;
  void client.auth.getSession().then(({ data }) => connect(data.session));
  client.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void connect(s);
    if (event === 'TOKEN_REFRESHED' && s) void client.realtime.setAuth(s.access_token);
  });
}

void listen(EVENTS.requestState, broadcast);
void listen(EVENTS.refresh, () => void refreshFriends());
void listen<{ emoji: string; label: string }>(EVENTS.mood, (e) => {
  if (session && settings?.shareMood)
    void shareMood(e.payload.emoji, e.payload.label).catch(() => {});
});
void listen<Settings>('settings://changed', (e) => {
  const wasDnd = settings?.doNotDisturb;
  settings = e.payload;
  if (session) {
    if (!settings.shareMood) void clearMood().catch(() => {});
    void syncPets().catch(() => {});
    if (wasDnd && !settings.doNotDisturb) void flushQueue();
  }
});
// Network came back: re-sync and pick up the queue.
window.addEventListener('online', () => void refreshFriends().then(flushQueue));
// Pets coming back out (after Pause or Show) should get queued visits too.
void listen('pets://spawned', () => setTimeout(() => void flushQueue(), 2000));
void ipc.getSettings().then((s) => (settings = s));
