begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Two users; the trigger creates their profiles.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '{"display_name":"Alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '{}');

select is((select count(*)::int from public.profiles
  where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2,
  'trigger creates a profile per user');
select matches(
  (select friend_code from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '^[A-Z0-9]{8}$', 'friend code has expected shape');

-- Act as Alice.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'a user only sees their own profile');
select is((select display_name from public.profiles), 'Alice', 'display name from sign-up metadata');

select throws_ok(
  $$update public.profiles set friend_code = 'AAAAAAAA'$$,
  '42501', null, 'friend_code is not client-writable');

update public.profiles set display_name = 'Bob hacked' where id = '22222222-2222-2222-2222-222222222222';
reset role;
select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'New friend', 'cannot update another user''s profile');

select * from finish();
rollback;
