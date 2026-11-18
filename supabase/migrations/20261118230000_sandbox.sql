-- Two worlds:
--  * quex-season-1, the friends-and-family playtest: public to look at, but
--    closed to new players (admins can open it to let someone in).
--  * quex-sandbox, open to anyone on the internet to try the game.

alter table public.worlds add column if not exists closed boolean not null default false;

-- joining: the first person to open a world creates it and becomes its admin;
-- a closed world only lets in people who are already members
create or replace function public.join_world(p_world text) returns void
language plpgsql security definer set search_path = public as $$
declare created text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into worlds (seed) values (p_world) on conflict do nothing returning seed into created;
  if created is not null then
    insert into world_admins (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
  elsif exists (select 1 from worlds where seed = p_world and closed)
        and not exists (select 1 from world_members where world = p_world and user_id = auth.uid()) then
    raise exception 'WORLD_CLOSED: this world is not taking new players';
  end if;
  insert into world_members (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.set_world_closed(p_world text, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_world) then raise exception 'Only a world admin can change this'; end if;
  update worlds set closed = p_closed where seed = p_world;
end $$;
revoke all on function public.set_world_closed(text, boolean) from public, anon;
grant execute on function public.set_world_closed(text, boolean) to authenticated;

update public.worlds set public = true, closed = true where seed = 'quex-season-1';

insert into public.worlds (seed, public) values ('quex-sandbox', true)
on conflict (seed) do update set public = true;
insert into public.world_admins (world, user_id)
select 'quex-sandbox', user_id from public.world_admins where world = 'quex-season-1'
on conflict do nothing;
insert into public.world_members (world, user_id)
select 'quex-sandbox', user_id from public.world_admins where world = 'quex-season-1'
on conflict do nothing;

-- tidy-up: the temporary link used to test the assistant endpoint
delete from public.assistant_links where label = 'claude-test (temporary)';
