-- The server holds each world's state.
--
-- Until now clients wrote events straight into public.events and every client
-- rebuilt the world by replaying them all. From here on the Edge Function
-- quex-act is the only writer: it checks each action against the current state
-- with the game's own rules, applies it, and saves the event (as history, and
-- for realtime) together with the new state, in one transaction.
--
-- The nightly work (ticks) is done by the server too, on a schedule.

-- ------------------------------------------------------------------ state

create table if not exists public.world_state (
  world      text primary key references public.worlds(seed) on delete cascade,
  state      jsonb not null,
  -- how many events have been applied since the snapshot was first made;
  -- events carry the same number (events.n), so a client can tell if it missed one
  n          bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.world_state enable row level security;
create policy "members or public read state" on public.world_state for select to anon, authenticated
  using (public.is_member(world) or public.is_public(world));

alter table public.events add column if not exists n bigint;
-- the server's own events (the nightly ticks) aren't written by any user
alter table public.events alter column user_id drop not null;

-- clients can no longer write events directly: everything goes through quex-act
drop policy if exists "write own events" on public.events;

-- ------------------------------------------------------------------ who may do what

-- The same rules the old insert policy had, for a given user (null = the server).
create or replace function public.may_act(p_world text, p_user uuid, p_player text, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then p_kind = 'tick'
    when not exists (select 1 from world_members m where m.world = p_world and m.user_id = p_user) then false
    when p_kind = 'join' then not exists (select 1 from player_owners o where o.world = p_world and o.player_id = p_player)
    else
      (exists (select 1 from player_owners o where o.world = p_world and o.player_id = p_player and o.user_id = p_user)
        and (p_kind not in ('progress', 'habit', 'habitAdd', 'habitRemove', 'habitGoal', 'drink', 'freeze')
             or not exists (select 1 from player_guardians g where g.world = p_world and g.player_id = p_player)))
      or (exists (select 1 from player_guardians g where g.world = p_world and g.player_id = p_player and g.guardian_id = p_user)
        and p_kind in ('progress', 'habit', 'habitAdd', 'habitRemove', 'habitGoal', 'drink', 'freeze', 'rename'))
  end
$$;

-- May this user (null = no account) see this world?
create or replace function public.may_read(p_world text, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select w.public from worlds w where w.seed = p_world), false)
    or exists (select 1 from world_members m where m.world = p_world and m.user_id = p_user)
$$;

-- ------------------------------------------------------------------ writing

-- Save one checked action and the state after it. p_n is the state's count the
-- function worked from: if another action got in first, nothing is saved and
-- the function tries again from the newer state.
create or replace function public.commit_event(p_world text, p_user uuid, p_n bigint, p_event jsonb, p_state jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cur bigint;
  prior bigint;
begin
  select n into cur from world_state where world = p_world for update;
  if not found then return jsonb_build_object('error', 'This world has no state yet'); end if;
  -- the same action sent twice (a retry after a dropped connection)
  select e.n into prior from events e where e.id = p_event ->> 'id' and e.world = p_world;
  if found then return jsonb_build_object('duplicate', true, 'n', prior); end if;
  if cur <> p_n then return jsonb_build_object('conflict', true); end if;
  if not may_act(p_world, p_user, p_event ->> 'playerId', p_event ->> 't') then
    return jsonb_build_object('error', 'Not allowed');
  end if;
  insert into events (id, world, at, player_id, user_id, kind, body, n)
  values (p_event ->> 'id', p_world, (p_event ->> 'at')::timestamptz, p_event ->> 'playerId', p_user, p_event ->> 't', p_event, cur + 1);
  update world_state set state = p_state, n = cur + 1, updated_at = now() where world = p_world;
  return jsonb_build_object('n', cur + 1);
end $$;

-- A world's first snapshot, made by replaying its history once. Only saved if
-- the history is still what was replayed (p_count events).
create or replace function public.seed_world_state(p_world text, p_state jsonb, p_count bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from world_state where world = p_world) then return true; end if;
  if (select count(*) from events where world = p_world) <> p_count then return false; end if;
  insert into world_state (world, state, n) values (p_world, p_state, 0) on conflict do nothing;
  return true;
end $$;

revoke all on function public.may_act(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.may_read(text, uuid) from public, anon, authenticated;
revoke all on function public.commit_event(text, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.seed_world_state(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.may_act(text, uuid, text, text) to service_role;
grant execute on function public.may_read(text, uuid) to service_role;
grant execute on function public.commit_event(text, uuid, bigint, jsonb, jsonb) to service_role;
grant execute on function public.seed_world_state(text, jsonb, bigint) to service_role;

-- ------------------------------------------------------------------ the nightly work

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A secret only the database knows, made here so it never sits in the repo.
-- The schedule sends it; the function asks the database whether it's right.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'quex_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'quex_cron_secret', 'quex-act nightly ticks');
  end if;
end $$;

create or replace function public.cron_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'quex_cron_secret' and decrypted_secret = p_secret)
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

-- every hour (players' days roll over at their own hours), a little after the hour
select cron.schedule('quex-ticks', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://snzgotquolwdbdnmbdov.supabase.co/functions/v1/quex-act',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-quex-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'quex_cron_secret')),
    body := '{"op":"tick"}'::jsonb
  )
$cron$);
