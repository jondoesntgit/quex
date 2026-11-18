import { Assets, loadTextures, Rectangle, Texture } from 'pixi.js'

export interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number }
export interface AtlasMeta { size: number; face: number; tier: number; maxTier: number; variants: number; frames: Record<string, Frame> }

export interface Atlas {
  meta: AtlasMeta
  tex: (name: string) => { texture: Texture; frame: Frame } | null
}

/** Tile size used by the game. 64 px is the smallest size where a goblin
 *  (shorter than an oak, per the art rules) stays recognisable. */
export const TILE_SIZE = Number(import.meta.env.VITE_TILE_SIZE ?? 64)

// Decode images with a plain <img> on the main thread instead of
// createImageBitmap in a worker: the most compatible path on iOS Safari.
if (loadTextures.config) {
  loadTextures.config.preferWorkers = false
  loadTextures.config.preferCreateImageBitmap = false
}

export async function loadAtlas(size = TILE_SIZE): Promise<Atlas> {
  const base = `${import.meta.env.BASE_URL}art/${size}/`
  const meta: AtlasMeta = await (await fetch(base + 'atlas.json')).json()
  const sheet: Texture = await Assets.load(base + 'atlas.png')
  // Plain nearest-neighbour sampling, no mipmaps: the simplest texture setup,
  // which every phone GPU handles (mipmapped sampling left iPhones with blank
  // white tiles). Zoomed-out overviews shimmer a little more; that's fine.
  sheet.source.scaleMode = 'nearest'
  const cache = new Map<string, { texture: Texture; frame: Frame }>()
  return {
    meta,
    tex(name) {
      const hit = cache.get(name)
      if (hit) return hit
      const f = meta.frames[name]
      if (!f) return null
      const t = new Texture({ source: sheet.source, frame: new Rectangle(f.x, f.y, f.w, f.h) })
      const v = { texture: t, frame: f }
      cache.set(name, v)
      return v
    },
  }
}
