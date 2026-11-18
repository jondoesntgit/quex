-- Guardians (parents, grandparents...): any number per player. A supervised
-- player's tasks and habits are set and checked off by their guardians; the
-- player still chooses their own actions and explores.
--
-- A guardian is added only through a one-time invite created by the player's
-- own account, so nobody can claim someone else's village.

create table if not exists public.player_guardians (
  world       text not null,
  player_id   text not null,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (world, player_id, guardian_id)
);
alter table public.player_guardians enable row level security;

create table if not exists public.guardian_invites (
  token      text primary key,
  world      text not null,
  player_id  text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_by    uuid references auth.users(id) on delete set null,
  used_at    timestamptz
);
alter table public.guardian_invites enable row level security;

-- helpers used by policies (run as the caller, read past RLS)
create or replace function public.is_owner(p_world text, p_player text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_owners where world = p_world and player_id = p_player and user_id = auth.uid())
$$;
create or replace function public.is_guardian(p_world text, p_player text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where world = p_world and player_id = p_player and guardian_id = auth.uid())
$$;
create or replace function public.is_supervised(p_world text, p_player text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where world = p_world and player_id = p_player)
$$;
revoke all on function public.is_owner(text, text) from public, anon;
revoke all on function public.is_guardian(text, text) from public, anon;
revoke all on function public.is_supervised(text, text) from public, anon;
grant execute on function public.is_owner(text, text) to authenticated;
grant execute on function public.is_guardian(text, text) to authenticated;
grant execute on function public.is_supervised(text, text) to authenticated;

create policy "members read guardians" on public.player_guardians for select to authenticated using (public.is_member(world));
-- a guardian may step down; the supervised player can't remove them
create policy "guardians leave" on public.player_guardians for delete to authenticated using (guardian_id = auth.uid());

create policy "owners make invites" on public.guardian_invites for insert to authenticated
  with check (created_by = auth.uid() and public.is_owner(world, player_id));
create policy "owners see own invites" on public.guardian_invites for select to authenticated using (created_by = auth.uid());

-- Events: tasks and habits of a supervised player come only from guardians.
drop policy if exists "write own events" on public.events;
create policy "write own events" on public.events for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_member(world)
  and (
    (kind = 'join' and not exists (select 1 from player_owners o where o.world = events.world and o.player_id = events.player_id))
    or (public.is_owner(world, player_id)
        and (kind not in ('progress', 'habit', 'habitAdd', 'habitRemove', 'freeze') or not public.is_supervised(world, player_id)))
    or (public.is_guardian(world, player_id)
        and kind in ('progress', 'habit', 'habitAdd', 'habitRemove', 'freeze', 'rename'))
  )
);

-- Accept an invite: the signed-in user becomes a guardian (and joins the world).
create or replace function public.accept_guardian(p_token text) returns table (world text, player_id text)
language plpgsql security definer set search_path = public as $$
declare inv guardian_invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from guardian_invites i where i.token = p_token for update;
  if not found then raise exception 'That parent link is not valid'; end if;
  if inv.used_at is not null then raise exception 'That parent link has already been used'; end if;
  if inv.created_at < now() - interval '7 days' then raise exception 'That parent link has expired: ask for a new one'; end if;
  if inv.created_by = auth.uid() then raise exception 'Open this link while signed in to the parent''s account, not the child''s'; end if;
  insert into worlds (seed) values (inv.world) on conflict do nothing;
  insert into world_members (world, user_id) values (inv.world, auth.uid()) on conflict do nothing;
  insert into player_guardians (world, player_id, guardian_id) values (inv.world, inv.player_id, auth.uid()) on conflict do nothing;
  update guardian_invites set used_by = auth.uid(), used_at = now() where token = p_token;
  return query select inv.world, inv.player_id;
end $$;
revoke all on function public.accept_guardian(text) from public, anon;
grant execute on function public.accept_guardian(text) to authenticated;

-- Task names: one row per player/day/slot, shared by the player and their
-- guardians (still never visible to neighbours or in the event log).
create table public.task_labels_v2 (
  player_id  text not null,
  date       date not null,
  slot       smallint not null check (slot between 0 and 9),
  text       text not null default '' check (char_length(text) <= 200),
  updated_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (player_id, date, slot)
);
insert into public.task_labels_v2 (player_id, date, slot, text, updated_by, updated_at)
  select distinct on (player_id, date, slot) player_id, date, slot, text, user_id, updated_at
  from public.task_labels order by player_id, date, slot, updated_at desc;
drop table public.task_labels;
alter table public.task_labels_v2 rename to task_labels;
alter table public.task_labels rename constraint task_labels_v2_pkey to task_labels_pkey;
alter table public.task_labels enable row level security;

-- whoever writes a row is its updated_by (so any guardian can edit any task)
create or replace function public.stamp_task_label() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger task_labels_stamp before insert or update on public.task_labels
  for each row execute function public.stamp_task_label();

create or replace function public.can_read_tasks(p_player text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_owners where player_id = p_player and user_id = auth.uid())
      or exists (select 1 from player_guardians where player_id = p_player and guardian_id = auth.uid())
$$;
create or replace function public.can_write_tasks(p_player text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and guardian_id = auth.uid())
      or (exists (select 1 from player_owners where player_id = p_player and user_id = auth.uid())
          and not exists (select 1 from player_guardians where player_id = p_player))
$$;
revoke all on function public.can_read_tasks(text) from public, anon;
revoke all on function public.can_write_tasks(text) from public, anon;
grant execute on function public.can_read_tasks(text) to authenticated;
grant execute on function public.can_write_tasks(text) to authenticated;

create policy "read own or wards' task labels" on public.task_labels for select to authenticated using (public.can_read_tasks(player_id));
create policy "write task labels" on public.task_labels for insert to authenticated with check (updated_by = auth.uid() and public.can_write_tasks(player_id));
create policy "update task labels" on public.task_labels for update to authenticated
  using (public.can_write_tasks(player_id)) with check (updated_by = auth.uid() and public.can_write_tasks(player_id));
revoke all on public.task_labels from anon;

-- live updates: a child sees new tasks from a parent without reloading
alter publication supabase_realtime add table public.task_labels;
alter publication supabase_realtime add table public.player_guardians;
