/** The worlds on the live site.
 *  - FAMILY: the friends-and-family playtest. Anyone can look; only its
 *    players (and people its admins let in) can play.
 *  - SANDBOX: open to anyone on the internet who wants to try Quex. */
export const FAMILY_WORLD = 'quex-season-1'
export const SANDBOX_WORLD = 'quex-sandbox'

export const worldName = (seed: string) =>
  seed === FAMILY_WORLD ? 'the family playtest world' : seed === SANDBOX_WORLD ? 'the sandbox' : `world "${seed}"`

/** A link to the game in this world (always names the world, so it works whatever the visitor's default is). */
export function worldUrl(seed: string, params: Record<string, string> = {}): string {
  const u = new URL(location.origin + location.pathname)
  u.searchParams.set('seed', seed)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/** Look around the family playtest world without joining it. */
export const familyPreviewUrl = () => worldUrl(FAMILY_WORLD, { preview: '1' })
