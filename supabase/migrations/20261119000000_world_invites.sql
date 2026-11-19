-- Invites into closed worlds. A closed world (the friends-and-family playtest)
-- only takes new players who arrive with an invite: the links players share
-- ("Invite someone to settle nearby", Share on a hex) carry one. An invite
-- lasts 30 days and can be used by anyone it's sent to.

create table if not exists public.world_invites (
  token      text primary key,
  world      text not null references public.worlds(seed) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.world_invites enable row level security; -- no policies: only through the functions below

-- This player's invite for the world (reused while it's fresh).
create or replace function public.world_invite(p_world text) returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_member(p_world) then raise exception 'Only players in this world can invite people to it'; end if;
  select token into tok from world_invites
  where world = p_world and created_by = auth.uid() and created_at > now() - interval '20 days'
  order by created_at desc limit 1;
  if tok is null then
    tok := encode(extensions.gen_random_bytes(12), 'hex');
    insert into world_invites (token, world) values (tok, p_world);
  end if;
  return tok;
end $$;
revoke all on function public.world_invite(text) from public, anon;
grant execute on function public.world_invite(text) to authenticated;

-- joining: the first person to open a world creates it and becomes its admin;
-- a closed world lets in its existing players, and anyone with a fresh invite
drop function if exists public.join_world(text);
create or replace function public.join_world(p_world text, p_invite text default null) returns void
language plpgsql security definer set search_path = public as $$
declare created text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into worlds (seed) values (p_world) on conflict do nothing returning seed into created;
  if created is not null then
    insert into world_admins (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
  elsif exists (select 1 from worlds where seed = p_world and closed)
        and not exists (select 1 from world_members where world = p_world and user_id = auth.uid())
        and not exists (select 1 from world_invites where token = p_invite and world = p_world and created_at > now() - interval '30 days') then
    raise exception 'WORLD_CLOSED: this world is not taking new players';
  end if;
  insert into world_members (world, user_id) values (p_world, auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.join_world(text, text) from public, anon;
grant execute on function public.join_world(text, text) to authenticated;
