-- Private task names: readable and writable only by their owner, so they can
-- follow a player across devices without ever reaching neighbours or the
-- shared event log (which still rejects any 'label' field).
create table if not exists public.task_labels (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  player_id  text not null,
  date       date not null,
  slot       smallint not null check (slot between 0 and 9),
  text       text not null default '' check (char_length(text) <= 200),
  updated_at timestamptz not null default now(),
  primary key (user_id, player_id, date, slot)
);

alter table public.task_labels enable row level security;

create policy "own task labels" on public.task_labels
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.task_labels from anon;
