-- Habit goals (water tracker): setting a target ('habitGoal') and logging
-- progress ('drink') are habit changes, so for a supervised player they come
-- from their guardians, like ticking habits.
drop policy if exists "write own events" on public.events;
create policy "write own events" on public.events for insert to authenticated with check (
  user_id = auth.uid()
  and public.is_member(world)
  and (
    (kind = 'join' and not exists (select 1 from player_owners o where o.world = events.world and o.player_id = events.player_id))
    or (public.is_owner(world, player_id)
        and (kind not in ('progress', 'habit', 'habitAdd', 'habitRemove', 'habitGoal', 'drink', 'freeze') or not public.is_supervised(world, player_id)))
    or (public.is_guardian(world, player_id)
        and kind in ('progress', 'habit', 'habitAdd', 'habitRemove', 'habitGoal', 'drink', 'freeze', 'rename'))
  )
);
