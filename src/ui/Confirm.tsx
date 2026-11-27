/** A big confirmation window: what it costs, what you get, and a clear yes or no.
 *  "You spend" and "You get" are separate boxes, so browsing what something would cost is never
 *  mistaken for paying for it. Used for building, gathering and splitting actions. */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmProps {
  title: string
  /** what leaves: the action used up, goods paid */
  spends: string[]
  /** what arrives: goods, or the thing built */
  gets: string[]
  /** small print */
  notes?: string[]
  /** a warning shown in bold (e.g. that it can't be undone) */
  warn?: string
  yes?: string
  no?: string
  onYes: () => void
  onNo: () => void
  /** shown above the buttons (e.g. the actions the player has left) */
  extra?: React.ReactNode
}

export function Confirm({ title, spends, gets, notes = [], warn, yes = 'Yes, do it', no = 'No', onYes, onNo, extra }: ConfirmProps) {
  // Escape is "no"; Enter is deliberately not "yes" (a held key shouldn't spend anything)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onNo() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onNo])
  // a yes counts once: an impatient second tap mustn't spend a second action
  const said = useRef(false)
  useEffect(() => { said.current = false }, [title])
  const yesOnce = () => { if (!said.current) { said.current = true; onYes() } }
  // drawn in the app's own top container, above everything: a panel that scrolls or clips (the hex card on
  // an iPad) mustn't cut it off, or the window shows as a grey screen with its buttons out of reach
  return createPortal(
    <div className="confirm-scrim" onClick={(e) => { if (e.target === e.currentTarget) onNo() }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="card confirm">
        <h2>{title}</h2>
        <div className="confirm-boxes">
          <div className="confirm-box spend">
            <h3>You spend</h3>
            <ul>{spends.length ? spends.map((s) => <li key={s}>{s}</li>) : <li>Nothing</li>}</ul>
          </div>
          <div className="confirm-box get">
            <h3>You get</h3>
            <ul>{gets.length ? gets.map((s) => <li key={s}>{s}</li>) : <li>Nothing</li>}</ul>
          </div>
        </div>
        {notes.map((n) => <p key={n} className="muted confirm-note">{n}</p>)}
        {warn && <p className="confirm-warn">{warn}</p>}
        {extra}
        <div className="confirm-buttons">
          <button className="btn" onClick={onNo} autoFocus>{no}</button>
          <button className="btn primary" onClick={yesOnce}>{yes}</button>
        </div>
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}
