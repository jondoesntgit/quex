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

## Checks before committing
`npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run`, `npx oxlint src`, `npm run build`.
Browser flows: `e2e/*.mjs` (Playwright; pass `APP_URL` and, if needed, `CHROME_PATH`).
