begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'q@test.dev'),
  ('44444444-4444-4444-4444-444444444444', 'r@test.dev');

set local role anon;
select throws_ok($$select public.consume_generation_quota('character')$$, '42501', null,
  'anonymous callers cannot spend quota');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select lives_ok($$select public.consume_generation_quota('character')$$, 'signed-in user can spend quota');
select throws_ok(
  $$select public.consume_generation_quota('character') from generate_series(1, 4)$$,
  'P0001', 'daily pet-making limit reached, try again tomorrow', 'limit is enforced');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select count(*)::int from public.generation_usage), 0, 'users only see their own usage');

select throws_ok($$insert into public.generation_usage (user_id) values ('44444444-4444-4444-4444-444444444444')$$,
  '42501', null, 'usage rows are not directly writable');

select * from finish();
rollback;
