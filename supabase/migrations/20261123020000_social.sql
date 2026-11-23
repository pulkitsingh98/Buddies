-- DeskPals Phase 3: pets in the cloud, friendships, interactions (visits, nudges, hearts, messages).
-- Visibility: only accepted friends see each other's pets, profiles and presence. No discovery:
-- the only way to find someone is their friend code.

-- ---------------------------------------------------------------- friendships
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  -- who blocked (only set when status = 'blocked')
  blocked_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
-- One row per pair of users, whichever direction.
create unique index friendships_pair_key on public.friendships (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
);
create index friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;
-- You see rows you are part of, except that a blocked person never learns they were blocked.
create policy "friendships: read own" on public.friendships
  for select to authenticated
  using (
    (select auth.uid()) in (requester_id, addressee_id)
    and (status <> 'blocked' or blocked_by = (select auth.uid()))
  );
-- All writes go through the functions below.
revoke insert, update, delete on public.friendships from anon, authenticated;
grant select on public.friendships to authenticated;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(a, b)
      and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
  );
$$;

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'blocked'
      and least(f.requester_id, f.addressee_id) = least(a, b)
      and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public, anon;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- profiles: friends can see them
-- mood_emoji is only ever set when the user chose to share their mood.
create policy "profiles: friends can read" on public.profiles
  for select to authenticated
  using (public.are_friends((select auth.uid()), id));

-- ---------------------------------------------------------------- pets
create table public.pets (
  -- same id as the pet's local manifest
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('person', 'animal', 'object')),
  style text not null check (style in ('cutout', 'stylized')),
  sprite_path text not null,
  manifest jsonb not null,
  consent_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  -- pets made from photos of people need the creator's confirmation of consent
  check (kind <> 'person' or consent_confirmed)
);
create index pets_owner_idx on public.pets (owner_id);

alter table public.pets enable row level security;
create policy "pets: owner manages" on public.pets
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and sprite_path like (select auth.uid())::text || '/%');
create policy "pets: friends can read" on public.pets
  for select to authenticated
  using (public.are_friends((select auth.uid()), owner_id));
grant select, insert, update, delete on public.pets to authenticated;

alter table public.profiles add column avatar_pet_id uuid references public.pets (id) on delete set null;
grant update (avatar_pet_id) on public.profiles to authenticated;

-- ---------------------------------------------------------------- interactions
create type public.interaction_type as enum ('visit', 'nudge', 'heart', 'message', 'hangout_invite');

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  pet_id uuid references public.pets (id) on delete set null,
  type public.interaction_type not null,
  body text check (char_length(body) <= 200),
  delivered_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index interactions_recipient_idx on public.interactions (recipient_id, created_at desc);
create index interactions_sender_idx on public.interactions (sender_id, created_at desc);

alter table public.interactions enable row level security;
create policy "interactions: read own" on public.interactions
  for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));
create policy "interactions: recipient marks delivered/seen" on public.interactions
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
revoke insert, update, delete on public.interactions from anon, authenticated;
grant select on public.interactions to authenticated;
grant update (delivered_at, seen_at) on public.interactions to authenticated;

-- ---------------------------------------------------------------- functions

-- Send (or accept) a friend request by friend code. Returns the friendship row.
create or replace function public.add_friend(code text)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  them uuid;
  f public.friendships;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select id into them from public.profiles where friend_code = upper(trim(code));
  if them is null then raise exception 'No one has that friend code.' using errcode = 'P0002'; end if;
  if them = me then raise exception 'That''s your own code!' using errcode = '22023'; end if;

  select * into f from public.friendships
   where least(requester_id, addressee_id) = least(me, them)
     and greatest(requester_id, addressee_id) = greatest(me, them);

  if f.id is null then
    insert into public.friendships (requester_id, addressee_id) values (me, them) returning * into f;
  elsif f.status = 'pending' and f.addressee_id = me then
    -- They already asked us: adding their code accepts.
    update public.friendships set status = 'accepted' where id = f.id returning * into f;
  elsif f.status = 'blocked' then
    -- Don't reveal blocks: look like a normal pending request.
    if f.blocked_by = me then
      raise exception 'You blocked this person. Unblock them first.' using errcode = '22023';
    end if;
    f.status := 'pending';
  end if;
  return f;
end;
$$;

