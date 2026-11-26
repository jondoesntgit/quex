# Quex — notes for Claude

## Getting changes live (important)
The live site is **quex.jamwheeler.com**, a **Cloudflare Pages** project named `quex`
(direct upload, *not* Git-connected). DNS is on AWS Route 53, so a Workers custom
domain isn't an option. Pushing to GitHub does **not** update the site.

To ship:
1. Commit and `git push origin main`.
2. Wait for GitHub Actions CI to pass: `gh run watch`. Its `migrate` job applies any new
   `supabase/migrations/*.sql` to the live database, so this must finish before deploying
   code that depends on a migration.
3. `npm run deploy`, which runs `scripts/deploy.sh` and then
   `wrangler pages deploy dist --project-name quex --branch main`. The script refuses to
   run with uncommitted changes or if HEAD isn't `origin/main`.
4. Check: `curl -s https://quex.jamwheeler.com/ | grep -o '<title>[^<]*'`, or
   `npx wrangler pages deployment list --project-name quex`.

Build settings for production are in `.env.production`: the site URL, the Supabase URL and
the publishable key. They're public by design. `.env.local` (gitignored) holds the same
Supabase values for `npm run dev`. To develop or run e2e tests **offline**, without writing
to the live database, start Vite with `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite`.

A Worker also named `quex` is connected to the repo and builds on every push. It has no
custom domain and is not the live site. Ignore its "Workers Builds" check.

## Database
Supabase project `snzgotquolwdbdnmbdov`. Schema changes go in a new file under
`supabase/migrations/` and are applied on push to main, both by CI (`supabase db push --yes`)
and by the Supabase GitHub integration (the "Supabase Preview" check). Whichever runs first
applies them and the other finds nothing to do. Don't hand-edit the live schema. Check with
the Supabase MCP `list_migrations`.

The `migrate` CI job also deploys the Edge Functions:
- `quex-act`, **the game server**. It holds each world's state in `world_state` and is the
  only writer of `events`: clients send actions to it, and it stamps the time, checks them with
  the same reducer (`src/server/act.ts`, bundled to `supabase/functions/quex-act/game.js` by
  `npm run build:functions`, which CI runs first), and saves the event and the new state in one
  transaction (`commit_event`). pg_cron calls it hourly (`op: 'tick'`) for the nightly work.
  Clients load the state, apply realtime events on top (`events.n` counts them per world) and
  reload it if one is missed. Rule changes therefore take effect from deploy: no more
  `…_FROM` cutoffs are needed for online worlds. The offline build (LocalStore) still
  replays a local log.
- `quex-mcp`, the MCP endpoint for AI assistants (`verify_jwt = false`; it authenticates with
  its own link tokens through the `mcp_*` SQL functions).

Worlds: `quex-season-1` is the friends-and-family playtest (public to view, `closed` to new
players); `quex-sandbox` is open to anyone and is the default for people without a village in
the family world. See `src/app/worlds.ts`.

## Checks before committing
`npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run`, `npx oxlint src`, `npm run build`.
Browser flows: `e2e/*.mjs` (Playwright; pass `APP_URL` and, if needed, `CHROME_PATH`).

## Backward compatibility (keep BACKCOMPAT.md up to date)
Old worlds, offline event logs and saved state must keep working through the playtest, so the code carries
shims: `…_FROM` rule cutoffs, one-time conversions in `apply()`, fallbacks for fields older saves lack, kept ids,
and display-time rewrites of old log text. **Every time you add one, add a line to `BACKCOMPAT.md`.**
At the end of a playtest season, once its worlds are retired or reset, use that file as the checklist for a
codebase cleanup: delete each shim and keep only the current rule.
