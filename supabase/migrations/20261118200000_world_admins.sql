-- Public/private worlds, guest viewing, and world administrators.
--  * A world is private (members only) unless an admin makes it public; anyone,
--    signed in or not, can then read its shared event log. Task names stay
--    private (task_labels policies are unchanged).
--  * Whoever creates a world becomes its first admin; admins can add/remove
--    admins (never the last one) and switch the world public/private.

alter table public.worlds add column if not exists public boolean not null default false;

create table if not exists public.world_admins (
  world    text not null references public.worlds(seed) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (world, user_id)
);
alter table public.world_admins enable row level security;

-- existing worlds: the founder of the first village is the admin
insert into public.world_admins (world, user_id)
select distinct on (e.world) e.world, e.user_id
from public.events e
where e.kind = 'join'
order by e.world, e.seq
on conflict do nothing;

create or replace function public.is_public(p_world text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select w.public from worlds w where w.seed = p_world), false)
$$;
create or replace function public.is_admin(p_world text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from world_admins where world = p_world and user_id = auth.uid())
$$;
revoke all on function public.is_public(text) from public;
revoke all on function public.is_admin(text) from public, anon;
grant execute on function public.is_public(text) to anon, authenticated;
grant execute on function public.is_admin(text) to authenticated;
-- the read policies below run for guests too; for them is_member is simply false
grant execute on function public.is_member(text) to anon;

-- reading: members, or anyone for a public world
drop policy if exists "members read events" on public.events;
create policy "members or public read events" on public.events for select to anon, authenticated
  using (public.is_member(world) or public.is_public(world));
drop policy if exists "members read worlds" on public.worlds;
create policy "members or public read worlds" on public.worlds for select to anon, authenticated
  using (public.is_member(seed) or public.is_public(seed));
create policy "members read admins" on public.world_admins for select to authenticated using (public.is_member(world));

-- joining: the first person to open a world creates it and becomes its admin
create or replace function public.join_world(p_world text) returns void
language plpgsql security definer set search_path = public as $$
declare created text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into worlds (seed) values (p_world) on conflict do nothing returning seed into created;
  if created is not null then
    insert into world_admins (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
  end if;
  insert into world_members (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
end $$;

-- can a guest look at this world? (anyone may ask)
create or replace function public.world_is_public(p_world text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_public(p_world)
$$;
grant execute on function public.world_is_public(text) to anon, authenticated;

create or replace function public.set_world_public(p_world text, p_public boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_world) then raise exception 'Only a world admin can change this'; end if;
  update worlds set public = p_public where seed = p_world;
end $$;
revoke all on function public.set_world_public(text, boolean) from public, anon;
grant execute on function public.set_world_public(text, boolean) to authenticated;

create or replace function public.add_world_admin(p_world text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_world) then raise exception 'Only a world admin can add admins'; end if;
  if not exists (select 1 from world_members where world = p_world and user_id = p_user) then
    raise exception 'They need to join this world first';
  end if;
  insert into world_admins (world, user_id) values (p_world, p_user) on conflict do nothing;
end $$;
revoke all on function public.add_world_admin(text, uuid) from public, anon;
grant execute on function public.add_world_admin(text, uuid) to authenticated;

create or replace function public.remove_world_admin(p_world text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_world) then raise exception 'Only a world admin can remove admins'; end if;
  if (select count(*) from world_admins where world = p_world) <= 1 then
    raise exception 'A world needs at least one admin';
  end if;
  delete from world_admins where world = p_world and user_id = p_user;
end $$;
revoke all on function public.remove_world_admin(text, uuid) from public, anon;
grant execute on function public.remove_world_admin(text, uuid) to authenticated;
