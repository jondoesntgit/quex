/** What stands on a village hex and on a House hex: which Blender house sprites, and where.
 *
 *  A village is a little cobbled square: a well in the middle and three two-storey town houses
 *  round it. A House is three cottages. Each hex picks its roofs and walls from its index, so
 *  neighbouring ones differ but a given hex always looks the same.
 *
 *  Positions are screen offsets (px) of each building's ground point from the hex centre. They
 *  were chosen so no two footprints overlap (townlayout.test.ts checks it against the footprints
 *  exported from Blender). Pure: no drawing here. */

export interface Spot { key: string; x: number; y: number }

/** A small, stable hash of a hex index (and a salt) into 0..1. */
export function pick01(i: number, salt: number): number {
  let h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const choose = <T,>(xs: readonly T[], i: number, salt: number): T => xs[Math.floor(pick01(i, salt) * xs.length)]

const TOWN_ROOFS = ['tile', 'tile2', 'slate', 'shingle'] as const
const COTTAGE_ROOFS = ['tile', 'tile2', 'thatch', 'shingle', 'slate'] as const

/** Town house sprites are made for the gable to face the viewer; walls come in three finishes. */
const townHouse = (i: number, salt: number) => `t_${choose(TOWN_ROOFS, i, salt)}_y_${Math.floor(pick01(i, salt + 50) * 3)}`

/** The village square: two town houses behind, one in front, the well between. */
export function villageSpots(i: number): Spot[] {
  return [
    { key: townHouse(i, 1), x: -13, y: -4.5 },
    { key: townHouse(i, 2), x: 13, y: -4.5 },
    { key: 'well', x: 0, y: -2 },
    { key: townHouse(i, 3), x: 0, y: 9.5 },
  ]
}

/** A House: three cottages, a bigger pair behind and a small one in front. */
export function houseSpots(i: number): Spot[] {
  const cottage = (size: 'S' | 'M', salt: number, orient: 'x' | 'y') =>
    `c_${size}_${choose(COTTAGE_ROOFS, i, salt)}_${orient}_${pick01(i, salt + 50) < 0.5 ? 0 : 1}`
  return [
    { key: cottage('M', 1, 'x'), x: -14, y: -4 },
    { key: cottage('M', 2, 'x'), x: 14, y: -3 },
    { key: cottage('S', 3, 'x'), x: 0, y: 7 },
  ]
}
