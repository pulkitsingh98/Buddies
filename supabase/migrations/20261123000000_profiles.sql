-- DeskPals: profiles + friend codes.
-- Every table has RLS enabled; clients only ever use the anon key + user JWT.

create extension if not exists pgcrypto with schema extensions;

-- Unambiguous alphabet (no 0/O/1/I/L) so codes are easy to read aloud.
create or replace function public.generate_friend_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  bytes bytea := extensions.gen_random_bytes(8);
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return code;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'New friend'
    check (char_length(display_name) between 1 and 40),
  friend_code text not null unique default public.generate_friend_code()
    check (friend_code ~ '^[A-Z0-9]{8}$'),
  mood_emoji text check (char_length(mood_emoji) <= 16),
  mood_shared boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Phase 0: users see only themselves. Friends' visibility is added with the friendships table.
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Column-level guard: id and friend_code are never client-writable.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, mood_emoji, mood_shared) on public.profiles to authenticated;

-- Create a profile automatically on sign-up (retrying on the rare friend-code collision).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  for attempt in 1..5 loop
    begin
      insert into public.profiles (id, display_name)
      values (
        new.id,
        coalesce(nullif(left(new.raw_user_meta_data ->> 'display_name', 40), ''), 'New friend')
      );
      return new;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