create or replace function public.respond_friend_request(request_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if accept then
    update public.friendships set status = 'accepted'
     where id = request_id and addressee_id = auth.uid() and status = 'pending';
  else
    delete from public.friendships
     where id = request_id and addressee_id = auth.uid() and status = 'pending';
  end if;
end;
$$;

-- Removes a friendship or cancels a pending request (either side).
create or replace function public.remove_friend(friend uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
   where status <> 'blocked'
     and least(requester_id, addressee_id) = least(auth.uid(), friend)
     and greatest(requester_id, addressee_id) = greatest(auth.uid(), friend);
end;
$$;

create or replace function public.block_user(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or target = me then return; end if;
  insert into public.friendships (requester_id, addressee_id, status, blocked_by)
  values (me, target, 'blocked', me)
  on conflict ((least(requester_id, addressee_id)), (greatest(requester_id, addressee_id)))
  do update set status = 'blocked', blocked_by = me;
end;
$$;

create or replace function public.unblock_user(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
   where status = 'blocked' and blocked_by = auth.uid()
     and least(requester_id, addressee_id) = least(auth.uid(), target)
     and greatest(requester_id, addressee_id) = greatest(auth.uid(), target);
end;
$$;

-- Friends, incoming/outgoing requests and people you blocked, with display info.
create or replace function public.list_friends()
returns table (
  friendship_id uuid,
  user_id uuid,
  display_name text,
  mood_emoji text,
  status public.friendship_status,
  incoming boolean,
  avatar_pet_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id,
         p.id,
         p.display_name,
         case when f.status = 'accepted' and p.mood_shared then p.mood_emoji end,
         f.status,
         f.addressee_id = auth.uid(),
         case when f.status = 'accepted' then p.avatar_pet_id end
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
   where auth.uid() in (f.requester_id, f.addressee_id)
     and (f.status <> 'blocked' or f.blocked_by = auth.uid())
   order by f.status, p.display_name;
$$;

-- The only way to create an interaction. Checks friendship and rate limits; interactions from
-- someone the recipient blocked are dropped silently (the sender sees success).
create or replace function public.send_interaction(
  recipient uuid,
  kind public.interaction_type,
  message text default null,
  pet uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  recent int;
  new_id uuid;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if message is not null and char_length(message) > 200 then
    raise exception 'Messages can be up to 200 characters.' using errcode = '22001';
  end if;
  if public.is_blocked(me, recipient) then
    return null;
  end if;
  if not public.are_friends(me, recipient) then
    raise exception 'You can only send things to friends.' using errcode = '42501';
  end if;
  if pet is not null and not exists (select 1 from public.pets where id = pet and owner_id = me) then
    raise exception 'That pet isn''t yours.' using errcode = '42501';
  end if;

  -- Rate limit per sender → recipient: 20 per 10 minutes, 100 per day.
  select count(*) into recent from public.interactions
   where sender_id = me and recipient_id = recipient and created_at > now() - interval '10 minutes';
  if recent >= 20 then
    raise exception 'Slow down a little — try again in a few minutes.' using errcode = 'P0001';
  end if;
  select count(*) into recent from public.interactions
   where sender_id = me and recipient_id = recipient and created_at > now() - interval '1 day';
  if recent >= 100 then
    raise exception 'That''s a lot of love for one day! Try again tomorrow.' using errcode = 'P0001';
  end if;

  insert into public.interactions (sender_id, recipient_id, pet_id, type, body)
  values (me, recipient, pet, kind, nullif(trim(message), ''))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.add_friend(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
revoke all on function public.list_friends() from public, anon;
revoke all on function public.send_interaction(uuid, public.interaction_type, text, uuid) from public, anon;
grant execute on function public.add_friend(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.send_interaction(uuid, public.interaction_type, text, uuid) to authenticated;

-- ---------------------------------------------------------------- storage: pet sprites
-- Path: <owner uid>/<pet id>.png. Owner writes; owner and accepted friends read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pets', 'pets', false, 8388608, array['image/png'])
on conflict (id) do nothing;

create policy "pets bucket: owner writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pets bucket: owner updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'pets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pets bucket: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'pets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pets bucket: owner and friends read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pets'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        and public.are_friends((select auth.uid()), ((storage.foldername(name))[1])::uuid)
      )
    )
  );

-- ---------------------------------------------------------------- realtime
-- Row changes (RLS applies) for incoming interactions and friend requests.
alter publication supabase_realtime add table public.interactions, public.friendships;

-- Presence on private channels "presence:<uid>": only you can announce yourself on your own
-- channel; you and accepted friends may join (listen to) it. Realtime checks read access per
-- topic when joining, for both presence and broadcast, so the read policy is topic-based.
create policy "presence: track own" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and (select realtime.topic()) = 'presence:' || (select auth.uid())::text
  );
create policy "presence: owner and friends listen" on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = 'presence:' || (select auth.uid())::text
    or (
      (select realtime.topic()) ~ '^presence:[0-9a-f-]{36}$'
      and public.are_friends((select auth.uid()), substring((select realtime.topic()) from 10)::uuid)
    )
  );
