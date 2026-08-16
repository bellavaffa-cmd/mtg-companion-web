import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from './Icon'

interface Props {
  imageUrl: string | null
  name: string
  priceUsd?: string | null
  onClose: () => void
  children?: ReactNode
  /** Scryfall ID of the zoomed card. When set, the modal looks up and lists every other deck
   * and binder holding this same card. Omit to skip the lookup (e.g. a card with no stable ID yet). */
  scryfallId?: string
  /** The deck/binder currently being viewed, if any — excluded from its own "also in" listing. */
  currentDeckId?: string
  currentCollectionId?: string
}

/** Enlarged card view, mirroring the Android app's CardZoomDialog. [children] holds any extra
 * controls (quantity steppers, etc.) — callers pass live state so it stays in sync as they edit. */
export function CardZoomModal({
  imageUrl, name, priceUsd, onClose, children, scryfallId, currentDeckId, currentCollectionId,
}: Props) {
  const { decks, collections } = useSync()
  const navigate = useNavigate()

  const inDecks = scryfallId
    ? decks.filter((d) => d.id !== currentDeckId && d.cards.some((c) => c.scryfallId === scryfallId))
    : []
  const inBinders = scryfallId
    ? collections.filter((c) => c.id !== currentCollectionId && c.entries.some((e) => e.scryfallId === scryfallId))
    : []

  function goTo(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <div className="zoom-overlay" onClick={onClose}>
      <button className="zoom-close" onClick={onClose} aria-label="Close">
        <Icon name="close" />
      </button>
      <div className="zoom-content" onClick={(e) => e.stopPropagation()}>
        {imageUrl && <img src={imageUrl} alt={name} />}
        <div className="zoom-name">{name}</div>
        {priceUsd && <div className="zoom-price">${priceUsd}</div>}
        {children}
        {(inDecks.length > 0 || inBinders.length > 0) && (
          <div className="zoom-also-in">
            <div className="section-label">ALSO IN</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {inDecks.map((d) => (
                <span key={d.id} className="chip" onClick={() => goTo(`/decks/${d.id}`)}>
                  <Icon name="style" />
                  {d.name}
                </span>
              ))}
              {inBinders.map((c) => (
                <span key={c.id} className="chip" onClick={() => goTo(`/collections/${c.id}`)}>
                  <Icon name="collections" />
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
