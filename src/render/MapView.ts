/** Pixi map renderer.
 *
 *  Chunky pixels: the canvas is rendered at *art* resolution (1 canvas px =
 *  1 sprite px) and upscaled by CSS with `image-rendering: pixelated`, so
 *  every zoom level >= 1 is a clean integer scale and nothing is smoothed.
 *  Below 1 (overview zooms) the canvas is screen-sized and the scene is
 *  scaled down instead, so the whole continent fits on screen.
 *
 *  Painter's order: rows top to bottom, even columns before odd ones (odd
 *  columns sit half a hex lower). Each hex draws terrain column, river,
 *  then whatever stands on it, so nearer hexes correctly cover farther ones.
 */
import { Application, Container, CullerPlugin, extensions, Graphics, Sprite } from 'pixi.js'
import { Ambient } from './ambient'
import { Mountains } from './mountains'
import { Flock } from './flock'
import { Herd } from './herd'
import { mulberry32 } from '../world/rng'
import { extend, riverLayout, roadLayout } from './waterways'
import { drawBridge } from './bridge'
import { hexToPixel, neighbours, pixelToHex } from '../world/hex'
import type { World } from '../world/types'
import type { BuildingId } from '../game/data'
import type { GameState } from '../game/types'
import { clayAt, clayRenews, landAt, territoryCells } from '../game/reducer'
import { weekSeason } from '../game/calendar'
import { strongholdsOf } from '../game/strongholds'
import { isDeposit, MOUNTAIN_TERRAIN } from '../world/land'
import { leftAt } from '../game/deposits'
import { drawRocks, poisson, spots, type RockKind } from './rocks'
import { drawCottages } from './cottages'
import { drawCobbles } from './cobbles'
import type { HouseArt } from './houseart'
import { houseSpots, villageSpots, type Spot } from './townlayout'
import { dims as homeDims, hexAt } from '../game/city'
import { People } from './people'
import { Traders } from './traders'
import type { Atlas } from './atlas'

export interface SceneInput {
  world: World
  state: GameState
  viewer: string | null
  selected: { col: number; row: number } | null
  highlight?: number[] // cells to tint (e.g. valid targets)
  blocked?: number[] // cells that can't be settled (too close to a neighbour): dimmed, gently pulsing
  /** a hex someone sent a link to: marked in pink */
  focus?: number
  /** lift the fog (choosing where to found a village) */
  showAll?: boolean
  /** a guest: no player, but sees only what the world's players have explored */
  guest?: boolean
  /** prospecting: dim everything except deposits worth mining or gathering */
  prospect?: boolean
  today: string
}

const BUILDING_SPRITE: Partial<Record<BuildingId, string>> = {
  garden: 'f_farm', field: 'f_farm', irrigation: 'f_farm', orchard: 'f_oak3', mill: 'f_hut',
  shore_fishery: 'f_dock', docks: 'f_dock', shipyard: 'f_dock', salt_pans: 'f_farm', smokehouse: 'f_hut',
  quarry: 'f_mine', copper_mine: 'f_mine', iron_mine: 'f_mine', kiln: 'f_hut', smelter: 'f_hut', bloomery: 'f_hut', bronze_foundry: 'f_hut',
  lumber_camp: 'f_hut', forager_camp: 'f_hut', hunting_lodge: 'f_hut', charcoal_kiln: 'f_hut', sawmill: 'f_hut',
  pen: 'f_hut', dairy: 'f_hut', weaver: 'f_hut', scout_camp: 'f_hut', outfitter: 'f_hut',
  house: 'f_cottages', granary: 'f_hut', palisade: 'f_hut', chapel: 'f_hut', library: 'f_hut', market: 'f_village',
}
/** How far a building's front wall stands in front of its centre (ground px). */
const homeDepth = (key: string) => { try { return homeDims(key)[1] } catch { return 0 } }
const MONSTER_SPRITE = { goblins: 'f_goblins', orcs: 'f_orcs', trolls: 'f_troll', dragon: 'f_dragon' } as const

/** 3x5 pixel digits, for the road planner's priority numbers. */
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}
/** A little brown badge with a priority number, centred on (cx, cy). */
function badge(g: Graphics, cx: number, cy: number, n: number) {
  const txt = String(n)
  const w = txt.length * 4 - 1
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - 3)
  g.rect(x0 - 2, y0 - 2, w + 4, 9).fill({ color: 0x141424 })
  g.rect(x0 - 1, y0 - 1, w + 2, 7).fill({ color: 0xe8b860 })
  ;[...txt].forEach((ch, k) => {
    DIGITS[ch].forEach((row, ry) => {
      for (let c = 0; c < 3; c++) if (row[c] === '1') g.rect(x0 + k * 4 + c, y0 + ry, 1, 1).fill({ color: 0x141424 })
    })
  })
}

export class MapView {
  app = new Application()
  root = new Container()
  cells = new Container()
  overlay = new Container()
  /** the white outline on the tapped hex: redrawn alone, so a tap doesn't rebuild the scene */
  private selection = new Graphics()
  private sceneKey: unknown[] | null = null
  /** each laid-out city's layer (buildings and villagers sorted by how far forward they stand), by village */
  private townLayers = new Map<string, Container>()
  private revealedNow: Set<number> = new Set()
  people!: People
  traders!: Traders
  /** sheep and shepherds at the pens */
  flock!: Flock
  /** deer on hexes rich in game */
  herd!: Herd
  /** surf, glints, swaying trees, shimmering fields */
  ambient!: Ambient
  /** mountain ranges drawn from one height map (cached per world) */
  private mountains: Mountains | null = null
  zoom = typeof window !== "undefined" && window.innerWidth < 700 ? 1 : 2
  /** CSS upscale of the canvas (zoom >= 1) */
  private get cssScale() { return Math.max(1, this.zoom) }
  /** scene scale inside the canvas (zoom < 1) */
  private get sceneScale() { return Math.min(1, this.zoom) }
  camX = 0
  camY = 0
  private host!: HTMLElement
  private ro?: ResizeObserver
  private last: SceneInput | null = null
  /** a tap: the hex, and where on the map's plane (px, unlifted) it landed */
  onSelect: (col: number, row: number, x?: number, y?: number) => void = () => {}

  atlas: Atlas
  /** the Blender houses (villages and House buildings); without them the older drawings are used */
  houses: HouseArt | null
  constructor(atlas: Atlas, houses: HouseArt | null = null) {
    this.atlas = atlas
    this.houses = houses
    this.people = new People(atlas.meta.size, atlas.meta.tier)
    this.traders = new Traders(atlas)
    this.flock = new Flock(atlas.meta.size, atlas.meta.tier)
    this.herd = new Herd(atlas.meta.size, atlas.meta.tier)
  }

  get W() { return this.atlas.meta.size }

  /** Buildings on a hex from the house sheet: soft shadows, then each sprite with its ground point at
   *  its spot (back to front). One container, so the whole group sorts as one thing in the hex. */
  private stand(spots: Spot[], cx: number, cy: number, alpha: number, dim: boolean, zIndex: number) {
    const art = this.houses
    if (!art) return
    const group = new Container()
    const shadows = new Graphics()
    const sprites: Sprite[] = []
    for (const sp of [...spots].sort((a, b) => a.y - b.y)) {
      const t = art.tex(sp.key)
      if (!t) continue
      const s = new Sprite(t)
      s.anchor.set(art.anchor.x / art.anchor.w, art.anchor.y / art.anchor.h)
      s.x = Math.round(cx + sp.x)
      s.y = Math.round(cy + sp.y)
      const half = sp.key === 'well' ? 4 : sp.key[0] === 't' ? 10 : 12
      shadows.ellipse(s.x + 2, s.y + 1, half, 2.5).fill({ color: 0x28281e, alpha: 0.25 })
      sprites.push(s)
    }
    group.addChild(shadows, ...sprites)
    group.alpha = alpha
    group.cullable = true
    if (dim) group.tint = DIM
    group.zIndex = zIndex
    this.cells.addChild(group)
  }

  async mount(host: HTMLElement) {
    this.host = host
    // villagers live inside `cells` so they sort into the painter's order with trees and houses
    this.cells.sortableChildren = true
    this.root.addChild(this.cells, this.overlay, this.selection)
    await this.startRenderer()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    document.addEventListener('visibilitychange', this.onVisible)
  }

