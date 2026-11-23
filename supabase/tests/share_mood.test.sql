begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'm1@test.dev'),
  ('bbbbbbbb-1111-0000-0000-000000000002', 'm2@test.dev'),
  ('cccccccc-1111-0000-0000-000000000003', 'm3@test.dev');
insert into public.friendships (requester_id, addressee_id, status) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000002', 'accepted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-0000-0000-000000000001","role":"authenticated"}', true);

select is(public.share_mood('😔', 'sad'), 1, 'friends (only) are notified');
select is((select body from public.interactions where recipient_id = 'bbbbbbbb-1111-0000-0000-000000000002'),
  '😔 sad', 'notification carries the mood');
select is(public.share_mood('😄', 'happy'), 0, 'no second notification within 30 minutes');
select is((select mood_emoji from public.profiles where id = 'aaaaaaaa-1111-0000-0000-000000000001'), '😄',
  'profile still shows the latest mood');

select set_config('request.jwt.claims', '{"sub":"cccccccc-1111-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.interactions), 0, 'non-friends get nothing');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-0000-0000-000000000001","role":"authenticated"}', true);
select public.clear_mood();
select is((select mood_shared from public.profiles where id = 'aaaaaaaa-1111-0000-0000-000000000001'), false,
  'clearing hides the mood');

select * from finish();
rollback;
