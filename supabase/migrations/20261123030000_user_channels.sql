-- Deliver interactions and friend-list changes over each user's private broadcast channel
-- "user:<uid>" (lower latency than postgres_changes). Rows are still stored, so anything missed
-- while offline is picked up from the table on reconnect.

-- Topic-based: Realtime checks read access for presence and broadcast when joining.
-- Nobody can send on these channels from a client (no insert policy); only the triggers below.
create policy "user channel: owner listens" on realtime.messages
  for select to authenticated
  using ((select realtime.topic()) = 'user:' || (select auth.uid())::text);

create or replace function public.broadcast_interaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(to_jsonb(new), 'interaction', 'user:' || new.recipient_id::text, true);
  return null;
end;
$$;

create trigger interactions_broadcast
  after insert on public.interactions
  for each row execute function public.broadcast_interaction();

create or replace function public.broadcast_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.friendships := coalesce(new, old);
begin
  perform realtime.send('{}'::jsonb, 'friends_changed', 'user:' || f.requester_id::text, true);
  -- The other side is told too, except about being blocked.
  if coalesce(new.status::text, '') <> 'blocked' then
    perform realtime.send('{}'::jsonb, 'friends_changed', 'user:' || f.addressee_id::text, true);
  end if;
  return null;
end;
$$;

create trigger friendships_broadcast
  after insert or update or delete on public.friendships
  for each row execute function public.broadcast_friendship_change();

revoke all on function public.broadcast_interaction() from public, anon, authenticated;
revoke all on function public.broadcast_friendship_change() from public, anon, authenticated;

-- postgres_changes is no longer used for these tables.
alter publication supabase_realtime drop table public.interactions, public.friendships;
