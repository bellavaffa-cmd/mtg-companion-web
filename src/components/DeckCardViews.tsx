import { useMoney } from '../money/currency'
import { hasNameKey, type ComboPieces } from '../decks/comboPieces'
import type { DeckCardEntry } from '../types/models'
import { biggerImageUrl, displayImageUrl, hasFlipSides, type ScryfallCard } from '../types/scryfall'
import { Icon } from './Icon'
import { ArtImage, SectionHeader, toArtCrop } from './kit'
import { useLongPress } from './useLongPress'

/**
 * Cut candidate, combo piece, or one card away from a combo — each at a glance, worded as on the phone.
 * And copies lent out (collection/loans.ts): [lent] of them.
 */
export function DeckCardBadges({ entry, combo, lent = 0 }: { entry: DeckCardEntry; combo: ComboPieces; lent?: number }) {
  const piece = hasNameKey(combo.pieces, entry.name)
  const nearMiss = !piece && hasNameKey(combo.nearMiss, entry.name)
  if (!entry.replaceable && !piece && !nearMiss && lent <= 0) return null
  return (
    <>
      {lent > 0 && <span className="badge warn"><Icon name="handshake" />LENT OUT{entry.quantity > 1 ? ` ×${lent}` : ''}</span>}
      {entry.replaceable && <span className="badge cut"><Icon name="swap_horiz" />CUT</span>}
      {piece && <span className="badge gold"><Icon name="bolt" />COMBO</span>}
      {nearMiss && <span className="badge line"><Icon name="bolt" />+1 COMBO</span>}
    </>
  )
}

/** A card in the deck's list: tap to look at it, hold (or right-click) or ⋮ for its actions. */
export function DeckCardRow({
  entry, combo, commander, lent, onZoom, onMore, onIncrement, onDecrement,
}: {
  entry: DeckCardEntry
  combo: ComboPieces
  commander?: boolean
  /** Copies lent out from the deck. */
  lent?: number
  onZoom: () => void
  onMore: () => void
  onIncrement?: () => void
  onDecrement?: () => void
}) {
  const longPress = useLongPress({ onLongPress: onMore, onClick: onZoom })
  const hasQty = !!onIncrement && !!onDecrement
  return (
    <div className={`crow${hasQty ? '' : ' no-qty'}`}>
      <div className="thumb-wrap" onClick={onZoom} style={{ cursor: 'pointer' }}>
        <ArtImage className="thumb" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
        {entry.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain" {...longPress}>
        <div className="cname">{entry.name}</div>
        <div className="cmeta">
          {commander && <span className="badge gold"><Icon name="star" />Commander</span>}
          <DeckCardBadges entry={entry} combo={combo} lent={lent} />
          <span>{entry.typeLine ?? ''}</span>
        </div>
      </div>
      {hasQty && (
        <div className="qty">
          {/* At one copy this asks first (see the page's fewer()), so the last copy never goes on a stray tap. */}
          <button type="button" onClick={onDecrement} aria-label={`One fewer ${entry.name}`}>−</button>
          <span className="qn">{entry.quantity}</span>
          <button type="button" onClick={onIncrement} aria-label={`One more ${entry.name}`}>+</button>
        </div>
      )}
      <button type="button" className="more" onClick={onMore} aria-label={`Actions for ${entry.name}`}>
        <Icon name="more_vert" style={{ fontSize: 20 }} />
      </button>
    </div>
  )
}

/** A card in the deck's grid: the whole card, tap to look at it, hold (or right-click) for its actions. */
export function DeckCardTile({
  entry, combo, commander, lent, onZoom, onMore,
}: { entry: DeckCardEntry; combo: ComboPieces; commander?: boolean; lent?: number; onZoom: () => void; onMore: () => void }) {
  const longPress = useLongPress({ onLongPress: onMore, onClick: onZoom })
  return (
    <div className="card-cell press" {...longPress}>
      <div className="card-cell-img">
        {entry.imageUrl
          ? <img src={entry.imageUrl} alt={entry.name} loading="lazy" data-card-preview={biggerImageUrl(entry.imageUrl) ?? undefined} />
          : <ArtImage src={null} seed={entry.name} />}
        {entry.quantity > 1 && <span className="card-cell-count">×{entry.quantity}</span>}
        {commander && <span className="card-cell-star" aria-label="Commander"><Icon name="star" /></span>}
        {entry.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="card-cell-name">{entry.name}</div>
      <div className="card-cell-badges"><DeckCardBadges entry={entry} combo={combo} lent={lent} /></div>
    </div>
  )
}

/**
 * Cards the deck doesn't have that match its search, offered under the deck's own matches so a
 * card can be added without leaving for Search. Nothing at all when there are none.
 */
export function AddToDeckSection({ cards, onAdd, onZoom, title = 'Add to this deck' }: { cards: ScryfallCard[]; onAdd: (card: ScryfallCard) => void; onZoom: (card: ScryfallCard) => void; title?: string }) {
  const money = useMoney()
  if (cards.length === 0) return null
  return (
    <>
      <SectionHeader title={title} />
      <div className="list">
        {cards.map((card) => (
          <div key={card.id} className="crow no-qty" style={{ gridTemplateColumns: '56px minmax(0, 1fr) auto auto' }}>
            <button type="button" className="thumb-wrap" onClick={() => onZoom(card)} aria-label={`Look at ${card.name}`}>
              <ArtImage className="thumb" src={toArtCrop(displayImageUrl(card))} seed={card.name} colors={card.color_identity} />
              {hasFlipSides(card) && <span className="flip-badge"><Icon name="autorenew" /></span>}
            </button>
            <button type="button" className="cmain" style={{ textAlign: 'left' }} onClick={() => onZoom(card)}>
              <div className="cname">{card.name}</div>
              <div className="cmeta"><span>{card.type_line ?? ''}</span></div>
            </button>
            {card.prices?.usd ? <span className="cprice">{money.formatPrice(card.prices.usd)}</span> : <span />}
            <button type="button" className="more" onClick={() => onAdd(card)} aria-label={`Add ${card.name} to this deck`} style={{ color: 'var(--gold)' }}>
              <Icon name="add_circle" style={{ fontSize: 24 }} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
