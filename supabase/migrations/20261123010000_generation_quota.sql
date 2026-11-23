-- Per-user daily quota for AI pet generation (each call spends real money on the image API).

create table public.generation_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  characters int not null default 0,
  frames int not null default 0,
  primary key (user_id, day)
);

alter table public.generation_usage enable row level security;

create policy "generation_usage: read own" on public.generation_usage
  for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete on public.generation_usage from anon, authenticated;
grant select on public.generation_usage to authenticated;

-- Atomically spends one unit of quota for the calling user, or raises if the limit is reached.
-- `p_kind`: 'character' (a new pet, from a photo) or 'frame' (one expression/pose of a pet).
create or replace function public.consume_generation_quota(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  max_characters constant int := 4;
  -- 17 frames per pet plus retries. Also keeps us inside Cloudflare's free daily allowance.
  max_frames constant int := 90;
  row public.generation_usage;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_kind not in ('character', 'frame') then
    raise exception 'bad quota kind %', p_kind using errcode = '22023';
  end if;

  insert into public.generation_usage as g (user_id, day, characters, frames)
  values (uid, (now() at time zone 'utc')::date, 0, 0)
  on conflict (user_id, day) do nothing;

  update public.generation_usage
     set characters = characters + (p_kind = 'character')::int,
         frames = frames + (p_kind = 'frame')::int
   where user_id = uid and day = (now() at time zone 'utc')::date
  returning * into row;

  if row.characters > max_characters or row.frames > max_frames then
    raise exception 'daily pet-making limit reached, try again tomorrow' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.consume_generation_quota(text) from public, anon;
grant execute on function public.consume_generation_quota(text) to authenticated;
