import { useState } from 'react'
import { eventId, type Game } from '../app/store'
import type { Player } from '../game/types'
import { Confirm } from './Confirm'
import { SIZE_LABEL, spendables } from './helpers'

/** The player's actions, small, inside whatever they're spending from (a hex's panel, a confirm window), so what's
 *  left is always in sight on any screen. A whole big or medium one can be tapped to split it (not when `readOnly`). */
export function ActionStrip({ game, p, readOnly }: { game: Game; p: Player; readOnly?: boolean }) {
  const [splitting, setSplitting] = useState<string | null>(null)
  const list = spendables(p)
  const t = splitting ? p.tokens.find((x) => x.id === splitting) : null
  return (
    <div className="action-strip">
      <span className="muted">Your actions:</span>
      {list.length ? list.map((s) => {
        const splittable = !readOnly && s.strength >= 1 && !s.tok2 && s.size !== 'small' && !game.guest
        return (
          <span key={s.id} className={`token mini ${s.size} ${s.strength < 1 ? 'half' : ''}`}
            role={splittable ? 'button' : undefined} tabIndex={splittable ? 0 : undefined}
            onClick={() => splittable && setSplitting(s.id)}
            title={s.strength < 1 ? `Half-done ${s.size} task` : `${SIZE_LABEL[s.size]} action${splittable ? ' (tap to split)' : ''}`}>
            {s.size === 'big' ? 'B' : s.size === 'medium' ? 'M' : 'S'}
          </span>
        )
      }) : <span className="muted"> none left: finish a task to earn one</span>}
      {t && (
        <Confirm
          title={`Split this ${t.size} action?`}
          spends={[`1 ${t.size} action`]}
          gets={t.size === 'big' ? ['1 medium action', '1 small action'] : ['2 small actions']}
          warn="This can't be undone: the pieces never join back into a bigger action."
          yes="Yes, split it" no="No, keep it whole"
          onNo={() => setSplitting(null)}
          onYes={() => {
            void game.dispatch({ t: 'split', id: eventId(), at: game.now().toISOString(), playerId: p.id, tokenId: t.id })
            setSplitting(null)
          }}
        />
      )}
    </div>
  )
}