  /** Create the Pixi app and canvas. Also used to rebuild after the GPU context
   *  is lost (laptop sleep, graphics switch) and the browser doesn't give it
   *  back: the scene and the tile images are still in memory, so no network. */
  private async startRenderer(): Promise<void> {
    // WebGL by default (its context loss/restore is the best supported path);
    // ?renderer=canvas|webgl|webgpu overrides, and a failed texture check
    // below falls back to the canvas renderer.
    await this.app.init({ width: 10, height: 10, antialias: false, background: '#141424', resolution: 1, roundPixels: true, preference: this.preference })
    if (this.preference !== 'canvas' && !this.texturesWork()) {
      console.warn(`Tiles render blank with ${this.preference}: switching to the canvas renderer`)
      this.app.destroy({ removeView: true }, { children: false, texture: false, textureSource: false })
      this.app = new Application()
      this.preference = 'canvas'
      return this.startRenderer()
    }
    const c = this.app.canvas
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.imageRendering = 'pixelated'
    c.style.touchAction = 'none'
    c.style.display = 'block'
    this.host.appendChild(c)
    c.addEventListener('webglcontextlost', () => {
      // Pixi asks for the context back; if the browser doesn't return it soon, rebuild
      clearTimeout(this.lostTimer)
      this.lostTimer = setTimeout(() => { if (this.contextLost()) void this.rebuild() }, 1500)
    })
    c.addEventListener('webglcontextrestored', () => clearTimeout(this.lostTimer))
    this.app.ticker.add((t) => {
      if (this.unsettlable.length) {
        const k = (1 - Math.cos((performance.now() / 1000) * (2 * Math.PI / UNSETTLABLE.period))) / 2
        const a = UNSETTLABLE.lo + (UNSETTLABLE.hi - UNSETTLABLE.lo) * k
        for (const g of this.unsettlable) g.alpha = a
      }
      this.people.update(Math.min(0.1, t.deltaMS / 1000))
      this.traders.update(Date.now())
      this.flock.update(Math.min(0.1, t.deltaMS / 1000))
      // deer only move where the camera is looking (scene px; the scene shrinks below zoom 1)
      if (this.host) {
        const k = this.zoom
        this.herd.update(Math.min(0.1, t.deltaMS / 1000), [this.camX, this.camY, this.camX + this.host.clientWidth / k, this.camY + this.host.clientHeight / k])
      }
      // new animated pieces came into view: draw them once now (see settle)
      if (this.stepAmbient()) this.app.render()
    })
    this.app.stage.addChild(this.root)
    this.resize()
    this.bindInput()
  }

  /** Renderer to try first (see startRenderer). iPhones and iPads use the
   *  canvas renderer: WebGL texturing has drawn blank or solid tiles there. */
  preference: 'webgl' | 'webgpu' | 'canvas' = (() => {
    const r = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('renderer') : null
    if (r === 'canvas' || r === 'webgpu' || r === 'webgl') return r
    return isIOS() ? 'canvas' : 'webgl'
  })()

  /** Draw one grass tile off-screen and read it back: some phone GPUs leave
   *  textures blank (flat white quads). A real tile has many colours. */
  private texturesWork(): boolean {
    const t = this.atlas.tex('t_grass_0')
    if (!t) return true
    try {
      const s = new Sprite(t.texture)
      const { pixels } = this.app.renderer.extract.pixels({ target: s })
      s.destroy()
      const seen = new Set<number>()
      for (let i = 0; i < pixels.length; i += 4 * 7) if (pixels[i + 3] > 200) seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
      return seen.size >= 3
    } catch (e) {
      console.warn('texture check failed', e)
      return true // can't tell: keep the renderer we have
    }
  }

  /** Keep the animated pieces around the camera and move them; true if it had to build new ones. */
  private stepAmbient(): boolean {
    if (!this.ambient || !this.host) return false
    const z = this.zoom
    const built = this.ambient.view(this.cells, this.camX, this.camY, this.camX + this.host.clientWidth / z, this.camY + this.host.clientHeight / z, this.sceneScale)
    this.ambient.update(performance.now() / 1000, this.sceneScale)
    return built
  }

  /** Draw a freshly rebuilt scene before the browser shows it. Pixi leaves Graphics made since the
   *  last frame out of the first frame that meets them (cobbles, borders, rocks, roads), so a
   *  rebuild flashed for one frame without them. Rendering twice here means only the second,
   *  complete picture ever reaches the screen. */
  private settle() {
    if (!this.app?.renderer) return
    this.stepAmbient()
    this.app.render()
    this.app.render()
  }

  private lostTimer?: ReturnType<typeof setTimeout>
  private rebuilding = false
  /** shades over land too close to a neighbour, while choosing where to settle */
  private unsettlable: Graphics[] = []

