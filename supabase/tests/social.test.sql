begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Alice (a), Bob (b) and a stranger, Eve (e).
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@test.dev'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'eve@test.dev');
update public.profiles set friend_code = 'ALICE234', display_name = 'Alice', mood_emoji = '😄', mood_shared = true
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set friend_code = 'BOBBY234', display_name = 'Bob'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set friend_code = 'EVEEE234', display_name = 'Eve'
 where id = 'eeeeeeee-0000-0000-0000-000000000003';

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- Alice creates a pet.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.pets (id, name, kind, style, sprite_path, manifest)
values ('11111111-aaaa-0000-0000-000000000001', 'Cutu', 'animal', 'stylized',
        'aaaaaaaa-0000-0000-0000-000000000001/11111111-aaaa-0000-0000-000000000001.png', '{}');
select is((select count(*)::int from public.pets), 1, 'owner sees own pet');
select throws_ok(
  $$insert into public.pets (id, name, kind, style, sprite_path, manifest)
    values (gen_random_uuid(), 'X', 'person', 'cutout', 'aaaaaaaa-0000-0000-0000-000000000001/x.png', '{}')$$,
  '23514', null, 'person pets require consent');
select throws_ok(
  $$insert into public.pets (id, name, kind, style, sprite_path, manifest)
    values (gen_random_uuid(), 'X', 'animal', 'cutout', 'bbbbbbbb-0000-0000-0000-000000000002/x.png', '{}')$$,
  '42501', null, 'cannot point a pet at someone else''s storage folder');

-- Strangers see nothing and can't send anything.
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*)::int from public.pets), 0, 'non-friend cannot read pets');
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'non-friend cannot read profile');
select throws_ok(
  $$select public.send_interaction('aaaaaaaa-0000-0000-0000-000000000001', 'nudge')$$,
  '42501', null, 'non-friend cannot send interactions');
select throws_ok($$select public.add_friend('NOPE1234')$$, 'P0002', null, 'unknown code');
select throws_ok($$select public.add_friend('bobby234')$$, '22023', null, 'cannot add yourself');

-- Bob requests Alice by code; Alice sees an incoming request and accepts.
select is((select status::text from public.add_friend('alice234')), 'pending', 'request created (code is case-insensitive)');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.list_friends() where incoming and status = 'pending'), 1,
  'addressee sees the incoming request');
select lives_ok(
  $$select public.respond_friend_request((select friendship_id from public.list_friends() limit 1), true)$$,
  'accept request');
select ok(public.are_friends('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  'now friends');

-- Friends can see each other's pets, profile and shared mood; Eve still can't.
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*)::int from public.pets), 1, 'friend can read pets');
select is((select mood_emoji from public.list_friends() where status = 'accepted'), '😄', 'shared mood visible');
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000003');
select is((select count(*)::int from public.pets), 0, 'stranger still cannot read pets');

-- Bob sends a visit with his... no pet; with Alice's pet id → rejected.
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.send_interaction('aaaaaaaa-0000-0000-0000-000000000001', 'visit', 'hi', '11111111-aaaa-0000-0000-000000000001')$$,
  '42501', null, 'cannot send a visit with someone else''s pet');
select isnt(public.send_interaction('aaaaaaaa-0000-0000-0000-000000000001', 'message', 'hello!'), null, 'friend can message');
select throws_ok(
  $$select public.send_interaction('aaaaaaaa-0000-0000-0000-000000000001', 'message', repeat('x', 201))$$,
  '22001', null, 'messages are capped at 200 characters');

-- Rate limit: 20 per 10 minutes.
select throws_ok(
  $$select public.send_interaction('aaaaaaaa-0000-0000-0000-000000000001', 'nudge') from generate_series(1, 25)$$,
  'P0001', null, 'rate limit enforced');

-- Alice can mark it delivered but not rewrite it; Eve can't see it.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.interactions set delivered_at = now();
select is((select count(*)::int from public.interactions where delivered_at is not null), 1, 'recipient marks delivered');
select throws_ok($$update public.interactions set body = 'forged'$$, '42501', null, 'body is not editable');
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000003');
select is((select count(*)::int from public.interactions), 0, 'others cannot read interactions');

-- Alice blocks Bob: his sends are silently dropped and he no longer sees her pets.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.block_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select is(public.send_interaction('aaaaaaaa-0000-0000-0000-000000000001', 'heart'), null, 'blocked sender is silently dropped');
select is((select count(*)::int from public.pets), 0, 'blocked user loses access to pets');

select * from finish();
rollback;
