import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { findSimilarCards, getByFuzzyName } from '../api/scryfall'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { Icon } from './Icon'
import { InlineManaText } from './ManaSymbols'
import { IconButton, PillChip, SectionHeader } from './kit'

interface Props {
  imageUrl: string | null
  name: string
  typeLine?: string | null
  priceUsd?: string | null
  priceUsdFoil?: string | null
  onClose: () => void
  /** Extra controls (quantity steppers, add buttons) — callers pass live state so it stays in sync. */
  children?: ReactNode
  /** When set, lists every other deck and binder holding this card. */
  scryfallId?: string
  /** The deck/binder currently being viewed, if any — excluded from its own "also in" listing. */
  currentDeckId?: string
  currentCollectionId?: string
  /** The second face's art, for a transform/modal-DFC/flip card — adds a flip control. */
  backImageUrl?: string | null
  /** Keywords + heuristic theme tags, shown as chips. */
  tags?: string[]
  /** Called when a similar card is tapped. Omit to show the similar cards for information only. */
  onSelectSimilar?: (card: ScryfallCard) => void
  /** Hint under "Similar cards" explaining what tapping one does. */
  similarActionLabel?: string
  /** Rules text in `{X}` symbol syntax, rendered with real mana/ability icons. */
  oracleText?: string | null
  /** Printed cast cost in `{X}` syntax. */
  manaCost?: string | null
}

/** A tilting card that catches a foil sheen under the pointer — the Android app's card detail. */
function TiltCard({ src, alt, children }: { src: string; alt: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)

  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    el.style.setProperty('--ry', `${(x - 0.5) * 22}deg`)
    el.style.setProperty('--rx', `${(0.5 - y) * 22}deg`)
    el.style.setProperty('--mx', `${x * 100}%`)
    el.style.setProperty('--my', `${y * 100}%`)
  }
  const reset = () => {
    setDrag(false)
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  return (
    <div
      ref={ref}
      className={`card3d${drag ? ' drag' : ''}`}
      onPointerEnter={(e) => { setDrag(true); move(e) }}
      onPointerDown={(e) => { setDrag(true); move(e) }}
      onPointerMove={move}
      onPointerLeave={reset}
      onPointerUp={(e) => { if (e.pointerType !== 'mouse') reset() }}
    >
      <img src={src} alt={alt} draggable={false} />
      <div className="holo" />
      {children}
    </div>
  )
}

/** Enlarged card view with prices, rules text, where else it's used and similar cards. */
export function CardZoomModal({
  imageUrl, name, typeLine, priceUsd, priceUsdFoil, onClose, children, scryfallId, currentDeckId, currentCollectionId,
  backImageUrl, tags = [], onSelectSimilar, similarActionLabel, oracleText, manaCost,
}: Props) {
  const { decks, collections } = useSync()
  const navigate = useNavigate()
  const [flipped, setFlipped] = useState(false)
  // undefined = not searched yet, null = searching, [] = searched, no matches.
  const [similar, setSimilar] = useState<ScryfallCard[] | null | undefined>(undefined)
  const shownImageUrl = flipped && backImageUrl ? backImageUrl : imageUrl

  useEffect(() => {
    setFlipped(false)
    setSimilar(undefined)
  }, [name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  async function findSimilar() {
    setSimilar(null)
    try {
      setSimilar(await findSimilarCards(await getByFuzzyName(name)))
    } catch {
      setSimilar([])
    }
  }

  const inDecks = scryfallId ? decks.filter((d) => d.id !== currentDeckId && d.cards.some((c) => c.scryfallId === scryfallId)) : []
  const inBinders = scryfallId ? collections.filter((c) => c.id !== currentCollectionId && c.entries.some((e) => e.scryfallId === scryfallId)) : []

  function goTo(path: string) {
    onClose()
    navigate(path)
  }

  return (
    <>
    {/* Outside the overlay: its backdrop blur would pin a fixed child to the scrolling layer. */}
    <IconButton icon="close" label="Close" variant="glass" className="zoom-close" onClick={onClose} />
    <div className="zoom-overlay" onClick={onClose}>
      <div className="zoom-content" onClick={(e) => e.stopPropagation()}>
        {shownImageUrl && (
          <div className="stage3d rise" style={{ ['--i' as string]: 0 }}>
            <TiltCard src={shownImageUrl} alt={name}>
              {backImageUrl && (
                <IconButton icon="autorenew" label="Flip card" variant="glass" className="flip-btn" onClick={() => setFlipped((f) => !f)} />
              )}
            </TiltCard>
            <div className="tilt-hint">Move across the card to catch the foil</div>
          </div>
        )}

        <div className="rise" style={{ ['--i' as string]: 1 }}>
          {typeLine && <div className="eyebrow">{typeLine}</div>}
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <h2 className="cd-name">{name}</h2>
            {manaCost && <div style={{ paddingTop: 12, flex: 'none' }}><InlineManaText text={manaCost} size={18} /></div>}
          </div>
        </div>

        {(priceUsd || priceUsdFoil) && (
          <div className="prices rise" style={{ ['--i' as string]: 2 }}>
            <div className="price"><span className="lbl">Market</span><b>{priceUsd ? `$${priceUsd}` : '—'}</b></div>
            <div className="price"><span className="lbl">Foil</span><b>{priceUsdFoil ? `$${priceUsdFoil}` : '—'}</b></div>
          </div>
        )}

        {oracleText && (
          <div className="oracle-text rise" style={{ ['--i' as string]: 3 }}>
            <InlineManaText text={oracleText} />
          </div>
        )}

        {tags.length > 0 && (
          <div className="chips wrap">
            {tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>)}
          </div>
        )}

        {children}

        {(inDecks.length > 0 || inBinders.length > 0) && (
          <div>
            <SectionHeader title="Also in" style={{ paddingTop: 12 }} />
            <div className="chips wrap">
              {inDecks.map((d) => <PillChip key={d.id} label={d.name} icon="style" onClick={() => goTo(`/decks/${d.id}`)} />)}
              {inBinders.map((c) => <PillChip key={c.id} label={c.name} icon="collections" onClick={() => goTo(`/collections/${c.id}`)} />)}
            </div>
          </div>
        )}

        {similar === undefined ? (
          <button type="button" className="btn line block" onClick={findSimilar}>
            <Icon name="auto_awesome" />Find similar cards
          </button>
        ) : (
          <div>
            <SectionHeader title="Similar cards" style={{ paddingTop: 12, paddingBottom: similarActionLabel ? 2 : 12 }} />
            {similarActionLabel && similar && similar.length > 0 && <div className="dim" style={{ margin: '0 4px 10px' }}>{similarActionLabel}</div>}
            {similar === null ? (
              <div className="muted">Searching…</div>
            ) : similar.length === 0 ? (
              <div className="muted">No similar cards found.</div>
            ) : (
              <div className="similar-strip">
                {similar.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="similar-card press"
                    onClick={() => onSelectSimilar?.(s)}
                    style={{ cursor: onSelectSimilar ? 'pointer' : 'default' }}
                  >
                    <img src={displayImageUrl(s) ?? undefined} alt={s.name} loading="lazy" />
                    <div className="similar-card-name">{s.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