  private contextLost(): boolean {
    const gl = (this.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl
    return !!gl && gl.isContextLost()
  }

  /** Coming back to the tab (e.g. opening the laptop): make sure the map can draw. */
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.contextLost()) void this.rebuild()
  }

  private async rebuild() {
    if (this.rebuilding) return
    this.rebuilding = true
    try {
      this.app.stage.removeChild(this.root)
      // drop the dead renderer but keep our scene, textures and tile images
      this.app.destroy({ removeView: true }, { children: false, texture: false, textureSource: false })
      this.app = new Application()
      await this.startRenderer()
      if (this.last) this.render(this.last)
    } finally {
      this.rebuilding = false
    }
  }

  destroy() {
    this.ro?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisible)
    clearTimeout(this.lostTimer)
    this.app.destroy(true, { children: true })
  }

  resize() {
    const w = Math.max(1, Math.ceil(this.host.clientWidth / this.cssScale))
    const h = Math.max(1, Math.ceil(this.host.clientHeight / this.cssScale))
    this.app.renderer.resize(w, h)
    this.applyCamera()
  }

  /** step through ZOOMS: +1 in, -1 out */
  zoomStep(dir: number, anchor?: { x: number; y: number }) {
    const k = ZOOMS.indexOf(this.zoom)
    this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, k + dir))], anchor)
  }

  setZoom(z: number, anchor?: { x: number; y: number }) {
    // snap to the nearest level (in log space, so pinches feel even)
    const nz = ZOOMS.reduce((best, l) => (Math.abs(Math.log(l / z)) < Math.abs(Math.log(best / z)) ? l : best))
    if (nz === this.zoom) return
    // keep the art pixel under the anchor (CSS px) fixed
    const ax = anchor?.x ?? this.host.clientWidth / 2
    const ay = anchor?.y ?? this.host.clientHeight / 2
    const wx = this.camX + ax / this.zoom
    const wy = this.camY + ay / this.zoom
    this.zoom = nz
    this.camX = wx - ax / nz
    this.camY = wy - ay / nz
    this.resize()
  }

  /** yFrac: where on screen the hex should land (0 = top). Phones keep it
   *  above the bottom sheet. */
  centreOn(col: number, row: number, tier = 0, yFrac = this.host.clientWidth < 900 ? 0.27 : 0.5) {
    const p = hexToPixel(col, row, this.W)
    this.camX = p.x - this.host.clientWidth / this.zoom / 2
    this.camY = p.y - tier * this.atlas.meta.tier - (this.host.clientHeight / this.zoom) * yFrac
    this.applyCamera()
  }

  private applyCamera() {
    const s = this.sceneScale
    this.root.scale.set(s)
    this.root.x = -Math.round(this.camX * s)
    this.root.y = -Math.round(this.camY * s)
  }

  // ---------------------------------------------------------------- scene

  private drawSelection(input: SceneInput) {
    const g = this.selection
    g.clear()
    if (!input.selected) return
    const { col, row } = input.selected
    const { world } = input
    const i = row * world.width + col
    const cell = world.cells[i]
    if (!cell) return
    const p = hexToPixel(col, row, this.W)
    const tier = this.revealedNow.has(i) ? cell.tier : 0
    const cs = hexCorners(p.x, p.y - tier * this.atlas.meta.tier, this.W)
    g.poly(cs.flat(), true).stroke({ width: 2, color: 0xffffff })
  }

  render(input: SceneInput) {
    // only the selection changed (a tap): move the outline, keep the scene as it is
    const key = [input.world, input.state, input.state.version, input.viewer, input.focus, input.showAll, input.guest, input.prospect, input.today, input.highlight?.join(','), input.blocked]
    const same = this.sceneKey && key.every((k, n) => k === this.sceneKey![n])
    this.last = input
    if (same) { this.drawSelection(input); return }
    this.sceneKey = key
    const { world, state, viewer } = input
    const { tier: TP } = this.atlas.meta
    const W = this.W
    const walkers = new Set<unknown>([...this.people.nodes(), ...this.traders.nodes(), ...this.flock.nodes(), ...this.herd.nodes()])
    // villagers walking in a city live in its town layer: take them out before the layer goes
    for (const layer of this.townLayers.values()) for (const c of [...layer.children]) if (walkers.has(c)) layer.removeChild(c)
    this.townLayers.clear()
    for (const c of this.cells.removeChildren()) if (!walkers.has(c)) c.destroy({ children: true })
    this.ambient ??= new Ambient(W)
    if (!this.mountains || (this.mountains as unknown as { world: World }).world !== world) this.mountains = new Mountains(world, W, TP)
    this.ambient.reset()
    // choosing a site shows the whole world at once: keep that screen still (and quick)
    const animate = !input.showAll
    this.overlay.removeChildren().forEach((c) => c.destroy())
    this.unsettlable = []

    const revealed = visibleSet(input)
    this.revealedNow = revealed
    // draw box: revealed bounds + margin of fog
    let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity
    for (const i of revealed) {
      const c = i % world.width, r = Math.floor(i / world.width)
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r)
    }
    const M = 4
    c0 = Math.max(0, c0 - M); r0 = Math.max(0, r0 - M)
    c1 = Math.min(world.width - 1, c1 + M); r1 = Math.min(world.height - 1, r1 + M)

    // lookup tables for things standing on hexes
    const things = new Map<number, { name: string; alpha?: number }>()
    const idx = (c: number, r: number) => r * world.width + c
    for (const l of state.lairs) if (!l.cleared) things.set(idx(l.col, l.row), { name: MONSTER_SPRITE[l.kind] })
    for (const v of Object.values(state.villages)) {
      for (const b of v.buildings) things.set(idx(b.col, b.row), { name: BUILDING_SPRITE[b.type] ?? 'f_hut', alpha: b.progress < 1 ? 0.55 : 1 })
      for (const o of v.outposts) things.set(idx(o.col, o.row), { name: 'f_hut' })
      things.set(idx(v.col, v.row), { name: this.houses ? 'f_townhouses' : 'f_village' })
    }

    // cobbled hexes: every village's city (its square, and every hex laid with cobblestone since), and
    // the homes built on them, by the hex each stands in
    const cobbled = new Set<number>()
    const homesByHex = new Map<number, Spot[]>()
    /** cities laid out in the city (well and homes on the cobbles): everything standing there, by village */
    const towns: { vid: string; hexes: number[]; spots: { key: string; x: number; y: number; front: number; hex: number }[] }[] = []
    /** villages whose square is laid out across the city: no fixed picture on the village hex */
    const squareLaidOut = new Set<number>()
    for (const v of Object.values(state.villages)) {
      cobbled.add(idx(v.col, v.row))
      if (v.starter) squareLaidOut.add(idx(v.col, v.row))
      for (const c of v.city ?? []) cobbled.add(c)
      const vp = hexToPixel(v.col, v.row, W)
      // the square's well, when it's laid out in the city (and not the fixed picture)
      const spots = [...(v.homes ?? []).map((h) => ({ key: h.key + (h.side === 'back' && /^[cht]_/.test(h.key) ? '_b' : ''), x: h.x, y: h.y, base: h.key })), ...(v.starter ? [{ key: 'well', x: v.starter.x, y: v.starter.y, base: 'well' }] : [])]
      if (v.starter) {
        // drawn together, each by how far forward it stands, with the villagers walking among them
        const town = { vid: v.id, hexes: [idx(v.col, v.row), ...(v.city ?? [])], spots: [] as { key: string; x: number; y: number; front: number; hex: number }[] }
        for (const h of spots) {
          const hi = hexAt(world, v, [h.x, h.y])
          if (hi < 0) continue
          town.spots.push({ key: h.key, x: vp.x + h.x, y: vp.y + h.y * 0.5774, front: vp.y + (h.y + (homeDepth(h.base))) * 0.5774, hex: hi })
        }
        towns.push(town)
        continue
      }
      for (const h of spots) {
        const hi = hexAt(world, v, [h.x, h.y])
        if (hi < 0) continue
        const hp = hexToPixel(world.cells[hi].col, world.cells[hi].row, W)
        // ground point -> screen: x as is, y squashed by the view; relative to the hex it stands in
        const spot: Spot = { key: h.key, x: vp.x + h.x - hp.x, y: vp.y + h.y * 0.5774 - hp.y }
        homesByHex.set(hi, [...(homesByHex.get(hi) ?? []), spot])
      }
    }

    const order: number[] = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0 + (c0 & 1 ? 1 : 0); c <= c1; c += 2) order.push(idx(c, r))
      for (let c = c0 + (c0 & 1 ? 0 : 1); c <= c1; c += 2) order.push(idx(c, r))
    }
    // draw rank of each hex: everything on a hex sorts as rank*4 + layer
    // (0 terrain column, 1 road/river, 3 features); villagers slot in at 2 or 3.5
    const rank = new Int32Array(world.cells.length).fill(-1)
    order.forEach((i, k) => { rank[i] = k })
    const z = (i: number, layer: number) => rank[i] * 4 + layer
    const hl = new Set(input.highlight ?? [])
    const blocked = new Set(input.blocked ?? [])
    // roads join each other and the places they lead to
    const roadSet = new Set<number>()
    const pavedSet = new Set<number>()
    const hubs = new Set<number>()
    for (const v of Object.values(state.villages)) {
      for (const r of v.roads) if (revealed.has(r)) roadSet.add(r)
      for (const r of v.paved ?? []) pavedSet.add(r)
      hubs.add(idx(v.col, v.row))
      for (const o of v.outposts) hubs.add(idx(o.col, o.row))
      for (const b of v.buildings) hubs.add(idx(b.col, b.row))
      // a city's cobbles are paved: roads run into them from any side
      for (const c of v.city ?? []) hubs.add(c)
    }
    // development only (?roadtest): roads on every river hex and a scatter of their
    // neighbours, so every kind of crossing and bridge can be reviewed at once
    if (import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('roadtest')) {
      for (const i of revealed) {
        const c = world.cells[i]
        if (c.riverTo === -1 || c.tier === 0) continue
        roadSet.add(i)
        neighbours(c.col, c.row).forEach(([nc, nr], k) => {
          const j = idx(nc, nr)
          if (nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && world.cells[j].tier > 0 && (i * 7 + k * 3) % 5 < 2) roadSet.add(j)
        })
      }
    }

    const forts = new Map(strongholdsOf(world).map((f) => [f.i, f]))
    for (const i of order) {
      const cell = world.cells[i]
      const known = revealed.has(i)
      const p = hexToPixel(cell.col, cell.row, W)
      const tier = known ? cell.tier : 0
      const cx = p.x, cy = p.y - tier * TP
      const land = known ? landAt(world, state, i, input.today) : null
      const deposit = !!land && isDeposit(land.resource, land.feature)
      const dim = !!input.prospect && known && !deposit
      const terrainName = land ? `t_${land.terrain}_${(cell.col * 7 + cell.row * 13) % 3}` : `t_deep_${(cell.col + cell.row) % 3}`
      const t = this.atlas.tex(terrainName)
      if (t) {
        const s = new Sprite(t.texture)
        s.cullable = true
        s.x = cx - t.frame.ax
        s.y = cy - t.frame.ay
        if (!known) s.tint = 0x3a3a58
        else if (hl.has(i)) s.tint = 0xfff0a0
        else if (dim) s.tint = DIM
        s.zIndex = z(i, 0)
        this.cells.addChild(s)
      }
      if (!known) continue
      // cobblestone: just short of the hex's edge, running on into cobbled neighbours (down a ramp if they are lower)
      if (cobbled.has(i)) {
        const nbs = neighbours(cell.col, cell.row).map(([nc, nr]) => (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height ? -1 : idx(nc, nr)))
        const joined = nbs.map((ni) => ni >= 0 && cobbled.has(ni))
        // a cobbled neighbour that is lower: the cobbles run down the cliff between, as a ramp
        const drops = nbs.map((ni) => (ni >= 0 && cobbled.has(ni) ? Math.max(0, cell.tier - world.cells[ni].tier) * this.atlas.meta.tier : 0))
        const cb = new Graphics()
        drawCobbles(cb, cx, cy, W, joined, drops)
        cb.cullable = true
        if (dim) cb.tint = DIM
        cb.zIndex = z(i, 1.5)
        this.cells.addChild(cb)
        // homes standing on this hex (placed in the city, see game/city.ts)
        const homes = this.houses ? homesByHex.get(i) : undefined
        if (homes) this.stand(homes, cx, cy, 1, dim, z(i, 3.2))
      }
      // land too close to a neighbour to settle: a shade over the hex and what stands on it, breathing slowly
      if (blocked.has(i) && cell.tier > 0) {
        // the top of the hex and its cliff face below, down to the ground
        const [r, br, bl, l, tl, tr] = hexCorners(cx, cy, W)
        const d = cell.tier * TP + this.atlas.meta.face
        const shade = new Graphics().poly([r, [r[0], r[1] + d], [br[0], br[1] + d], [bl[0], bl[1] + d], [l[0], l[1] + d], l, tl, tr].flat(), true).fill({ color: 0x141424 })
        shade.alpha = UNSETTLABLE.lo
        shade.zIndex = z(i, 3.9)
        this.cells.addChild(shade)
        this.unsettlable.push(shade)
      }
      if (WATER.has(land!.terrain)) {
        // surf where the water meets land, glints out on open water
        const corners = hexCorners(cx, cy, W)
        const edges: [number, number, number, number][] = []
        neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
          if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) return
          const ni = idx(nc, nr)
          if (!revealed.has(ni) || world.cells[ni].tier <= cell.tier) return
          const [a, b] = EDGE_CORNERS[k]
          edges.push([corners[a][0], corners[a][1], corners[b][0], corners[b][1]])
        })
        const deep = land!.terrain !== 'shallow', zw = z(i, 0.4), zs = z(i, 0.5)
        if (animate) this.ambient.add(cx, cy, () => [
          ...this.ambient.water(cx, cy, i, deep, edges.length > 0).map((n) => [n, zw] as [Container, number]),
          ...(edges.length ? this.ambient.shore(cx, cy, edges, i).map((n) => [n, zs] as [Container, number]) : []),
        ])
      } else if ((land!.terrain === 'meadow' || land!.terrain === 'savannah') && !land!.feature && !things.has(i) && ((i * 2654435761) >>> 0) % 3 === 0) {
        const zf = z(i, 0.5)
        if (animate) this.ambient.add(cx, cy, () => [[this.ambient.field(cx, cy, i, 2), zf]])
      }
      if (roadSet.has(i) || (hubs.has(i) && neighbours(cell.col, cell.row).some(([nc, nr]) => roadSet.has(idx(nc, nr)))))
      {
        const { g: rg, bridges } = this.road(world, i, cx, cy, roadSet, hubs, pavedSet.has(i))
        rg.zIndex = z(i, 1)
        this.cells.addChild(rg)
        // bridges go over the river (which is drawn after the road, covering it where they cross)
        if (bridges) { bridges.zIndex = z(i, 1.6); bridges.cullable = true; this.cells.addChild(bridges) }
      }
      if (cell.riverTo !== -1 && cell.tier > 0) {
        this.cells.addChild(this.river(world, i, cx, cy)).zIndex = z(i, 1)
        this.riverLife(world, i, cx, cy, revealed, z)
      }
      const thing = things.get(i)
      // forests, mountains and hills come in three shapes, picked per hex so ranges don't look stamped
      const variant = ((i * 2654435761) >>> 16) % 3
      // hills are the raised ground itself: no mounds drawn on top
      // (development review, ?roadtest&bare: no trees, to see the waterways)
      const bare = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('bare') && !MOUNTAIN_FEATURE.has(land!.feature ?? '')
      // a felled stand: the same trees, with stumps where some were cut
      const base = land!.stumps ? `${land!.feature}_c${land!.stumps}` : land!.feature
      const natural = land!.feature && land!.feature !== 'hills' && !bare && !cobbled.has(i)
        ? (variant && this.atlas.tex(`f_${base}_v${variant}`) ? `f_${base}_v${variant}` : this.atlas.tex(`f_${base}`) ? `f_${base}` : `f_${land!.feature}`)
        : null
      // mines and quarries are dug into the mountain: keep the peak, put the shaft in front
      const dug = thing?.name === 'f_mine' && (land!.feature === 'mountain' || land!.feature === 'mountain_snow' || land!.feature === 'hills')
      const layers: { name: string; alpha: number; dx?: number; dy: number }[] = []
      // an outcrop on open ground says what's in it (on mountains, the ore stains the rock instead)
      const outcrop = deposit && !MOUNTAIN_FEATURE.has(land!.feature ?? '')
      if (outcrop) {
        // the deposit itself is drawn as rocks scattered on the ground (below)
        if (thing) layers.push({ name: dug ? 'f_mine' : thing.name, alpha: thing.alpha ?? 1, dy: 0 })
        else if (natural) layers.push({ name: natural, alpha: 1, dy: 0 })
      }
      else if (dug && natural) layers.push({ name: natural, alpha: 1, dy: 0 }, { name: 'f_mine', alpha: thing!.alpha ?? 1, dy: Math.round(W / 10) })
      else if (dug) layers.push({ name: 'f_mine', alpha: thing!.alpha ?? 1, dy: 0 })
      else if (thing) layers.push({ name: thing.name, alpha: thing.alpha ?? 1, dy: 0 })
      else if (natural) layers.push({ name: natural, alpha: 1, dy: 0 })
      // a warlord's stronghold out in the wastes (a ruin once it has fallen)
      const fort = forts.get(i)
      if (fort) {
        const fg = new Graphics()
        drawKeep(fg, cx, cy, W, !!state.sieges?.[i]?.fallen)
        fg.cullable = true
        if (dim) fg.tint = DIM
        fg.zIndex = z(i, 3.1)
        this.cells.addChild(fg)
      }
      // fresh water dug by the villagers: a pond in an old clay pit (dry in summer), or a well
      // clay dug from ground that doesn't renew: a pit that grows as it's dug, and once dug out its floor is wet
      const clayTaken = state.clayDug?.[i] ?? 0
      const pit = !state.ponds?.[i] && clayTaken > 0 && !clayRenews(world, i) ? Math.min(1, clayTaken / Math.max(1, clayAt(world, i))) : 0
      if (state.wells?.[i] || state.ponds?.[i] || pit > 0) {
        const wg = new Graphics()
        if (state.wells?.[i]) drawWell(wg, cx + Math.round(W * 0.16), cy + Math.round(W * 0.06), W)
        else if (pit > 0 && !state.ponds?.[i]) drawPit(wg, cx - Math.round(W * 0.12), cy + Math.round(W * 0.05), W, pit)
        else drawPond(wg, cx - Math.round(W * 0.12), cy + Math.round(W * 0.05), W, !!input.today && weekSeason(input.today) === 'summer')
        wg.cullable = true
        if (dim) wg.tint = DIM
        wg.zIndex = z(i, 3.05)
        this.cells.addChild(wg)
      }
      // what lies on the ground: an outcrop of the deposit, or loose stone (until it's picked off)
      if (cell.tier > 0 && !MOUNTAIN_FEATURE.has(land!.feature ?? '') && land!.resource !== 'clay') {
        const left = leftAt(world, state, i)
        // how many: a Poisson count whose mean follows how much the hex held at the start; as it's
        // gathered they go one by one (an ore deposit keeps one while a mine could reach more below)
        let kind: RockKind | null = null, n = 0, size = 0.085
        if (outcrop && left) {
          kind = land!.resource as RockKind
          const all = 1 + poisson(i, left.ore === land!.resource ? Math.min(4, left.start / 5) - 1 : 1.5)
          n = left.total <= 0 ? 0 : left.start > 0 ? Math.max(1, Math.round(all * left.surface / left.start)) : all
        } else if (!input.showAll && left && left.ore === 'stone' && left.start > 0 && !MOUNTAIN_TERRAIN.includes(cell.terrain)) {
          kind = 'pebble'
          n = Math.ceil(poisson(i, left.start * 0.45) * left.surface / left.start)
          size = 0.035
        }
        if (kind && n > 0) {
          const roads: [number, number][] = []
          const onRoad = roadSet.has(i)
          neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
            if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) return
            const ni = idx(nc, nr)
            const road = (onRoad && (roadSet.has(ni) || hubs.has(ni))) || (hubs.has(i) && roadSet.has(ni))
            const river = cell.riverTo === ni || world.cells[ni].riverTo === i
            if (!road && !river) return
            const [a, b] = EDGE_CORNERS[k]
            const cs = hexCorners(0, 0, W)
            roads.push([(cs[a][0] + cs[b][0]) / 2, (cs[a][1] + cs[b][1]) / 2])
          })
          const wooded = !!land!.feature && land!.feature !== 'hills' && !thing
          const busy = !!thing || hubs.has(i)
          const at = spots(i, n, W, { busy, roads, wooded }, W * size * 1.7)
          if (at.length) {
            const rg = new Graphics()
            drawRocks(rg, cx, cy, W, kind, at, size, i)
            rg.cullable = true
            if (dim) rg.tint = DIM
            rg.zIndex = z(i, busy || wooded ? 3.1 : 1.8)
            this.cells.addChild(rg)
          }
        }
      }
      // a village square is a well with town houses on its cobbles (drawn above); a House is three cottages (Blender art)
      const townIdx = layers.findIndex((l) => l.name === 'f_townhouses')
      if (townIdx >= 0) {
        const [row] = layers.splice(townIdx, 1)
        if (!squareLaidOut.has(i)) this.stand(villageSpots(i), cx, cy, row.alpha, dim, z(i, 3))
      }
      const cottageIdx = layers.findIndex((l) => l.name === 'f_cottages')
      if (cottageIdx >= 0) {
        const [row] = layers.splice(cottageIdx, 1)
        if (this.houses) this.stand(houseSpots(i), cx + (row.dx ?? 0), cy + row.dy, row.alpha, dim, z(i, 3))
        else {
          // (the sheet didn't load) a row of cottages drawn in code
          const cg = new Graphics()
          drawCottages(cg, cx + (row.dx ?? 0), cy + row.dy, W)
          cg.alpha = row.alpha
          cg.cullable = true
          if (dim) cg.tint = DIM
          cg.zIndex = z(i, 3)
          this.cells.addChild(cg)
        }
      }
      for (const l of layers) {
        if (l.name.startsWith('f_mountain')) {
          // ranges come from the height map, not a sprite
          const m = this.mountains!.slice(i)
          if (m) {
            const s = new Sprite(m.texture)
            s.cullable = true
            s.x = cx + m.ox
            s.y = cy + m.oy
            if (dim) s.tint = DIM
            s.zIndex = z(i, 3)
            this.cells.addChild(s)
          }
          continue
        }
        const f = this.atlas.tex(l.name)
        if (!f) continue
        const s = new Sprite(f.texture)
        s.cullable = true
        // anchored at its foot, so trees can sway from the ground
        s.anchor.set(f.frame.ax / f.frame.w, f.frame.ay / f.frame.h)
        s.x = cx + (l.dx ?? 0)
        s.y = cy + l.dy
        s.alpha = l.alpha
        if (dim) s.tint = DIM
        s.zIndex = z(i, 3)
        this.cells.addChild(s)
        if (l.name === 'f_farm' && l.alpha === 1) {
          const zf = z(i, 3.2)
          if (animate) this.ambient.add(cx, cy, () => [[this.ambient.field(cx, cy, i + 0.5), zf]])
        }
      }
    }

    this.mountains!.flush()

    // Each laid-out city is one layer: its buildings and the villagers walking among them, sorted by how
    // far forward each stands (so villagers pass behind houses as well as in front). The layer sits with
    // the city's front-most hex. Things on the land just in front of the city's further hexes (trees,
    // buildings) would be drawn under it, so they move into the layer too, sorted by their hex's middle.
    for (const t of towns) {
      if (!this.houses) continue
      const known = t.hexes.filter((h) => revealed.has(h) && rank[h] >= 0)
      if (!known.length) continue
      const top = Math.max(...known.map((h) => rank[h]))
      const layer = new Container()
      layer.sortableChildren = true
      layer.zIndex = top * 4 + 3.2
      const shadows = new Graphics()
      shadows.zIndex = -1e9
      layer.addChild(shadows)
      const art = this.houses
      for (const sp of t.spots) {
        const tex = art.tex(sp.key)
        if (!tex) continue
        const lift = world.cells[sp.hex].tier * TP
        const s = new Sprite(tex)
        s.anchor.set(art.anchor.x / art.anchor.w, art.anchor.y / art.anchor.h)
        s.x = Math.round(sp.x)
        s.y = Math.round(sp.y - lift)
        s.zIndex = sp.front
        const half = sp.key === 'well' ? 4 : sp.key[0] === 't' ? 10 : sp.key[0] === 'b' ? 17 : 12
        shadows.ellipse(s.x + 2, s.y + 1, half, 2.5).fill({ color: 0x28281e, alpha: 0.25 })
        layer.addChild(s)
      }
      const city = new Set(t.hexes)
      for (const h of t.hexes) {
        const c = world.cells[h]
        for (const [nc, nr] of neighbours(c.col, c.row)) {
          if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) continue
          const j = idx(nc, nr)
          if (city.has(j) || rank[j] < 0 || rank[j] >= top || rank[j] <= rank[h]) continue
          const lo = rank[j] * 4 + 2.5, hi = rank[j] * 4 + 4, cyj = hexToPixel(nc, nr, W).y
          for (const ch of [...this.cells.children]) {
            if (ch.zIndex < lo || ch.zIndex >= hi || walkers.has(ch)) continue
            this.cells.removeChild(ch)
            ch.zIndex = cyj + (ch.zIndex - lo) * 0.01
            layer.addChild(ch)
          }
        }
      }
      this.cells.addChild(layer)
      this.townLayers.set(t.vid, layer)
    }

    // Territory borders: dashed, Civilization-style, and part of the painter's
    // order. Each border hex draws its outside edges at its own height just
    // above its ground (z = rank*4 + 0.5), so its own trees, mountains and
    // houses, nearer hexes and villagers all cover the line. Where border hexes
    // of different heights meet at a corner, a dashed stroke runs down the
    // cliff corner between them; it sorts with the hex further back, so it
    // shows on a visible cliff face and hides behind a taller hex in front.
    // (not while choosing where to settle: the shaded land says where neighbours are)
    //
    // Where higher land or a mountain in front hides part of a border, a faint copy of
    // that part is drawn over everything, so you can still see where your land runs.
    // (A guess that something hides an edge when it doesn't only lays the faint copy
    // over the line itself, so the test is generous: hex columns plus the tallest peaks.)
    const ghost = new Graphics()
    ghost.alpha = 0.4
    ghost.zIndex = order.length * 4 + 10
    const PEAK = 1.7 * W
    const hidden = (x: number, y: number, behind: number, tier: number) => {
      const c0 = Math.floor((x - W / 2) / (W * 0.75)) - 1
      for (let c = c0; c <= c0 + 3; c++) {
        if (c < 0 || c >= world.width) continue
        const cxj = c * W * 0.75 + W / 2
        if (Math.abs(x - cxj) > W / 2) continue
        // hexes whose ground lies below this point (nearer the viewer), close enough to rise over it
        const r0 = Math.max(0, Math.floor(y / (W / 2)) - 1)
        for (let r = r0; r < Math.min(world.height, r0 + 2 + Math.ceil((6 * TP + PEAK) / (W / 2))); r++) {
          const j = r * world.width + c
          if (rank[j] <= behind || !revealed.has(j)) continue
          const cj = world.cells[j]
          const mtn = cj.feature === 'mountain' || cj.feature === 'mountain_snow'
          if (!mtn && cj.tier <= tier) continue
          const pj = hexToPixel(c, r, W)
          const top = pj.y - cj.tier * TP - W / 4 - (mtn ? PEAK : 0)
          if (y > top && y < pj.y + W / 4) return true
        }
      }
      return false
    }
    /** an edge at this height, sorted at draw rank `behind`: does anything taller in front cover it? */
    const ghostly = (x0: number, y0: number, x1: number, y1: number, behind: number, tier: number) =>
      hidden(x0, y0, behind, tier) || hidden(x1, y1, behind, tier) || hidden((x0 + x1) / 2, (y0 + y1) / 2, behind, tier)
    for (const v of blocked.size ? [] : Object.values(state.villages)) {
      const own = state.players[v.playerId]?.colors?.border
      const color = own ? parseInt(own.slice(1), 16) : v.playerId === viewer ? 0xfff070 : 0xff90c0
      const terr = new Set(territoryCells(world, v))
      const ends = new Map<string, { x: number; y: number; cell: number }[]>() // ground-plane corner -> drawn ends
      for (const i of terr) {
        const cell = world.cells[i]
        if (!revealed.has(i) || rank[i] < 0) continue
        const p = hexToPixel(cell.col, cell.row, W)
        const lift = cell.tier * TP
        const corners = hexCorners(p.x, p.y - lift, W)
        // each edge is its own Graphics, sorted just above the ground of both hexes it lies between:
        // a neighbour drawn later (in front) that is no taller than this hex must not paint over the line.
        // A taller neighbour in front does hide it, as a hill would.
        neighbours(cell.col, cell.row).forEach(([nc, nr], k) => {
          if (nc < 0 || nr < 0 || nc >= world.width || nr >= world.height) return
          const ni = nr * world.width + nc
          if (terr.has(ni)) return
          const [a, b] = EDGE_CORNERS[k]
          const low = rank[ni] >= 0 && world.cells[ni].tier <= cell.tier && revealed.has(ni)
          const eg = new Graphics()
          dashed(eg, corners[a][0], corners[a][1], corners[b][0], corners[b][1], color)
          const sortBy = low && rank[ni] > rank[i] ? ni : i
          eg.zIndex = z(sortBy, 0.5)
          this.cells.addChild(eg)
          if (ghostly(corners[a][0], corners[a][1], corners[b][0], corners[b][1], rank[sortBy], cell.tier)) {
            dashed(ghost, corners[a][0], corners[a][1], corners[b][0], corners[b][1], color)
          }
          for (const c of [corners[a], corners[b]]) {
            const key = `${Math.round(c[0])},${Math.round(c[1] + lift)}`
            const list = ends.get(key)
            const e = { x: c[0], y: c[1], cell: i }
            if (list) list.push(e)
            else ends.set(key, [e])
          }
        })
      }
      for (const list of ends.values()) {
        if (list.length < 2) continue
        const ys = list.map((e) => e.y)
        const top = Math.min(...ys), bottom = Math.max(...ys)
        if (bottom - top < 0.5) continue
        const back = list.reduce((m, e) => (rank[e.cell] < rank[m.cell] ? e : m))
        const cg = new Graphics()
        dashed(cg, list[0].x, top, list[0].x, bottom, color)
        cg.zIndex = z(back.cell, 0.5)
        this.cells.addChild(cg)
        if (ghostly(list[0].x, top, list[0].x, bottom, rank[back.cell], Math.min(...list.map((e) => world.cells[e.cell].tier)))) dashed(ghost, list[0].x, top, list[0].x, bottom, color)
      }
    }
    this.cells.addChild(ghost)
    // selection and highlights stay on top of everything
    const g = new Graphics()
    // highlighted hexes (e.g. the spot chosen for a new village): gold wash + bold outline;
    // a linked hex gets the same treatment in pink
    const marks: [number, number, number][] = [...hl].map((i) => [i, 0xffe040, 0xfff6c0])
    const reviewing = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('roadtest')
    if (input.focus !== undefined && !hl.has(input.focus) && !reviewing) marks.push([input.focus, 0xff60b0, 0xffd0ec])
    for (const [i, wash, rim] of marks) {
      const cell = world.cells[i]
      if (!cell) continue
      const p = hexToPixel(cell.col, cell.row, W)
      const cs = hexCorners(p.x, p.y - (revealed.has(i) ? cell.tier : 0) * TP, W).flat()
      g.poly(cs, true).fill({ color: wash, alpha: 0.45 })
      g.poly(cs, true).stroke({ width: 4, color: 0x141424 })
      g.poly(cs, true).stroke({ width: 2, color: rim })
    }
    this.drawSelection(input)
    // everyone else's road plans, in their own colour (no numbers): where plans line up, the teams dig together
    for (const v of Object.values(state.villages)) {
      if (v.playerId === viewer || !v.roadPlan?.length) continue
      const own = state.players[v.playerId]?.colors?.border
      const color = own ? parseInt(own.slice(1), 16) : 0xff90c0
      for (const i of v.roadPlan) {
        const cell = world.cells[i]
        if (!cell || !revealed.has(i)) continue
        const p = hexToPixel(cell.col, cell.row, W)
        // a little inside the hex, so a hex on two plans shows both
        const cs = hexCorners(p.x, p.y - cell.tier * TP, W * 0.86).flat()
        // dark under the owner's colour, so any colour reads on any ground
        g.poly(cs, true).stroke({ width: 3, color: 0x141424, alpha: 0.55 })
        g.poly(cs, true).stroke({ width: 1, color })
      }
    }
    // the road planner: the viewer's own dirt-road plan, numbered in the order the team will dig it
    const mine = Object.values(state.villages).find((v) => v.playerId === viewer)
    mine?.roadPlan?.forEach((i, k) => {
      const cell = world.cells[i]
      if (!cell || !revealed.has(i)) return
      const p = hexToPixel(cell.col, cell.row, W)
      const cs = hexCorners(p.x, p.y - cell.tier * TP, W).flat()
      g.poly(cs, true).stroke({ width: 1, color: 0xe8b860, alpha: 0.9 })
      // the hex being dug shows its digger instead of a number (the badge would sit on top of them)
      if (k === 0 && (mine.roadCrew ?? 0) > 0) return
      badge(g, p.x, p.y - cell.tier * TP, k + 1)
    })
    // caravans on the road
    const now = Date.now()
    for (const cv of state.caravans) {
      const a = state.villages[cv.from], b = state.villages[cv.to]
      const f = this.atlas.tex('f_caravan')
      if (!a || !b || !f) continue
      const t0 = Date.parse(cv.departAt), t1 = Date.parse(cv.arriveAt)
      const k = Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)))
      const pa = hexToPixel(a.col, a.row, W), pb = hexToPixel(b.col, b.row, W)
      const ta = world.cells[idx(a.col, a.row)].tier, tb = world.cells[idx(b.col, b.row)].tier
      const s = new Sprite(f.texture)
      s.x = Math.round(pa.x + (pb.x - pa.x) * k - f.frame.ax)
      s.y = Math.round(pa.y - ta * TP + (pb.y - tb * TP - pa.y + ta * TP) * k - f.frame.ay)
      this.overlay.addChild(s)
    }
    this.overlay.addChildAt(g, 0)
    this.people.sync(world, state, revealed)
    this.people.attach(this.cells, rank, this.townLayers)
    this.traders.sync(world, state, revealed)
    this.traders.attach(this.cells, rank)
    this.flock.sync(world, state, revealed, (vid) => this.people.shirt(vid))
    this.flock.attach(this.cells, rank)
    // no deer while choosing where to settle (that screen stays still)
    this.herd.sync(world, state, input.showAll ? new Set() : revealed, input.today)
    this.herd.attach(this.cells, rank)
    this.settle()
  }

  /** Dirt track across the hex top toward neighbouring roads/buildings; where it
   *  drops to a lower hex in front, wooden steps run down the visible cliff face. */
  private road(world: World, i: number, cx: number, cy: number, roads: Set<number>, hubs: Set<number>, paved = false): { g: Graphics; bridges: Graphics | null } {
    const W = this.W
    const TP = this.atlas.meta.tier
    const g = new Graphics()
    const L = roadLayout(world, i, cx, cy, W, TP, roads, hubs)
    // a paved road is laid in grey stone; a dirt road is packed earth
    const dirt = paved ? 0xb8b2a2 : 0xc09858, edge = paved ? 0x6c665a : 0x7a5830
    const w = L.width
    if (!L.legs.length) {
      g.ellipse(cx, cy, w + 1, Math.ceil(w / 2) + 1).fill(edge).ellipse(cx, cy, w, Math.ceil(w / 2)).fill(dirt)
      return { g, bridges: null }
    }
    // Each hex draws its half of every road segment, from its middle to the
    // shared edge, with flat (butt) ends: a round cap there would paint its
    // dark rim across the neighbour's dirt. Halves run 2 px past the edge so
    // the next hex's tile outline never shows through the join (that overlap is
    // the same dirt colour). All rims go down first, then all dirt, so no rim
    // ever lands on dirt. The middle gets a round patch so bends look smooth,
    // and a dead end gets a rounded tip.
    const rim = (w + 2) / 2, core = w / 2
    const legs = L.legs.map((leg) => extend(leg, 2, true))
    const { mid, tip } = L
    const paint = (width: number, r: number, color: number) => {
      for (const leg of legs) polyline(g, leg)
      if (tip) g.moveTo(tip[0], tip[1]).lineTo(mid[0], mid[1])
      g.stroke({ width, color, cap: 'butt', join: 'round' })
      // round patches where legs meet (the middle, or each hub on a river hex)
      g.circle(mid[0], mid[1], r).fill(color)
      for (const leg of legs) g.circle(leg[0][0], leg[0][1], r).fill(color)
      if (tip) g.circle(tip[0], tip[1], r).fill(color)
    }
    paint(w + 2, rim, edge)
    paint(w, core, dirt)
    // cobbles: a scatter of darker setts along each leg
    if (paved) for (const leg of legs) {
      for (let k = 1; k < leg.length; k++) {
        const [x0, y0] = leg[k - 1], [x1, y1] = leg[k]
        const steps = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 3)
        for (let t = 0; t < steps; t++) {
          const f = (t + 0.5) / steps
          const off = ((t + k) % 2 ? 1 : -1) * Math.max(0, core - 1.5)
          g.rect(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f + off * 0.5), 1, 1).fill(edge)
        }
      }
    }
    for (const st of L.steps) {
      // wide enough for two walkers shoulder to shoulder (room for a pack animal later)
      const hw = Math.max(6, w + 2)
      g.rect(st.x - hw - 1, st.y0, 2 * hw + 3, st.y1 - st.y0).fill(edge)
      g.rect(st.x - hw, st.y0, 2 * hw + 1, st.y1 - st.y0).fill(dirt)
      for (let y = st.y0 + 1; y < st.y1; y += 2) g.rect(st.x - hw, y, 2 * hw + 1, 1).fill({ color: edge, alpha: 0.45 })
    }
    // bridges where the road crosses the river (planned by roadLayout)
    let bridges: Graphics | null = null
    if (L.bridges.length) {
      bridges = new Graphics()
      for (const br of L.bridges) drawBridge(bridges, br.a, br.b, w)
    }
    return { g, bridges }
  }


  /** A river hex's shape: its width, the edge where it leaves (the lip), and
   *  its legs as curves through a slightly off-centre middle. Each leg runs from
   *  an edge (upstream legs first, then the downstream one from the middle). */
  private riverShape(world: World, i: number, cx: number, cy: number) {
    const R = riverLayout(world, i, cx, cy, this.W, this.atlas.meta.tier)
    // drawn paths run 2 px past each edge so neighbouring hexes overlap (no seam)
    return { ...R, paths: R.flows.map((f) => extend(f, 2, R.spring)) }
  }

  private river(world: World, i: number, cx: number, cy: number): Graphics {
    const { width, paths, spring } = this.riverShape(world, i, cx, cy)
    // Drawn on the ground plane and then foreshortened (half height), so the
    // water and its banks are thinner where the river runs across the screen
    // than where it runs up it, as they would be lying on the ground.
    const g = new Graphics()
    const flat = (pts: [number, number][], dy = 0) => pts.map(([x, y]) => [x, cy + (y - cy) * 2 + dy] as [number, number])
    const cell = world.cells[i]
    // river clay, wherever this hex or a neighbour holds clay
    const clay = cell.resource === 'clay' || neighbours(cell.col, cell.row).some(([nc, nr]) =>
      nc >= 0 && nr >= 0 && nc < world.width && nr < world.height && world.cells[nr * world.width + nc].resource === 'clay')
    const paint = (color: number, w: number, dy = 0, cap: 'butt' | 'round' = 'butt') => {
      for (const path of paths) polyline(g, flat(path, dy))
      g.stroke({ width: w, color, cap, join: 'round' })
      if (spring) { const [sx, sy] = flat(paths[0], dy)[0]; g.circle(sx, sy, w / 2).fill(color) }
    }
    if (clay) {
      // Clay banks: a mottled band of red-brown clay with ochre, rust, grey and
      // dried-pale patches, wet and dark right at the water. Rounded ends, so
      // where the clay country starts or stops it tapers instead of squaring off.
      paint(0xa4684a, width + 2 + 4, 0, 'round')
      const rnd = mulberry32(i * 2654435761)
      const MOTTLE = [0xc08a54, 0x8e4a2e, 0x9a958a, 0xd4ae7c, 0xb06c44]
      for (const path of paths) {
        const pts = flat(path)
        for (let k = 0; k + 1 < pts.length; k++) {
          const [x0, y0] = pts[k], [x1, y1] = pts[k + 1]
          const len = Math.hypot(x1 - x0, y1 - y0) || 1
          const nx = -(y1 - y0) / len, ny = (x1 - x0) / len
          for (let d = 0; d < len; d += 1.6) {
            const t = d / len, side = rnd() < 0.5 ? -1 : 1
            const off = (width / 2 + 1.5 + rnd() * 5) * side
            const x = x0 + (x1 - x0) * t + nx * off, y = y0 + (y1 - y0) * t + ny * off
            g.ellipse(x, y, 1 + rnd() * 1.8, 1 + rnd() * 1.4).fill(MOTTLE[Math.floor(rnd() * MOTTLE.length)])
          }
        }
      }
      paint(0x84503a, width + 3) // wet clay at the water's edge
    } else {
      // an earthy cut where the river has worn into the ground
      paint(0x5c4a34, width + 4)
    }
    // the water sits a little below the ground: shifted down, it leaves the far bank's face showing
    paint(0x2868b8, width + 2, 2)
    paint(0x50a8f0, width, 2)
    g.scale.set(1, 0.5)
    g.y = cy / 2
    return g
  }


  /** Flowing current on a river hex, and a waterfall where it drops off a cliff toward the viewer. */
  private riverLife(world: World, i: number, cx: number, cy: number, revealed: Set<number>, z: (i: number, layer: number) => number) {
    const TP = this.atlas.meta.tier
    const cell = world.cells[i]
    const down = world.cells[cell.riverTo]
    const { width, lip, flows } = this.riverShape(world, i, cx, cy)
    const legs = flows
    const zr = z(i, 1.1)
    const animate = !this.last?.showAll
    if (animate) this.ambient.add(cx, cy, () => legs.flatMap((pts, k) => this.ambient.stream(pts, width, i * 7 + k).map((n) => [n, zr] as [Container, number])))
    // a waterfall shows only on the cliff faces facing us (the hex below is SE, S or SW)
    const drop = cell.tier - down.tier
    const k = neighbours(cell.col, cell.row).findIndex(([nc, nr]) => nr * world.width + nc === cell.riverTo)
    if (drop > 0 && k >= 1 && k <= 3 && revealed.has(cell.riverTo)) {
      // the water column down the cliff (static), then its motion (animated, near the camera only)
      const w = Math.max(2, width), x0 = Math.round(lip[0] - w / 2), y0 = Math.round(lip[1]), h = drop * TP
      const col = new Graphics()
      col.rect(x0 - 1, y0, w + 2, h).fill({ color: 0x2868b8 })
      col.rect(x0, y0, w, h).fill({ color: 0x50a8f0 })
      col.cullable = true
      col.zIndex = z(i, 1.15)
      this.cells.addChild(col)
      const zc = z(i, 1.2), zd = z(cell.riverTo, 1.2)
      if (animate) this.ambient.add(lip[0], lip[1], () => {
        const [col, splash] = this.ambient.fall(lip[0], lip[1], drop * TP, width, i)
        return [...col.map((n) => [n, zc] as [Container, number]), ...splash.map((n) => [n, zd] as [Container, number])]
      })
    }
  }

  // ---------------------------------------------------------------- input

  private pick(cssX: number, cssY: number) {
    const s = this.last
    if (!s) return null
    const x = this.camX + cssX / this.zoom
    const y = this.camY + cssY / this.zoom
    const TP = this.atlas.meta.tier
    const revealed = visibleSet(s)
    let best: { col: number; row: number; depth: number; x: number; y: number } | null = null
    for (let t = 0; t <= this.atlas.meta.maxTier; t++) {
      const h = pixelToHex(x, y + t * TP, this.W)
      if (h.col < 0 || h.row < 0 || h.col >= s.world.width || h.row >= s.world.height) continue
      const i = h.row * s.world.width + h.col
      const tier = revealed.has(i) ? s.world.cells[i].tier : 0
      if (tier !== t) continue
      const depth = h.row * 2 + (h.col & 1)
      if (!best || depth > best.depth) best = { ...h, depth, x, y: y + t * TP }
    }
    return best
  }

  private bindInput() {
    const c = this.app.canvas
    const pts = new Map<number, { x: number; y: number }>()
    let moved = 0
    let pinch0 = 0, zoom0 = this.zoom
    const rel = (e: PointerEvent) => {
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, rel(e))
      moved = 0
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
        zoom0 = this.zoom
      }
    })
    c.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId)
      if (!prev) return
      const p = rel(e)
      pts.set(e.pointerId, p)
      if (pts.size === 1) {
        const dx = p.x - prev.x, dy = p.y - prev.y
        moved += Math.abs(dx) + Math.abs(dy)
        this.camX -= dx / this.zoom
        this.camY -= dy / this.zoom
        this.applyCamera()
      } else if (pts.size === 2 && pinch0 > 0) {
        moved = 99
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        this.setZoom(zoom0 * (d / pinch0), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    })
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch0 = 0
      if (p && moved < 8 && pts.size === 0) {
        const h = this.pick(p.x, p.y)
        if (h) this.onSelect(h.col, h.row, h.x, h.y)
      }
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    // Wheel and trackpad: a Mac trackpad sends dozens of small wheel events per
    // swipe, so collect them and zoom one level per notch-sized amount, at most
    // every 260 ms. Pinch (ctrlKey) gives small deltas, so it needs less.
    let wheelAcc = 0, lastStep = 0
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      const NOTCH = e.ctrlKey ? 30 : 160
      if (Math.sign(px) !== Math.sign(wheelAcc)) wheelAcc = 0
      wheelAcc += px
      const now = performance.now()
      if (Math.abs(wheelAcc) < NOTCH || now - lastStep < 260) return
      const r = c.getBoundingClientRect()
      this.zoomStep(wheelAcc < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top })
      wheelAcc = 0
      lastStep = now
    }, { passive: false })
  }
}

