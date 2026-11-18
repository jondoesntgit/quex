import { ImageSource, Rectangle, Texture } from 'pixi.js'

export interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number }
export interface AtlasMeta {
  size: number; face: number; tier: number; maxTier: number; variants: number
  /** fingerprint of atlas.png, so the image and this frame list always match */
  hash?: string
  frames: Record<string, Frame>
}

export interface Atlas {
  meta: AtlasMeta
  tex: (name: string) => { texture: Texture; frame: Frame } | null
}

/** Tile size used by the game. 64 px is the smallest size where a goblin
 *  (shorter than an oak, per the art rules) stays recognisable. */
export const TILE_SIZE = Number(import.meta.env.VITE_TILE_SIZE ?? 64)

/** Load an image with a plain <img>, the most compatible path on iOS Safari. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`couldn't load ${url}`))
    img.src = url
  })
}

/** Does the image really hold tile pixels? Draw one known tile to a scratch
 *  canvas and look. (A phone once got an undrawable copy of the atlas and
 *  showed a blank map, so we check rather than trust.) */
function looksRight(img: HTMLImageElement, f: Frame | undefined): boolean {
  if (!img.naturalWidth || !img.naturalHeight) return false
  if (!f) return true
  try {
    const c = document.createElement('canvas')
    c.width = f.w
    c.height = f.h
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return true
    g.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
    const d = g.getImageData(0, 0, f.w, f.h).data
    let solid = 0
    const colours = new Set<number>()
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200) { solid++; colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
    }
    // a grass tile is mostly opaque and has a handful of colours
    return solid > (f.w * f.h) / 4 && colours.size >= 3
  } catch {
    return true // can't read back (privacy protections): assume it's fine
  }
}

const RETRY_KEY = 'quex:atlas-retry'

export async function loadAtlas(size = TILE_SIZE): Promise<Atlas> {
  const base = `${import.meta.env.BASE_URL}art/${size}/`
  const meta: AtlasMeta = await (await fetch(base + 'atlas.json', { cache: 'no-cache' })).json()
  const probe = meta.frames['t_grass_0']
  // versioned by the image's fingerprint: a stale cached image can't pair with new frames
  const png = `${base}atlas.png${meta.hash ? `?v=${meta.hash}` : `?t=${Date.now()}`}`
  let img = await loadImage(png).catch(() => null)
  if (!img || !looksRight(img, probe)) {
    // try a fresh copy, past every cache (service worker and browser)
    console.warn('tile image looked wrong; fetching a fresh copy')
    img = await loadImage(`${base}atlas.png?fresh=${Date.now()}`).catch(() => null)
  }
  if (!img || !looksRight(img, probe)) {
    // last resort: drop the offline cache entirely and start over once
    let tried = false
    try { tried = sessionStorage.getItem(RETRY_KEY) === '1'; sessionStorage.setItem(RETRY_KEY, '1') } catch { /* ignore */ }
    if (!tried && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k)
      location.reload()
      await new Promise(() => {}) // wait for the reload
    }
    throw new Error("Couldn't load the map's tile images on this device. Please reload, and if it keeps happening, tell us your phone model and iOS version.")
  }
  try { sessionStorage.removeItem(RETRY_KEY) } catch { /* ignore */ }

  // Plain nearest-neighbour sampling, no mipmaps: the simplest texture setup.
  const source = new ImageSource({ resource: img, scaleMode: 'nearest' })
  const cache = new Map<string, { texture: Texture; frame: Frame }>()
  return {
    meta,
    tex(name) {
      const hit = cache.get(name)
      if (hit) return hit
      const f = meta.frames[name]
      if (!f) return null
      const t = new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) })
      const v = { texture: t, frame: f }
      cache.set(name, v)
      return v
    },
  }
}
