-- The hourly job also sends 'roads' events, so villages' road teams dig while nobody is playing.
create or replace function public.may_act(p_world text, p_user uuid, p_player text, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then p_kind in ('tick', 'roads')
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