/** Hexes drawn unfogged: everything while choosing a site (or with no
 *  player yet, or a visitor to an empty world), otherwise what any player in the world has seen. */
function visibleSet(s: SceneInput): Set<number> {
  // a visitor to a world nobody has explored yet sees the land waiting to be settled
  if (s.showAll || (!s.viewer && (!s.guest || !s.state.revealed.length))) return new Set(s.world.cells.map((_, i) => i))
  return new Set(s.state.revealed)
}

/** A chunky 2 px dashed line (3 on, 2 off), pixel-snapped, with a dark
 *  1 px shadow under each dash so it reads on light and dark ground. */
function dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 0.5) return
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len
  const ON = 3, OFF = 2
  for (let d = 0; d < len; d += ON + OFF) {
    const e = Math.min(len, d + ON)
    for (let t = d; t < e; t += 1) {
      const x = Math.round(x0 + ux * t), y = Math.round(y0 + uy * t)
      g.rect(x, y + 1, 2, 1).fill({ color: 0x141424, alpha: 0.45 })
      g.rect(x, y, 2, 1).fill(color)
    }
  }
}

// Skip drawing anything off-screen (matters most for the canvas renderer).
extensions.add(CullerPlugin)

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Zoom levels: below 1 shrinks the scene to see the whole continent. */
export const ZOOMS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6]

