import type { Database, Json, PetManifest } from '@deskpals/shared';
import { ipc } from './ipc';
import { supabase } from './supabase';

export type Friend = Database['public']['Functions']['list_friends']['Returns'][number];
export type Interaction = Database['public']['Tables']['interactions']['Row'];
export type InteractionType = Database['public']['Enums']['interaction_type'];
export type Profile = Database['public']['Tables']['profiles']['Row'];

/** Shape broadcast by the hidden social window to every other window. */
export interface SocialState {
  signedIn: boolean;
  connected: boolean;
  me: Profile | null;
  friends: Friend[];
  online: string[];
}

/** Payload for nudges/hearts/messages shown by the user's own pet. */
export interface IncomingEvent {
  interaction: Interaction;
  senderName: string;
}

export const EVENTS = {
  state: 'social://state',
  requestState: 'social://request-state',
  incoming: 'social://incoming',
  mood: 'social://mood',
  refresh: 'social://refresh',
} as const;

function client() {
  if (!supabase) throw new Error('Not connected to the server.');
  return supabase;
}

/**
 * Throws with the server's friendly message on error. Query/RPC data is only null for void
 * functions (whose result callers ignore), so it is narrowed here.
 */
function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as NonNullable<T>;
}

export async function myProfile(): Promise<Profile | null> {
  const c = client();
  const { data } = await c.auth.getUser();
  if (!data.user) return null;
  return check(await c.from('profiles').select('*').eq('id', data.user.id).single());
}

export async function updateProfile(
  patch: Partial<Pick<Profile, 'display_name' | 'mood_emoji' | 'mood_shared' | 'avatar_pet_id'>>,
) {
  const c = client();
  const { data } = await c.auth.getUser();
  if (!data.user) throw new Error('Not signed in.');
  check(await c.from('profiles').update(patch).eq('id', data.user.id));
}

export const listFriends = async () => check(await client().rpc('list_friends'));
export const addFriend = async (code: string) => check(await client().rpc('add_friend', { code }));
export const respondRequest = async (id: string, accept: boolean) =>
  check(await client().rpc('respond_friend_request', { request_id: id, accept }));
export const removeFriend = async (id: string) =>
  check(await client().rpc('remove_friend', { friend: id }));
export const blockUser = async (id: string) =>
  check(await client().rpc('block_user', { target: id }));
export const unblockUser = async (id: string) =>
  check(await client().rpc('unblock_user', { target: id }));

/** Sets my mood and (at most every 30 min) tells my friends' pets. */
export const shareMood = async (emoji: string, label: string) =>
  check(await client().rpc('share_mood', { emoji, label }));
export const clearMood = async () => check(await client().rpc('clear_mood'));

export async function send(
  recipient: string,
  kind: InteractionType,
  message?: string,
  pet?: string,
) {
  return check(
    await client().rpc('send_interaction', {
      recipient,
      kind,
      ...(message ? { message } : {}),
      ...(pet ? { pet } : {}),
    }),
  );
}

/** Recent interactions between me and a friend, oldest first. */
export async function conversation(friendId: string, limit = 30): Promise<Interaction[]> {
  const rows = check(
    await client()
      .from('interactions')
      .select('*')
      .or(`sender_id.eq.${friendId},recipient_id.eq.${friendId}`)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  return rows.reverse();
}

export async function markDelivered(id: string, seen = false) {
  const now = new Date().toISOString();
  await client()
    .from('interactions')
    .update(seen ? { delivered_at: now, seen_at: now } : { delivered_at: now })
    .eq('id', id);
}

/** A friend's pet (manifest + sprite) for rendering a visit or an avatar. */
export async function friendPet(
  petId: string,
): Promise<{ manifest: PetManifest; sprite: Blob } | null> {
  const c = client();
  const row = (await c.from('pets').select('manifest, sprite_path').eq('id', petId).maybeSingle())
    .data;
  if (!row) return null;
  const { data } = await c.storage.from('pets').download(row.sprite_path);
  return data ? { manifest: row.manifest as unknown as PetManifest, sprite: data } : null;
}

/**
 * Mirrors local pets to the cloud so friends can see them visit: uploads new ones and removes
 * cloud copies of pets deleted locally (which deletes their images from storage too).
 */
export async function syncPets(): Promise<void> {
  const c = client();
  const { data: auth } = await c.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const [local, settings] = await Promise.all([ipc.listPets(), ipc.getSettings()]);
  const remote = check(await c.from('pets').select('id, sprite_path').eq('owner_id', uid));
  const remoteIds = new Set(remote.map((r) => r.id));
  const localIds = new Set(local.map((p) => p.id));

  for (const pet of local) {
    if (remoteIds.has(pet.id)) continue;
    const path = `${uid}/${pet.id}.png`;
    const sprite = await ipc.getPetSprite(pet.id);
    check(
      await c.storage.from('pets').upload(path, sprite, { upsert: true, contentType: 'image/png' }),
    );
    check(
      await c.from('pets').upsert({
        id: pet.id,
        owner_id: uid,
        name: pet.name,
        kind: pet.kind,
        style: pet.style,
        sprite_path: path,
        manifest: pet as unknown as { [key: string]: Json },
        consent_confirmed: pet.kind === 'person' ? pet.consentConfirmed : false,
      }),
    );
  }
  const gone = remote.filter((r) => !localIds.has(r.id));
  if (gone.length) {
    await c.storage.from('pets').remove(gone.map((r) => r.sprite_path));
    check(
      await c
        .from('pets')
        .delete()
        .in(
          'id',
          gone.map((r) => r.id),
        ),
    );
  }
  // The first pet that's out is your avatar and the one that goes visiting.
  const avatar = settings.activePets.find((id) => localIds.has(id)) ?? local[0]?.id ?? null;
  await updateProfile({ avatar_pet_id: avatar });
}

/** The pet that goes visiting: the first one that's out. */
export async function visitingPetId(): Promise<string | null> {
  const [local, settings] = await Promise.all([ipc.listPets(), ipc.getSettings()]);
  const ids = new Set(local.map((p) => p.id));
  return settings.activePets.find((id) => ids.has(id)) ?? local[0]?.id ?? null;
}
