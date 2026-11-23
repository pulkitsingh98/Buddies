// End-to-end check of the social layer against a LOCAL Supabase (`supabase start`):
// two users befriend each other, presence works on private channels, a visit arrives live,
// and a stranger can't read the pet. usage: API_URL=... ANON_KEY=... node scripts/e2e-social.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const { API_URL, ANON_KEY } = process.env;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const mk = () => createClient(API_URL, ANON_KEY, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

async function user(name) {
  const c = mk();
  const email = `${name}-${Date.now()}@e2e.test`;
  const { data, error } = await c.auth.signUp({ email, password: 'password123' });
  if (error) throw error;
  await c.realtime.setAuth(data.session.access_token);
  await c.from('profiles').update({ display_name: name }).eq('id', data.user.id);
  const { data: p } = await c.from('profiles').select('*').eq('id', data.user.id).single();
  return { c, id: data.user.id, code: p.friend_code };
}

const a = await user('Alice');
const b = await user('Bob');
const e = await user('Eve');

// Friends by code.
const { data: req, error: reqErr } = await b.c.rpc('add_friend', { code: a.code });
ok(!reqErr && req.status === 'pending', 'Bob sends a request by code');
const { data: list } = await a.c.rpc('list_friends');
await a.c.rpc('respond_friend_request', { request_id: list[0].friendship_id, accept: true });
const { data: list2 } = await b.c.rpc('list_friends');
ok(list2[0]?.status === 'accepted', 'Alice accepts; Bob sees accepted');

// Bob uploads a pet.
const petId = crypto.randomUUID();
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);
const path = `${b.id}/${petId}.png`;
const up = await b.c.storage.from('pets').upload(path, new Blob([png], { type: 'image/png' }));
ok(!up.error, `Bob uploads a sprite ${up.error?.message ?? ''}`);
const ins = await b.c.from('pets').insert({
  id: petId,
  owner_id: b.id,
  name: 'Rex',
  kind: 'animal',
  style: 'stylized',
  sprite_path: path,
  manifest: { id: petId },
});
ok(!ins.error, `Bob saves the pet row ${ins.error?.message ?? ''}`);
const dl = await a.c.storage.from('pets').download(path);
ok(!dl.error && dl.data?.size > 0, 'Alice (friend) can download the sprite');
const dlE = await e.c.storage.from('pets').download(path);
ok(!!dlE.error || !dlE.data, 'Eve (stranger) cannot download the sprite');
const crossUp = await e.c.storage
  .from('pets')
  .upload(`${b.id}/evil.png`, new Blob([png], { type: 'image/png' }));
ok(!!crossUp.error, "Eve cannot write into Bob's folder");

// Presence on private channels.
const seen = new Promise((resolve) => {
  const ch = a.c
    .channel(`presence:${b.id}`, { config: { private: true } })
    .on('presence', { event: 'sync' }, () => {
      if (Object.keys(ch.presenceState()).length) resolve(true);
    })
    .subscribe();
  setTimeout(() => resolve(false), 8000);
});
const bobMe = b.c.channel(`presence:${b.id}`, {
  config: { private: true, presence: { key: b.id } },
});
bobMe.subscribe((s) => {
  if (s === 'SUBSCRIBED') void bobMe.track({ at: Date.now() });
});
ok(await seen, 'Alice sees Bob online (private presence channel)');

let eveStatus = '';
const eveCh = e.c
  .channel(`presence:${b.id}`, { config: { private: true } })
  .subscribe((s) => (eveStatus = s));
await sleep(3000);
ok(
  eveStatus !== 'SUBSCRIBED' || Object.keys(eveCh.presenceState()).length === 0,
  `Eve can't watch Bob's presence (${eveStatus})`,
);

// Live inbox: Bob sends a visit, Alice receives it on her private "user:<id>" broadcast channel.
// Warm up with a heart first (real clients keep this channel open all day), then time the visit.
const inbox = [];
await new Promise((resolve) => {
  a.c
    .channel(`user:${a.id}`, { config: { private: true } })
    .on('broadcast', { event: 'interaction' }, (m) =>
      inbox.push({ row: m.payload, at: Date.now() }),
    )
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') resolve();
    });
});
for (let i = 0; i < 30 && inbox.length === 0; i++) {
  if (i % 5 === 0) await b.c.rpc('send_interaction', { recipient: a.id, kind: 'heart' });
  await sleep(1000);
}
ok(inbox.length > 0, 'realtime change feed is up');
const sentAt = Date.now();
const sent = await b.c.rpc('send_interaction', {
  recipient: a.id,
  kind: 'visit',
  message: 'hello from Bob!',
  pet: petId,
});
let visit = null;
for (let i = 0; i < 100 && !visit; i++) {
  visit = inbox.find((m) => m.row.type === 'visit') ?? null;
  if (!visit) await sleep(50);
}
const latency = visit ? visit.at - sentAt : NaN;
ok(
  !sent.error && visit?.row.body === 'hello from Bob!',
  `Alice receives the visit live in ${latency} ms ${sent.error?.message ?? ''}`,
);
ok(latency < 2000, 'visit arrives within 2 seconds (Phase 3 acceptance)');

// Eve can't listen on Alice's channel.
let leaked = false;
let eveJoin = '';
e.c
  .channel(`user:${a.id}`, { config: { private: true } })
  .on('broadcast', { event: 'interaction' }, () => (leaked = true))
  .subscribe((s) => (eveJoin = s));
await sleep(1500);
await b.c.rpc('send_interaction', { recipient: a.id, kind: 'nudge' });
await sleep(2500);
ok(!leaked && eveJoin !== 'SUBSCRIBED', `Eve cannot join Alice's channel (${eveJoin})`);

// Offline queue: undelivered rows are fetchable later.
const { data: queued } = await a.c
  .from('interactions')
  .select('id')
  .eq('recipient_id', a.id)
  .is('delivered_at', null);
ok(queued.length >= 2, `undelivered interactions are queued for later (${queued.length})`);

await Promise.all([a.c, b.c, e.c].map((c) => c.removeAllChannels()));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
