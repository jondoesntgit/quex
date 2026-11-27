# Backward compatibility: what to clean up after the playtest season

Everything in the code that exists only so that **old worlds, old events or old saved data** keep working.
When a playtest season ends and its worlds are retired (or reset), work down this list and delete what is no
longer needed. **Add a line here whenever you add a shim**: a `…_FROM` cutoff, a one-time conversion, a
fallback for a field that older saves lack, a renamed id kept for old data, or a display-time fix for old text.

Why the shims exist: the game server (`quex-act`) holds each online world's state and applies the rules as they
are now, so a rule change takes effect from deploy without a cutoff. But the offline build (`LocalStore`)
replays a local log of every event from the start, `seed()` in `src/server/act.ts` can rebuild a world from its
events, and saved state carries whatever shape it had. The cutoffs and conversions keep those replays and old
saves giving players the villages they had.

Cleanup rule of thumb: once no world, offline log or save from before a cutoff can be loaded any more, delete
the cutoff and keep only the "after" branch; delete one-time conversions and their `GameState` flags; make
optional fields required (with a default in `newGame` / `join`); delete the display-time rewrites.

## Rule cutoffs (`…_FROM`): events before them follow the old rule

| Constant | Where | Since | What the old rule was |
| --- | --- | --- | --- |
| `WEEKLY_TOKENS_FROM` | reducer.ts | 2026-11-18 | half-done tokens spendable alone; tokens expired after a day |
| `KEEP_TOKENS_FROM` | reducer.ts | 2026-11-21 | unspent tokens cleared each Saturday night |
| `SABBATH_FROM` | reducer.ts | 2026-11-21 | Saturday had tasks and counted like any day |
| `LATE_TICKS_FROM` | reducer.ts | 2026-11-19 | yesterday's tasks couldn't be ticked after its night |
| `BRIDGES_FROM` | reducer.ts | 2026-11-19 | a road over a river took a small task |
| `TREES_FROM` | reducer.ts | 2026-11-19 | felling cleared the whole hex; saplings became forest in 3 days |
| `DEPLETION_FROM` (and `PURSE_FROM`) | deposits.ts | 2026-11-22 | deposits and game never ran out; no merchant purse |
| `ROLELESS_FROM` (`onRole`) | reducer.ts | 2026-11-22 | village roles: other roles' buildings cost double, own made +25% |
| `CITY_FROM` | reducer.ts | 2026-11-22 | people counted in households of 5 (`HEADS`), no cities |
| `CHEESE_FROM` | reducer.ts | 2026-11-23 | cheese and salt in old units (`CHEESE_RATIONS`, `SALT_PER_OLD`) |
| `STARTER_FROM` | reducer.ts | 2026-11-23 | the square was three town houses on one hex |
| `FOOD_FROM` | reducer.ts | 2026-11-24 | old food rules; new villages started with less grain and no field |
| `EXACT_SIZE_FROM` | reducer.ts | 2026-11-26 | a bigger action could pay for a smaller task |
| `EAT_FRESH_FROM` (`eatFoodOld`) | reducer.ts | 2026-11-27 | each food in turn gave a third of the meal (fresh first), then they filled up, so preserved food went while fresh food spoiled |
| `SQUARE_FROM` | reducer.ts (`join`, `starterFor(…, corner)`) | 2026-11-27 | a new village's well stood on its own hex, homes one to a hex, hexes on any level |
| `RAIDS_FROM` | reducer.ts | 2026-11-27 | one village's `expedition` took on a lair; troops sent home were home at once (no walk, no `homeward` goods) and stayed till their food ran out; lairs raided villages in spring too; a night raid took a fifth of one good (from it, orcs and goblins come in force and every able adult turns out: `nightRaid`); troops carried raw metal and leather (`OLD_GEAR`), from it soldiers' kit (`GEAR` = `KIT`). A detachment that left before it keeps its old gear (it doesn't count in a fight, and goes home with them). From it, camps grow stronger day by day (`grewOn`) and night raids grow more frequent week by week; a workshop built from it waits for an order (`order: ''`), while one built before carries on with its first recipe (outfitters, which had no recipes before, are set to wait in `warnOfOrcs`) |

## One-time conversions and grants (run on the first event after their cutoff; flag on `GameState`)

| Function | Flag | What it does |
| --- | --- | --- |
| `givePurses` | `purses` | every village gets a merchant purse |
| `convertToCities` | `headsScaled` | ×`HEADS` people, crews, troops, jobs; gives each village a city |
| `convertCheese` | `cheeseRations` | cheese and salt into rations and pinches |
| `placeStarters` | `startersPlaced` | lays the square out across the city's cobbles |
| `foodUpdate` | `foodUpdate` | up to 100 loads of grain and a field; Arrivals note (kind `food`) |
| `giveWells` | `wellsGiven` | a well for every pen, dairy and stable without water |
| `giveStaff` | `staffGiven` | people (and a House) for villages short of workers |
| `warnOfOrcs` | `orcWarning` | the orc warning note (Arrivals kind `orcs`) to every village, and each one's nearest orc camp revealed |
| `moveWells` | `wellsMoved` | moves each 3+ hex square's well to the corner (levelling the odd hex, `levelled`), lays its homes out again, turns finished granaries into barns and neighbouring Houses into cobbles and cottages |

All of them are called at the top of `apply()`. Arrivals.tsx has the matching one-off notes (`update`, `food`).

## Fields older saves may lack (read with a fallback)

- `Player.joined` (missing for early players): `dueTicks` in `src/server/act.ts` leaves a never-ticked player without it to their own app.
- `Player.taskStreak` (2026-11-25): unset is 0.
- `Village.foundedAt` (2026-11-25): `foundedAt()` reads the founding line from the log instead.
- `Village.greeted`, `Village.city`, `Village.paved`, `Village.homes`, `Village.tools` and similar: `?? []`.
- `Village.starter.square` (2026-11-27): unset means the old square (well on the village hex, no open ground kept round it).
- `GameState.levelled` (2026-11-27): unset means no hex was levelled.
- `GameState.roadWork` (2026-11-27): unset in older worlds; `digRoads` fills it once from each team's `Village.roadDone`
  (the part-dug hex it was on). `roadDone` is now just a copy of the shared work on the team's next hex.
- `Building.sown`: unset counts as fully sown (fields built before sowing existed).
- `DayRecord.slots`: `dayScore` treats it as empty if missing (some test fixtures, very old days).

## Kept ids and buildings

- Ore ids `copper_ore`, `iron_ore`, `silver_ore` stand for malachite, hematite and galena (the ids predate the minerals).
- `BuildingDef.legacy` (the House): not offered any more except to a village with no room for a city; old ones still stand.
- The Granary is `legacy` too since 2026-11-27 (the Barn, on the cobbles, replaced it): old ones that didn't fit as barns still stand and store food.
- `Village.role` and `ROLE_TOWN` names ("Mine", "Trading Post"...) from when villages had roles.

- Wool deposits were taken out of every world on 2026-11-27 (stripped at the end of `generateWorld`, so nothing else moves).
  An old offline log's hand-gathering of wool from one is now ignored; `Resource` still lists `'wool'`.

## Display-time fixes for old saved text

- `OLD_LINES` in `src/ui/Panels.tsx` (`logLine`): log lines saved before 2026-11-26 said "A dirt road was laid."
  and didn't name who; they're reworded on show ("Abigail laid a dirt road."). Anything else old gets "Name: " in front.

## Client storage keys

- `quex:state:v2:<world>` (the cached server state) and `quex:outbox:v1:<world>` (unsent actions) in
  `src/app/supabase.ts`; the offline build's `META_KEY` / `EVENTS_KEY` in `src/app/store.ts`. Bumping a
  version strands the old key: clear it or migrate it when you do.
