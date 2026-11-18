-- Quex: shared, append-only event log per world (event sourcing).
-- Clients replay events through the deterministic reducer in src/game/reducer.ts.
-- Task TEXT never reaches the server: only sizes and done/half/none statuses.

create table if not exists public.worlds (
  seed        text primary key,
  created_at  timestamptz not null default now(),
  season_start date not null default (current_date - extract(dow from current_date)::int)
);

create table if not exists public.world_members (
  world      text not null references public.worlds(seed) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (world, user_id)
);

create table if not exists public.events (
  seq        bigint generated always as identity,
  id         text primary key,
  world      text not null references public.worlds(seed) on delete cascade,
  at         timestamptz not null,
  player_id  text not null,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null,
  body       jsonb not null,
  created_at timestamptz not null default now(),
  -- belt and braces: refuse anything that looks like task text
  constraint no_labels check (not (body ? 'label') and not (body ? 'labels'))
);
create index if not exists events_world_at on public.events (world, at, seq);

-- a player id belongs to the user who first wrote an event for it
create table if not exists public.player_owners (
  world     text not null,
  player_id text not null,
  user_id   uuid not null references auth.users(id) on delete cascade,
  primary key (world, player_id)
);

alter table public.worlds enable row level security;
alter table public.world_members enable row level security;
alter table public.events enable row level security;
alter table public.player_owners enable row level security;

create or replace function public.is_member(p_world text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from world_members where world = p_world and user_id = auth.uid())
$$;

create policy "members read worlds" on public.worlds for select using (public.is_member(seed));
create policy "members read membership" on public.world_members for select using (public.is_member(world));
create policy "members read events" on public.events for select using (public.is_member(world));
create policy "members read owners" on public.player_owners for select using (public.is_member(world));

-- insert only as yourself, only into your worlds, only for players you own
create policy "write own events" on public.events for insert with check (
  user_id = auth.uid()
  and public.is_member(world)
  and (
    exists (select 1 from player_owners o where o.world = events.world and o.player_id = events.player_id and o.user_id = auth.uid())
    or (kind = 'join' and not exists (select 1 from player_owners o where o.world = events.world and o.player_id = events.player_id))
  )
);
-- no updates or deletes: the log is append-only

create or replace function public.claim_player() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'join' then
    insert into player_owners (world, player_id, user_id) values (new.world, new.player_id, new.user_id)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger events_claim_player after insert on public.events for each row execute function public.claim_player();

-- join (and lazily create) a world by seed; invite-by-link for the playtest
create or replace function public.join_world(p_world text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into worlds (seed) values (p_world) on conflict do nothing;
  insert into world_members (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
end $$;
grant execute on function public.join_world(text) to authenticated;

-- realtime for live neighbour pips and caravans
alter publication supabase_realtime add table public.events;
