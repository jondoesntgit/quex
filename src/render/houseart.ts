/** The Blender-rendered houses (cottages, town houses, well, church, ...): one sheet, loaded next to
 *  the tile atlas. Made by tools/blender/render_houses.py and packed by tools/pack_houses.py into
 *  public/art/houses. Every sprite is 64x96 with its ground point at (32, 80), like the atlas's
 *  features, so it's placed the same way.
 *
 *  The sheet is a nicety: if it can't be loaded the game keeps drawing the old village and
 *  houses, so a failure here is never fatal. */
import { ImageSource, Rectangle, Texture } from 'pixi.js'

export interface HouseArt {
  /** the sprite for a key (e.g. 't_tile_y_0', 'c_M_thatch_x_1', 'well'), or null if the sheet lacks it */
  tex: (key: string) => Texture | null
  /** where the ground point sits in a sprite (px from its top left) */
  anchor: { x: number; y: number; w: number; h: number }
}

interface Sheet { w: number; h: number; ax: number; ay: number; hash?: string; frames: Record<string, [number, number]> }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`couldn't load ${url}`))
    img.src = url
  })
}

export async function loadHouseArt(): Promise<HouseArt> {
  const base = `${import.meta.env.BASE_URL}art/houses/`
  const sheet: Sheet = await (await fetch(`${base}houses.json`, { cache: 'no-cache' })).json()
  // versioned by the image's fingerprint, like the tile atlas
  const img = await loadImage(`${base}houses.png${sheet.hash ? `?v=${sheet.hash}` : ''}`)
  const source = new ImageSource({ resource: img, scaleMode: 'nearest' })
  const cache = new Map<string, Texture>()
  return {
    anchor: { x: sheet.ax, y: sheet.ay, w: sheet.w, h: sheet.h },
    tex(key) {
      const hit = cache.get(key)
      if (hit) return hit
      const f = sheet.frames[key]
      if (!f) return null
      const t = new Texture({ source, frame: new Rectangle(f[0], f[1], sheet.w, sheet.h) })
      cache.set(key, t)
      return t
    },
  }
}