/** Corners of the projected top face (flat-top hex squashed to W x W/2),
 *  clockwise from the right-hand point. */
const WATER = new Set(['deep', 'ocean', 'shallow'])
const MOUNTAIN_FEATURE = new Set(['mountain', 'mountain_snow'])
const DIM = 0x5c5c70

/** A stronghold: a stone curtain wall with corner towers round a tall keep and a red banner (or broken stumps once fallen). */
function drawKeep(g: Graphics, x: number, y: number, W: number, fallen: boolean) {
  const u = Math.max(1, Math.round(W / 32))
  const stone = 0x8a8478, dark = 0x5a554c, light = 0xb0aa9c
  if (fallen) {
    g.rect(x - 9 * u, y - 3 * u, 4 * u, 3 * u).fill(dark).rect(x + 2 * u, y - 5 * u, 3 * u, 5 * u).fill(stone).rect(x + 6 * u, y - 2 * u, 4 * u, 2 * u).fill(dark)
    return
  }
  g.ellipse(x, y + u, 12 * u, 4 * u).fill({ color: 0x000000, alpha: 0.2 })
  // curtain wall and towers
  g.rect(x - 10 * u, y - 6 * u, 20 * u, 6 * u).fill(stone)
  for (const tx of [-11, 8]) g.rect(x + tx * u, y - 9 * u, 4 * u, 9 * u).fill(dark).rect(x + tx * u, y - 10 * u, u, u).fill(dark).rect(x + (tx + 2) * u, y - 10 * u, u, u).fill(dark)
  // the keep, its gate and banner
  g.rect(x - 4 * u, y - 15 * u, 8 * u, 15 * u).fill(light).rect(x - 4 * u, y - 15 * u, 8 * u, u).fill(dark)
  g.rect(x - u, y - 3 * u, 2 * u, 3 * u).fill(0x2a2018)
  g.rect(x, y - 21 * u, u, 6 * u).fill(0x3a2a1a).rect(x + u, y - 21 * u, 4 * u, 3 * u).fill(0xc0302a)
}

