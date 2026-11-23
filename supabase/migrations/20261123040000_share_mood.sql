-- Mood sharing: setting your mood (with sharing on) updates your profile and tells each friend's
-- pet ("Pulkit is feeling sad 😔"). At most one notification per 30 minutes, so changing your mind
-- doesn't spam anyone.

alter type public.interaction_type add value if not exists 'mood';

create or replace function public.share_mood(emoji text, label text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  sent int := 0;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if char_length(emoji) > 16 or char_length(label) > 40 then
    raise exception 'mood too long' using errcode = '22001';
  end if;

  update public.profiles set mood_emoji = emoji, mood_shared = true where id = me;

  if exists (
    select 1 from public.interactions
     where sender_id = me and type::text = 'mood' and created_at > now() - interval '30 minutes'
  ) then
    return 0;
  end if;

  insert into public.interactions (sender_id, recipient_id, type, body)
  select me,
         case when f.requester_id = me then f.addressee_id else f.requester_id end,
         'mood'::public.interaction_type,
         emoji || ' ' || label
    from public.friendships f
   where f.status = 'accepted' and me in (f.requester_id, f.addressee_id);
  get diagnostics sent = row_count;
  return sent;
end;
$$;

create or replace function public.clear_mood()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set mood_emoji = null, mood_shared = false where id = auth.uid();
$$;

revoke all on function public.share_mood(text, text) from public, anon;
revoke all on function public.clear_mood() from public, anon;
grant execute on function public.share_mood(text, text) to authenticated;
grant execute on function public.clear_mood() to authenticated;
