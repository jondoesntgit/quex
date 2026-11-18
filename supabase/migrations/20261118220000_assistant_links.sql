-- AI assistant links (QUEX-33): a player can connect Claude, ChatGPT or another
-- MCP client to their account through a secret link. The `quex-mcp` Edge
-- Function passes the link's token to the mcp_* functions below, which act as
-- that user with the same rules as the app:
--  * read task names and done/half/not-done for yourself and the children you
--    look after (can_read_tasks);
--  * write task names where you could in the app (can_write_tasks): your own
--    unless a parent sets them, and your wards';
--  * never tick tasks off, take actions or touch the village.
-- Only a hash of each token is stored. Links can be revoked from Account.

create table if not exists public.assistant_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  label        text not null default 'AI assistant' check (char_length(label) between 1 and 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table public.assistant_links enable row level security;
create policy "own assistant links" on public.assistant_links for select to authenticated using (user_id = auth.uid());

create or replace function public.create_assistant_link(p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in with your email first';
  end if;
  if (select count(*) from assistant_links where user_id = auth.uid() and revoked_at is null) >= 10 then
    raise exception 'You already have 10 assistant links: remove one first';
  end if;
  tok := 'qx_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into assistant_links (user_id, token_hash, label)
  values (auth.uid(), encode(extensions.digest(tok, 'sha256'), 'hex'), coalesce(nullif(left(trim(p_label), 40), ''), 'AI assistant'));
  return tok;
end $$;

create or replace function public.revoke_assistant_link(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update assistant_links set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null
$$;
revoke all on function public.create_assistant_link(text) from public, anon;
revoke all on function public.revoke_assistant_link(uuid) from public, anon;
grant execute on function public.create_assistant_link(text) to authenticated;
grant execute on function public.revoke_assistant_link(uuid) to authenticated;

-- ---------------------------------------------------------------- internals

-- Who does this token belong to? Also makes auth.uid() return that user for
-- the rest of the call, so the app's own helpers and triggers apply.
create or replace function public.mcp_auth(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  update assistant_links set last_used_at = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null
  returning user_id into uid;
  if uid is null then raise exception 'This Quex link is not valid any more: make a new one under Account in Quex'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  return uid;
end $$;

-- A player's name, day settings and today's date, from the event log.
create or replace function public.mcp_player(p_world text, p_player text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  j jsonb; nm text; rh int; tz int; alive boolean; today date;
begin
  select body into j from events where world = p_world and player_id = p_player and kind = 'join' order by at desc, seq desc limit 1;
  if j is null then return null; end if;
  select coalesce((select body ->> 'name' from events where world = p_world and player_id = p_player and kind in ('join', 'rename') order by at desc, seq desc limit 1), j ->> 'name') into nm;
  rh := coalesce((select (body ->> 'hour')::int from events where world = p_world and player_id = p_player and kind = 'resetHour' order by at desc, seq desc limit 1), (j ->> 'resetHour')::int, 4);
  tz := coalesce(round((j ->> 'tz')::numeric)::int, 0);
  alive := coalesce((select kind = 'join' from events where world = p_world and player_id = p_player and kind in ('join', 'abandon') order by at desc, seq desc limit 1), false);
  today := ((now() at time zone 'UTC') + make_interval(mins => tz) - make_interval(hours => rh))::date;
  return jsonb_build_object('id', p_player, 'world', p_world, 'name', nm, 'today', today, 'has_village', alive);
end $$;

-- Everyone this user can plan for: their own players and the children they look after.
create or replace function public.mcp_people_for(uid uuid) returns table (world text, player_id text, relation text)
language sql stable security definer set search_path = public as $$
  select o.world, o.player_id, 'you' from player_owners o where o.user_id = uid
  union
  select g.world, g.player_id, 'child you look after' from player_guardians g where g.guardian_id = uid
$$;

-- Find a player by id or (case-insensitive) name among the people this user can plan for.
create or replace function public.mcp_resolve(uid uuid, p_player text) returns table (world text, player_id text)
language plpgsql stable security definer set search_path = public as $$
declare hits text[][]; mine text[][]; q text := lower(trim(coalesce(p_player, '')));
begin
  select coalesce(array_agg(array[p.world, p.player_id]), '{}'),
         coalesce(array_agg(array[p.world, p.player_id]) filter (where p.relation = 'you'), '{}')
  into hits, mine
  from public.mcp_people_for(uid) p
  where public.mcp_player(p.world, p.player_id) is not null
    and (q = '' or p.player_id = trim(p_player) or lower(public.mcp_player(p.world, p.player_id) ->> 'name') = q);
  -- with no name given, the user's own player wins
  if q = '' and coalesce(array_length(mine, 1), 0) >= 1 then hits := mine; end if;
  if coalesce(array_length(hits, 1), 0) = 0 then
    raise exception 'No player called "%" that you can plan for. Use quex_people to see who you can.', coalesce(p_player, '');
  end if;
  if array_length(hits, 1) > 1 then
    raise exception 'More than one player matches "%": use their id from quex_people.', coalesce(p_player, '');
  end if;
  return query select hits[1][1], hits[1][2];
end $$;

-- ---------------------------------------------------------------- the tools

create or replace function public.mcp_people(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.mcp_auth(p_token);
begin
  return coalesce((
    select jsonb_agg(public.mcp_player(p.world, p.player_id) || jsonb_build_object(
      'relation', p.relation,
      'set_by_parent', public.is_supervised(p.world, p.player_id),
      'you_can_edit_tasks', public.can_write_tasks(p.player_id)) order by p.relation desc, p.player_id)
    from public.mcp_people_for(uid) p
    where public.mcp_player(p.world, p.player_id) is not null
  ), '[]'::jsonb);
end $$;

create or replace function public.mcp_tasks(p_token text, p_player text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.mcp_auth(p_token);
  w text; pid text; info jsonb; today date; d date; days jsonb := '[]'::jsonb;
  sizes text[] := array['big', 'medium', 'medium', 'small', 'small', 'small'];
begin
  select r.world, r.player_id into w, pid from public.mcp_resolve(uid, p_player) r;
  if not public.can_read_tasks(pid) then raise exception 'You can''t see this player''s tasks'; end if;
  info := public.mcp_player(w, pid);
  today := (info ->> 'today')::date;
  p_from := greatest(coalesce(p_from, today), today - 60);
  p_to := least(coalesce(p_to, p_from), today + 30, p_from + 30);
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  d := p_from;
  while d <= p_to loop
    days := days || jsonb_build_object(
      'date', d,
      'weekday', trim(to_char(d, 'Day')),
      'when', case when d = today then 'today' when d < today then 'past' else 'planned' end,
      'frozen', exists (select 1 from events e where e.world = w and e.player_id = pid and e.kind = 'freeze' and e.body ->> 'date' = d::text),
      'tasks', (select jsonb_agg(jsonb_build_object(
          'slot', s - 1,
          'size', sizes[s],
          'task', coalesce((select l.text from task_labels l where l.player_id = pid and l.date = d and l.slot = s - 1), ''),
          'status', coalesce((select case e.body ->> 'status' when 'full' then 'done' when 'half' then 'half done' else 'not done' end
                              from events e where e.world = w and e.player_id = pid and e.kind = 'progress'
                                and e.body ->> 'date' = d::text and (e.body ->> 'slot')::int = s - 1
                              order by e.at desc, e.seq desc limit 1), 'not done')
        ) order by s) from generate_series(1, 6) s));
    d := d + 1;
  end loop;
  return info || jsonb_build_object('you_can_edit_tasks', public.can_write_tasks(pid), 'set_by_parent', public.is_supervised(w, pid), 'days', days);
end $$;

-- p_tasks: [{ "slot": 0-5, "task": "text" }]; an empty task clears that slot.
create or replace function public.mcp_set_tasks(p_token text, p_player text, p_date date, p_tasks jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.mcp_auth(p_token);
  w text; pid text; info jsonb; today date; t jsonb; k int; txt text; n int := 0;
begin
  select r.world, r.player_id into w, pid from public.mcp_resolve(uid, p_player) r;
  info := public.mcp_player(w, pid);
  if not public.can_write_tasks(pid) then
    if public.is_supervised(w, pid) then
      raise exception '%''s tasks are set by their parent or guardian, so they can''t be changed from this account', info ->> 'name';
    end if;
    raise exception 'You can''t change this player''s tasks';
  end if;
  today := (info ->> 'today')::date;
  if p_date is null then p_date := today; end if;
  if p_date < today - 1 or p_date > today + 14 then
    raise exception 'Tasks can be set from yesterday (%) up to two weeks ahead (%)', today - 1, today + 14;
  end if;
  if jsonb_typeof(p_tasks) <> 'array' then raise exception 'tasks must be a list'; end if;
  for t in select * from jsonb_array_elements(p_tasks) loop
    k := (t ->> 'slot')::int;
    txt := left(trim(coalesce(t ->> 'task', '')), 200);
    if k is null or k < 0 or k > 5 then raise exception 'slot must be 0 (big), 1-2 (medium) or 3-5 (small)'; end if;
    insert into task_labels (player_id, date, slot, text) values (pid, p_date, k, txt)
    on conflict (player_id, date, slot) do update set text = excluded.text;
    n := n + 1;
  end loop;
  return jsonb_build_object('saved', n, 'player', info ->> 'name', 'date', p_date);
end $$;

revoke all on function public.mcp_auth(text) from public, anon, authenticated;
revoke all on function public.mcp_player(text, text) from public, anon, authenticated;
revoke all on function public.mcp_people_for(uuid) from public, anon, authenticated;
revoke all on function public.mcp_resolve(uuid, text) from public, anon, authenticated;
-- the Edge Function calls these with the public key; the token is the credential
revoke all on function public.mcp_people(text) from public;
revoke all on function public.mcp_tasks(text, text, date, date) from public;
revoke all on function public.mcp_set_tasks(text, text, date, jsonb) from public;
grant execute on function public.mcp_people(text) to anon, authenticated;
grant execute on function public.mcp_tasks(text, text, date, date) to anon, authenticated;
grant execute on function public.mcp_set_tasks(text, text, date, jsonb) to anon, authenticated;
revoke all on public.assistant_links from anon;
