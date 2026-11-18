import { writeFileSync } from 'node:fs'
import { generateWorld } from '../src/world/generate'
const seed = process.argv[2] ?? 'quex'
const t = Date.now()
const w = generateWorld(seed)
console.error(`generated ${w.width}x${w.height} in ${Date.now() - t}ms; start region ${w.startRegion} ${w.regions[w.startRegion].name}; lairs ${w.lairs.length}`)
const sr = w.regions[w.startRegion]
console.error('sites', JSON.stringify(sr.sites))
const counts: Record<string, number> = {}
for (const c of w.cells) { counts[c.terrain] = (counts[c.terrain] ?? 0) + 1; if (c.resource) counts['res:' + c.resource] = (counts['res:' + c.resource] ?? 0) + 1 }
console.error(JSON.stringify(counts))
console.error('rivers', w.cells.filter(c => c.riverTo !== -1 && c.tier > 0).length)
writeFileSync(process.argv[3] ?? 'world.json', JSON.stringify({
  width: w.width, height: w.height, startRegion: w.startRegion, regions: w.regions, lairs: w.lairs,
  cells: w.cells.map(c => [c.terrain, c.tier, c.feature, c.riverTo, c.resource]),
}))
