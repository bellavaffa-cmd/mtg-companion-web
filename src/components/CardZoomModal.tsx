import { useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { MAX_TAG_LENGTH, tidyTags } from '../collection/userTags'
import { useMoney } from '../money/currency'
import { buyCardUrl } from '../api/buy'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { findSimilarCards, getByFuzzyName } from '../api/scryfall'
import { combosUsingCard, comboUrl, relayAvailable, type ComboVariant } from '../api/relay'
import { displayImageUrl, largeImageUrl, type ScryfallCard } from '../types/scryfall'
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
  /** What the card does (Mana ramp, Removal…), shown as chips. */
  tags?: string[]
  /** Tags still being looked up: says so instead of showing none. */
  tagsLoading?: boolean
  /** Tapping a tag (a search for it, say). Omit for plain chips. */
  onTagClick?: (tag: string) => void
  /** Called when a similar card is tapped. Omit to show the similar cards for information only. */
  onSelectSimilar?: (card: ScryfallCard) => void
  /** Hint under "Similar cards" explaining what tapping one does. */
  similarActionLabel?: string
  /**
   * The user's own tags on this copy, and how to change them. Given only for a card they own —
   * tagging is about the copy in a binder or deck, not about the card (see collection/userTags.ts).
   */
  userTags?: string[]
  onUserTags?: (tags: string[]) => void
  /** Tags they've used elsewhere, offered while typing. */
  knownUserTags?: string[]
  /** Rules text in `{X}` symbol syntax, rendered with real mana/ability icons. */
  oracleText?: string | null
  /** Printed cast cost in `{X}` syntax. */
  manaCost?: string | null
  /** Where to buy this printing; without one the Buy chip searches TCGplayer for the name. */
  buyUrl?: string | null
  /** The card before and after this one in the list it was opened from — a swipe, the arrow keys or
   * the chevrons move between them. Omit either one at the ends of the list. */
  onPrev?: () => void
  onNext?: () => void
  /** Where this card sits in that list, 1-based, e.g. "3 of 40". */
  position?: { index: number; total: number }
}

/**
 * Next and previous for a zoom opened from [list], in the order the cards are listed — a swipe, the
 * arrow keys or the chevrons move along it. Nothing when the card isn't in the list or it's alone.
 */
