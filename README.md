# Quex

**Quex** (quest + hex) is a cosy co-op strategy game on a hex map, powered by your real-life tasks.

Each evening you pick six tasks for tomorrow using the **1-2-3 method**: 1 big (30 pts), 2 medium (20 pts), 3 small (10 pts). Each task you finish (or make any progress on) earns one action for your village. A small task scouts or gathers, a medium one builds or sends a caravan, and a big one founds an outpost or launches an expedition. Then you put the phone down and get back to life.

Friends play neighbouring villages that each specialise (port, farm, mines, forest, herding, explorer), so you depend on each other. The world is dangerous but cheeky: goblins, orcs, trolls and dragons scale to your group, and nobody fights each other.

Design notes live in the Quex book on the BookStack wiki.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # world generator + game rules
npm run build        # static site in dist/
```

The game runs entirely offline by default (state lives in `localStorage`). The **Party** tab has **+ Local friend** (hot-seat co-op on one device) and **Skip to tomorrow** (runs the nightly tick), so you can playtest before any backend exists.

## How it works

| Piece | Where | Notes |
|---|---|---|
| World generator | `src/world/` | Seeded and deterministic. 4×4 regions of 32×32 hexes; elevation tiers, rivers, biomes, resources, a starter region with complementary village sites, and monster lairs whose danger rises with distance. |
| Game rules | `src/game/` | **Event-sourced**: state = world seed + ordered event log, replayed through a pure reducer (`reducer.ts`). All randomness is seeded from event ids, so every client agrees. |
| Renderer | `src/render/MapView.ts` | PixiJS draws at *art* resolution and CSS-upscales with `image-rendering: pixelated`, so zoom is always a clean integer and pixels stay chunky. |
| UI | `src/ui/`, `src/App.tsx` | React. Mobile-first bottom sheet, with a side panel on desktop. |
| Sync | `src/app/store.ts`, `src/app/supabase.ts` | `LocalStore` by default; `SupabaseStore` (one shared append-only event table, realtime) when env vars are set. |
| Mobile | `ios/`, `capacitor.config.ts` | Capacitor wraps `dist/` for iOS. |

### Privacy

Task **text** is private to you. It lives on the device and, when signed in, in a `task_labels` table that only your own account can read (row-level security), so it follows you between devices. It is never in the shared event log: events carry only task sizes and none/half/full status, so neighbours see *whether* you did your tasks, never *what* they were. The database also rejects any event containing a `label` field.

## Art pipeline

- **Terrain, trees and buildings** are rendered headless in Blender from primitives: `tools/blender/render_tiles.py` + `tools/blender/palette.json` → `tools/post_tiles.py` (palette snap, rim, texture, atlas packing). Rebuild everything with `npm run art`.
- **Monsters and units** come from PixelLab, sized to true scale for 64 px tiles (`art/pixellab/`, with their PixelLab ids).
- **UI icons** come from PixelLab (`public/icons/`).
- **Scale rules** (one hex is 2 units wide): goblins shorter than trees, trolls slightly taller, dragons fit inside one hex. These rules are why tiles are **64 px**.

## Licences

- **Code:** [GNU AGPL-3.0-or-later](LICENSE). If you run a modified Quex as a network service, you must offer your users its source.
- **Art and written design** (`public/art`, `public/icons`, `art/`, `tools/blender/palette.json`): [CC BY-SA 4.0](LICENSE-ART.txt).
- The name "Quex" and the logo are not covered by these licences (see [NOTICE](NOTICE)).
