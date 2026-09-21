import { useEffect, useState } from 'react'
import { getPrintings } from '../api/scryfall'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { Dialog } from './Dialog'
import { ArtImage } from './kit'

/** Which printing a card is, in words: the set it came in, and its number within that set. */
export const printingName = (card: ScryfallCard) =>
  [card.set_name ?? card.set?.toUpperCase(), card.collector_number && `#${card.collector_number}`].filter(Boolean).join(' · ')

/**
 * Every printing of the card called [name], to pick one: the scanner's "which one are you holding",
 * and "change printing" on a card in a binder or deck. [currentId] is the printing it is now, ringed.
 */
export function PrintingPicker({ name, currentId, prompt = "Pick the printing you're holding.", onPick, onClose }: {
  name: string
  currentId: string
  prompt?: string
  onPick: (card: ScryfallCard) => void
  onClose: () => void
}) {
  const [printings, setPrintings] = useState<ScryfallCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getPrintings(name)
      .then((found) => { if (!cancelled) setPrintings(found) })
      .catch(() => { if (!cancelled) setError("Couldn't load the other printings — check your connection.") })
    return () => { cancelled = true }
  }, [name])

  return (
    <Dialog title={name} onDismiss={onClose} actions={<button type="button" className="btn line" onClick={onClose}>Close</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{prompt}</p>
      {error && <div className="muted">{error}</div>}
      {!printings && !error && <div className="muted">Looking up printings…</div>}
      {printings && printings.length <= 1 && <div className="muted">Only one printing of this card.</div>}
      {printings && printings.length > 1 && (
        <div className="card-grid">
          {printings.map((card) => (
            <button
              type="button"
              key={card.id}
              className={`card-cell press${card.id === currentId ? ' picked' : ''}`}
              onClick={() => onPick(card)}
            >
              <div className="card-cell-img">
                {displayImageUrl(card) ? <img src={displayImageUrl(card)!} alt={card.name} loading="lazy" /> : <ArtImage src={null} seed={card.name} />}
              </div>
              <div className="card-cell-name">{printingName(card)}</div>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}
