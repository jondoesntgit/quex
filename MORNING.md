# Good morning, Jonathan ☕

This is what was built overnight and what's left for you, most important first. About 20 minutes in total.

## 0. Play it locally (2 min)

```bash
cd ~/Documents/old-nextcloud/Nextcloud/hexgrid/quex
npm install
npm run dev
```

Open the URL, found a village, tick off a couple of tasks, then tap a hex next to your village and spend the action. In the **Party** tab, **+ Local friend** adds a hot-seat second player and **Skip to tomorrow** runs the nightly tick.

## 1. GitHub (5 min)

The `gh` CLI isn't installed, so I couldn't create the repo. Either run `brew install gh && gh auth login`, or use the web UI:

```bash
gh repo create quex --public --source . --push      # or create it on github.com, then:
# git remote add origin git@github.com:<you>/quex.git && git push -u origin main
```

Licences are in place: `LICENSE` is AGPL-3.0 for code, `LICENSE-ART.txt` is CC BY-SA 4.0 for art, and `NOTICE` reserves the name and logo. CI (`.github/workflows/ci.yml`) runs the tests and the build on every push.

> **Check first:** PixelLab's terms (https://pixellab.ai/termsofservice). I assumed your subscription lets you redistribute generated sprites and icons under CC BY-SA, but I haven't verified that. The affected files are `art/pixellab/` and `public/icons/`.

## 2. Hosting (5 min): Cloudflare Pages recommended (Netlify also works)

Cloudflare Pages: **Workers & Pages → Create → Pages → Connect to Git**, then pick the repo.
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `NODE_VERSION=22`

Netlify works with zero config (`netlify.toml` is included). Either way you get a static site; the game is fully playable there before Supabase exists, but each browser has its own world.

## 3. Supabase: shared world for you, your wife and your brother (8 min)

1. Create a project at supabase.com.
2. **SQL Editor** → paste and run `supabase/migrations/20261118000000_quex_events.sql`.
3. **Authentication → Sign In / Providers** → enable **Anonymous sign-ins**.
4. **Project Settings → API**: copy the URL and the *anon* key.
5. Add them as environment variables in Cloudflare/Netlify (and in `.env.local` for dev; see `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. Redeploy. Everyone who opens the site joins the same world (`quex-season-1`). For a separate world, add `?seed=something` to the URL on first visit.

The anon key is meant to be public; row-level security does the protecting. Only members can read a world's events, you can only write events for players you own, and events can never be updated or deleted.

## 4. iPhone via Capacitor (10 min, needs Xcode)

Only the Command Line Tools are installed here, so I couldn't compile. The iOS project is generated in `ios/` and uses Swift Package Manager, so CocoaPods isn't needed.

```bash
# install Xcode from the App Store first, then:
sudo xcode-select -s /Applications/Xcode.app
npm run ios            # build, sync, open Xcode
```

In Xcode, set **Signing & Capabilities → Team** to your Apple ID and run it on your phone.

## What's in the box

- **World:** a seeded 128×128 hex world, made of 4×4 regions of 32×32 hexes. It has six elevation tiers, rivers that only ever flow downhill to the sea, biomes, and resources (copper, iron and stone in the mountains; clay on riverbanks; fish in the shallows; tin only on the frontier; no gold). The starter region always has sites for 4–6 complementary roles. Lairs get more dangerous with distance. Everything outside the starter region is fogged until scouted.
- **Rules:** your Bookstacks design, implemented and covered by 23 tests:
  - 1-2-3 scoring with half credit, and tokens sized to the task (a half task gives a half-built result)
  - eight actions and 33 buildings from the build ladders; other roles' buildings cost double
  - the nightly tick: production scales with your score, food variety affects morale, fresh food spoils, granaries matter
  - weekday seasons with a Saturday winter (no production, eat your stores) and a Friday winter forecast
  - habit slots: 7 perfect days unlocks the next one, up to 13, and a miss never removes a slot
  - weekly freezes, visible to neighbours
  - caravans with travel time; gifts raise the receiver's morale
  - expeditions that use bronze, iron, leather and food; monsters scale to nearby players and raid cheekily
- **Art:** 64 px hex tiles from Blender, with continuous-colour tops and the true-scale creature rules. Monsters and the 32 UI icons come from PixelLab, which used 70 generations; about 295 are left until the 1 Dec reset. Comparison sheets are in `art/preview_*.png`.

## Known gaps (next steps, roughly in order)

1. **Multiplayer ordering:** events that arrive out of order trigger a full in-order replay (fine at playtest scale). Two events with identical timestamps keep arrival order; a `seq` tiebreak would make that airtight.
2. **Ticks need the player's own device:** a village only ticks when its owner opens the app, and missed days are caught up then. Later, a Supabase cron could tick idle players.
3. Not built yet:
   - the season reset after 13 weeks and legacy perks
   - NPC trade (port, oasis, mountain pass)
   - roads' effect on caravans
   - unit movement on the map
   - Vikunja/Todoist sync
4. **Balance is untested.** Production numbers live in `src/game/data.ts`; expect to tune them after a week of play.
5. **The JS bundle is about 540 kB,** mostly Pixi. It's fine for now; code-split later.
