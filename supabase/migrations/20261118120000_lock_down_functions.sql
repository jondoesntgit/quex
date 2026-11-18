-- Tighten who can call the SECURITY DEFINER helpers over the REST API.
-- Postgres grants EXECUTE to PUBLIC on new functions, and Supabase also grants
-- it to anon/authenticated by default; revoke that and grant back only what the
-- app needs. (Anonymous sign-ins use the `authenticated` role, not `anon`.)

-- Trigger function: never meant to be called directly. EXECUTE is only checked
-- when the trigger is created, so revoking it doesn't stop the trigger firing.
revoke all on function public.claim_player() from public, anon, authenticated;

-- Used inside RLS policies, which run as the caller, so signed-in users keep it.
revoke all on function public.is_member(text) from public, anon;
grant execute on function public.is_member(text) to authenticated;

-- Signed-in players join worlds; it already refuses callers without a uid.
revoke all on function public.join_world(text) from public, anon;
grant execute on function public.join_world(text) to authenticated;