/** A pond: dark water with a reedy rim (or cracked mud when it's dried up). */
function drawPond(g: Graphics, x: number, y: number, W: number, dry: boolean) {
  const rx = Math.round(W * 0.13), ry = Math.round(W * 0.055)
  g.ellipse(x, y, rx + 1, ry + 1).fill(dry ? 0x8a6a48 : 0x5a7a3a)
  g.ellipse(x, y, rx, ry).fill(dry ? 0xa88660 : 0x3f78b0)
  if (dry) {
    for (let k = -1; k <= 1; k++) g.rect(x + k * Math.round(rx / 2), y - 1, 1, 2).fill(0x6a4c30)
    return
  }
  g.rect(x - Math.round(rx / 2), y - 1, Math.max(2, Math.round(rx / 3)), 1).fill(0x9cd0f0)
  for (const dx of [-rx, -rx + 2, rx - 2, rx]) g.rect(x + dx, y - ry - 2, 1, 3).fill(0x4e8a2e)
}

/** A clay pit: a scoop in the ground that grows as it's dug. Once dug out (`fill` 1) its floor is wet and
 *  has a faint sheen of water. */
function drawPit(g: Graphics, x: number, y: number, W: number, fill: number) {
  const rx = Math.max(3, Math.round(W * (0.06 + 0.07 * fill))), ry = Math.max(2, Math.round(rx * 0.42))
  g.ellipse(x, y, rx + 1, ry + 1).fill(0x5a3e26)
  g.ellipse(x, y, rx, ry).fill(fill >= 1 ? 0x7a5a3c : 0xb08a58)
  // heaps of dug clay on the rim
  g.rect(x + rx - 1, y - ry - 1, 3, 2).fill(0xc29a64)
  g.rect(x - rx - 1, y + ry - 1, 2, 2).fill(0xc29a64)
  if (fill >= 1) {
    g.rect(x - Math.round(rx / 2), y - 1, Math.max(2, Math.round(rx / 2)), 1).fill({ color: 0x8cb4d0, alpha: 0.85 })
    g.rect(x + 1, y + 1, Math.max(1, Math.round(rx / 4)), 1).fill({ color: 0x8cb4d0, alpha: 0.6 })
  } else {
    for (let k = -1; k <= 1; k++) g.rect(x + k * Math.max(1, Math.round(rx / 2)), y, 1, 1).fill(0x7a5a3c)
  }
}

