/** A row of cottages: what the House building looks like. Drawn in code (like the
 *  keep and the well), so it scales with the hex. Three cottages stand along a short
 *  dirt lane, each a little different (roof colour, which way the door faces, a
 *  chimney with smoke on one), with a garden fence in front. */
import type { Graphics } from 'pixi.js'

const WALL = 0xe8d0a0, WALL_SHADE = 0xbfa575, OUTLINE = 0x6a2a18, DOOR = 0x4a3020, WINDOW = 0xf6e58a
const ROOFS: [number, number][] = [[0xd8442c, 0xa83020], [0xc8502c, 0x9a3a20], [0xb8462c, 0x8a3220]]

function cottage(g: Graphics, x: number, y: number, u: number, k: number, smoke: boolean) {
  const [roof, shade] = ROOFS[k % ROOFS.length]
  // walls with an outline, shaded on the right
  g.rect(x - 4 * u - 1, y - 4 * u - 1, 8 * u + 2, 4 * u + 2).fill(OUTLINE)
  g.rect(x - 4 * u, y - 4 * u, 8 * u, 4 * u).fill(WALL)
  g.rect(x + 2 * u, y - 4 * u, 2 * u, 4 * u).fill(WALL_SHADE)
  // door and a little window
  g.rect(x - (k % 2 ? 3 : 1) * u, y - 2.5 * u, 1.5 * u, 2.5 * u).fill(DOOR)
  g.rect(x + (k % 2 ? 0 : -3) * u, y - 3 * u, u, u).fill(WINDOW)
  // a pitched roof, overhanging the walls
  g.poly([x - 5.5 * u - 1, y - 4 * u + 1, x - 3 * u, y - 8.5 * u - 1, x + 3 * u, y - 8.5 * u - 1, x + 5.5 * u + 1, y - 4 * u + 1]).fill(OUTLINE)
  g.poly([x - 5.5 * u, y - 4 * u, x - 3 * u, y - 8.5 * u, x + 3 * u, y - 8.5 * u, x + 5.5 * u, y - 4 * u]).fill(roof)
  g.poly([x, y - 8.5 * u, x + 3 * u, y - 8.5 * u, x + 5.5 * u, y - 4 * u, x, y - 4 * u]).fill(shade)
  g.rect(x - 3 * u, y - 8.5 * u, 6 * u, Math.max(1, u * 0.5)).fill(0xf0a080)
  // chimney
  g.rect(x + 1.5 * u, y - 10.5 * u, u, 2.5 * u).fill(0x6a5a4a)
  if (smoke) {
    g.rect(x + 1.5 * u, y - 12 * u, u, u).fill({ color: 0xc8c8c8, alpha: 0.7 })
    g.rect(x + 2.5 * u, y - 14 * u, u * 1.2, u * 1.2).fill({ color: 0xd8d8d8, alpha: 0.5 })
  }
}

/** Draw the row centred on (x, y); `u` is the pixel unit (W / 32). */
export function drawCottages(g: Graphics, x: number, y: number, W: number) {
  const u = Math.max(1, Math.round(W / 32))
  // the lane they stand along, and a stretch of garden fence in front
  g.ellipse(x, y + u, 14 * u, 3.5 * u).fill({ color: 0xc09858, alpha: 0.9 })
  g.ellipse(x, y + u, 14 * u, 3.5 * u).stroke({ width: 1, color: 0x7a5830, alpha: 0.6 })
  // back to front: the cottages stagger a little up and down the lane
  const at: [number, number][] = [[-10 * u, -1.5 * u], [10 * u, -1 * u], [0, 1.5 * u]]
  for (let k = 0; k < at.length; k++) cottage(g, x + at[k][0], y + at[k][1], u, k, k === 2)
  for (let k = -5; k <= 5; k += 2) g.rect(x + k * 2.4 * u, y + 3.5 * u, 1, Math.max(1, u)).fill(0x8a6a3a)
  g.rect(x - 12 * u, y + 4 * u, 24 * u, 1).fill(0x8a6a3a)
}
