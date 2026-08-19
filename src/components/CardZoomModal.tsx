import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { findSimilarCards, getByFuzzyName } from '../api/scryfall'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'
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
  /** The second face's art, for a transform/modal-DFC/flip card — adds a flip control. */
  backImageUrl?: string | null
  /** Printed keywords + heuristic theme tags (cardTags() from a full card, or a deck/binder
   * entry's cached `tags`) — shown as chips. Omit if unavailable. */
  tags?: string[]
  /** Called when a "similar card" is tapped — the caller decides what that means (Search retargets
   * this same modal to it; Deck/Binder add it directly). Omit to hide the add/select affordance
   * (the similar-cards strip still shows, just informationally). */
  onSelectSimilar?: (card: ScryfallCard) => void
}

/** Enlarged card view, mirroring the Android app's CardZoomDialog. [children] holds any extra
 * controls (quantity steppers, etc.) — callers pass live state so it stays in sync as they edit. */
export function CardZoomModal({
  imageUrl, name, priceUsd, onClose, children, scryfallId, currentDeckId, currentCollectionId, backImageUrl,
  tags = [], onSelectSimilar,
}: Props) {
  const { decks, collections } = useSync()
  const navigate = useNavigate()
  const [flipped, setFlipped] = useState(false)
  // undefined = not searched yet, null = searching, [] = searched, no matches.
  const [similar, setSimilar] = useState<ScryfallCard[] | null | undefined>(undefined)
  const shownImageUrl = flipped && backImageUrl ? backImageUrl : imageUrl

  async function findSimilar() {
    setSimilar(null)
    try {
      const resolved = await getByFuzzyName(name)
      setSimilar(await findSimilarCards(resolved))
    } catch {
      setSimilar([])
    }
  }

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
        {shownImageUrl && (
          <div className="zoom-image-wrap">
            <img src={shownImageUrl} alt={name} />
            {backImageUrl && (
              <button className="zoom-flip" onClick={() => setFlipped((f) => !f)} aria-label="Flip card">
                <Icon name="autorenew" />
              </button>
            )}
          </div>
        )}
        <div className="zoom-name">{name}</div>
        {priceUsd && <div className="zoom-price">${priceUsd}</div>}
        {tags.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
            {tags.map((tag) => (
              <span key={tag} className="tag-chip">{tag}</span>
            ))}
          </div>
        )}
        <button className="btn" style={{ marginTop: 10 }} onClick={findSimilar} disabled={similar === null}>
          <Icon name="search" /> {similar === null ? 'SEARCHING…' : 'FIND SIMILAR CARDS'}
        </button>
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
        {similar != null && (
          <div className="zoom-also-in">
            <div className="section-label">SIMILAR CARDS</div>
            {similar.length === 0 ? (
              <div className="dim">No similar cards found.</div>
            ) : (
              <div className="similar-strip">
                {similar.map((s) => (
                  <div
                    key={s.id}
                    className="similar-card"
                    onClick={() => onSelectSimilar?.(s)}
                    style={{ cursor: onSelectSimilar ? 'pointer' : 'default' }}
                  >
                    <img src={displayImageUrl(s) ?? undefined} alt={s.name} />
                    <div className="similar-card-name">{s.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