/** A well: a ring of stones round a dark shaft, under a little roof on two posts. */
function drawWell(g: Graphics, x: number, y: number, W: number) {
  const r = Math.max(3, Math.round(W * 0.05))
  g.ellipse(x + 1, y + 2, r + 2, Math.ceil(r / 2) + 1).fill({ color: 0x000000, alpha: 0.2 })
  g.rect(x - r, y - r, r * 2, r).fill(0x8c887c)
  g.ellipse(x, y, r, Math.ceil(r / 2)).fill(0x8c887c)
  g.ellipse(x, y - r, r, Math.ceil(r / 2)).fill(0xb4b0a4)
  g.ellipse(x, y - r, r - 1, Math.max(1, Math.ceil(r / 2) - 1)).fill(0x1e2430)
  g.rect(x - r, y - r * 3, 1, r * 2).fill(0x6a4a2a)
  g.rect(x + r - 1, y - r * 3, 1, r * 2).fill(0x6a4a2a)
  g.poly([x - r - 2, y - r * 3, x, y - r * 4, x + r + 2, y - r * 3]).fill(0x9a4a30)
}
/** the shade over land that can't be settled: its alpha drifts between lo and hi every `period` seconds */
const UNSETTLABLE = { lo: 0.3, hi: 0.5, period: 3.2 }




function polyline(g: Graphics, pts: [number, number][]) {
  g.moveTo(pts[0][0], pts[0][1])
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1])
}

function hexCorners(cx: number, cy: number, W: number): [number, number][] {
  const hw = W / 2, qw = W / 4, hh = W / 4
  return [[cx + hw, cy], [cx + qw, cy + hh], [cx - qw, cy + hh], [cx - hw, cy], [cx - qw, cy - hh], [cx + qw, cy - hh]]
}

// neighbour order from hex.ts: NE, SE, S, SW, NW, N  ->  matching face edge (corner pairs)
const EDGE_CORNERS: [number, number][] = [[5, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