export function zoomSteps<T>(
  list: T[],
  current: T,
  go: (card: T) => void,
  keyOf: (card: T) => string = (card) => (card as { scryfallId: string }).scryfallId,
) {
  const key = keyOf(current)
  const i = list.findIndex((c) => keyOf(c) === key)
  if (i < 0 || list.length < 2) return {}
  return {
    onPrev: i > 0 ? () => go(list[i - 1]) : undefined,
    onNext: i < list.length - 1 ? () => go(list[i + 1]) : undefined,
    position: { index: i + 1, total: list.length },
  }
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
/**
 * The user's own tags on the copy they own: chips with a cross, and a box to add one. Kept plain on
 * purpose — the same shape as a deck's own tags, which people already know from the Details tab.
 */
function UserTagEditor({ tags, known, onChange }: { tags: string[]; known: string[]; onChange: (tags: string[]) => void }) {
  const [typed, setTyped] = useState('')
  const add = (raw: string) => {
    const next = tidyTags([...tags, raw])
    if (next.length !== tags.length) onChange(next)
    setTyped('')
  }
  // Ones they've used before that this card hasn't got, so a second card is a tap rather than typing.
  const has = new Set(tags.map((t) => t.trim().toLowerCase()))
  const offer = known.filter((t) => !has.has(t.trim().toLowerCase())).slice(0, 6)
  return (
    <div className="panel user-tags" style={{ padding: '12px 14px' }}>
      <div className="p-h" style={{ margin: 0 }}>
        <h3>Your tags</h3>
        <span className="p-sub">on this copy</span>
      </div>
      <div className="dim" style={{ margin: '2px 0 8px' }}>
        Yours to write — "proxy", "signed", "lent to Sam". They follow this copy into any deck or binder.
      </div>
      {tags.length > 0 && (
        <div className="chips wrap" style={{ marginBottom: 8 }}>
          {tags.map((tag) => (
            <PillChip key={tag} label={tag} icon="close" onClick={() => onChange(tags.filter((t) => t !== tag))} />
          ))}
        </div>
      )}
      <form
        className="row" style={{ gap: 8 }}
        onSubmit={(e) => { e.preventDefault(); add(typed) }}
      >
        <input
          className="input" value={typed} maxLength={MAX_TAG_LENGTH}
          placeholder="Add a tag, e.g. proxy"
          aria-label="Add a tag to this copy"
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="btn line sm" disabled={!typed.trim()}>Add</button>
      </form>
      {offer.length > 0 && (
        <div className="chips wrap" style={{ marginTop: 8 }}>
          {offer.map((tag) => (
            <button key={tag} type="button" className="tag-chip press" onClick={() => add(tag)} title={`Tag this copy ${tag}`}>+ {tag}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function CardZoomModal({
  imageUrl, name, typeLine, priceUsd, priceUsdFoil, onClose, children, scryfallId, currentDeckId, currentCollectionId,
  backImageUrl, tags = [], tagsLoading = false, onTagClick, onSelectSimilar, similarActionLabel, oracleText, manaCost,
  onPrev, onNext, position, buyUrl, userTags, onUserTags, knownUserTags,
}: Props) {
  const money = useMoney()
  const { decks, collections } = useSync()
  const navigate = useNavigate()
  const [flipped, setFlipped] = useState(false)
  // undefined = not searched yet, null = searching, [] = searched, no matches.
  const [similar, setSimilar] = useState<ScryfallCard[] | null | undefined>(undefined)
  // undefined = still loading, null = couldn't reach Commander Spellbook, [] = no combos.
  const [combos, setCombos] = useState<ComboVariant[] | null | undefined>(undefined)
  const shownImageUrl = flipped && backImageUrl ? backImageUrl : imageUrl

  useEffect(() => {
    setFlipped(false)
    setSimilar(undefined)
  }, [name])

  useEffect(() => {
    if (!relayAvailable) return
    let cancelled = false
    setCombos(undefined)
    combosUsingCard(name)
      .then((found) => { if (!cancelled) setCombos(found) })
      .catch(() => { if (!cancelled) setCombos(null) })
    return () => { cancelled = true }
  }, [name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev?.()
      if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose, onPrev, onNext])

  // Swiping across the card moves to the next or previous one, as it does in the Android app.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swipeHandlers = onPrev || onNext ? {
    onTouchStart: (e: ReactTouchEvent) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } },
    onTouchEnd: (e: ReactTouchEvent) => {
      const from = swipe.current
      swipe.current = null
      if (!from) return
      const dx = e.changedTouches[0].clientX - from.x
      const dy = e.changedTouches[0].clientY - from.y
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
      if (dx < 0) onNext?.()
      else onPrev?.()
    },
  } : {}

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
          <div className="zoom-left" {...swipeHandlers}>
            {onPrev && <IconButton icon="chevron_left" label="Previous card" variant="glass" className="zoom-step prev" onClick={onPrev} />}
            {onNext && <IconButton icon="chevron_right" label="Next card" variant="glass" className="zoom-step next" onClick={onNext} />}
            <div className="stage3d rise" style={{ ['--i' as string]: 0 }}>
              <TiltCard src={shownImageUrl} alt={name}>
                {backImageUrl && (
                  <IconButton icon="autorenew" label="Flip card" variant="glass" className="flip-btn" onClick={() => setFlipped((f) => !f)} />
                )}
              </TiltCard>
              <div className="tilt-hint">
                {position ? `${position.index} of ${position.total} · swipe or use the arrow keys` : 'Move across the card to catch the foil'}
              </div>
            </div>
          </div>
        )}
        <div className="zoom-right">

        <div className="rise" style={{ ['--i' as string]: 1 }}>
          {typeLine && <div className="eyebrow">{typeLine}</div>}
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <h2 className="cd-name">{name}</h2>
            {manaCost && <div style={{ paddingTop: 12, flex: 'none' }}><InlineManaText text={manaCost} size={18} /></div>}
          </div>
        </div>

        {(priceUsd || priceUsdFoil) && (
          <div className="prices rise" style={{ ['--i' as string]: 2 }}>
            <div className="price"><span className="lbl">Market</span><b>{money.formatPrice(priceUsd) ?? '—'}</b></div>
            <div className="price"><span className="lbl">Foil</span><b>{money.formatPrice(priceUsdFoil) ?? '—'}</b></div>
          </div>
        )}

        {oracleText && (
          <div className="oracle-text rise" style={{ ['--i' as string]: 3 }}>
            <InlineManaText text={oracleText} />
          </div>
        )}

        {(tags.length > 0 || tagsLoading) && (
          <div className="chips wrap zoom-tags" aria-label="Tags">
            {tags.map((tag) => onTagClick ? (
              <button key={tag} type="button" className="tag-chip press" onClick={() => onTagClick(tag)} title={`Find every card tagged ${tag}`}>{tag}</button>
            ) : (
              <span key={tag} className="tag-chip">{tag}</span>
            ))}
            {tagsLoading && tags.length === 0 && <span className="dim">Finding tags…</span>}
          </div>
        )}

        {onUserTags && (
          <UserTagEditor tags={userTags ?? []} known={knownUserTags ?? []} onChange={onUserTags} />
        )}

        <div className="chips wrap">
          <PillChip label="Rulings" icon="gavel" onClick={() => goTo(`/rules?tab=rulings&card=${encodeURIComponent(name)}`)} />
          <PillChip
            label="Buy"
            icon="shopping_cart"
            onClick={() => window.open(buyUrl ?? buyCardUrl(null, name), '_blank', 'noopener,noreferrer')}
          />
        </div>

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

        {combos && combos.length > 0 && (
          <div>
            <SectionHeader title="Combos" style={{ paddingTop: 12, paddingBottom: 2 }} />
            <div className="dim" style={{ margin: '0 4px 10px' }}>From Commander Spellbook. Tap one to read how it works.</div>
            <ul className="combo-list">
              {combos.map((variant) => (
                <li key={variant.id}>
                  <a className="combo press" href={comboUrl(variant.id)} target="_blank" rel="noreferrer noopener">
                    <span className="combo-cards">
                      {variant.uses.map((use, i) => (
                        <span key={`${use.card.name}-${i}`} className={use.card.name === name ? 'combo-self' : ''}>
                          {i > 0 && <i> + </i>}{use.card.name}
                        </span>
                      ))}
                    </span>
                    {variant.produces.length > 0 && (
                      <span className="combo-results">{variant.produces.slice(0, 2).map((p) => p.feature.name).join(' · ')}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
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
                    <img src={displayImageUrl(s) ?? undefined} alt={s.name} loading="lazy" data-card-preview={largeImageUrl(s) ?? undefined} />
                    <div className="similar-card-name">{s.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
    </>
  )
}
