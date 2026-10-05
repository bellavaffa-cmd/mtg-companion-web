import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { ArtImage, StatFigure, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { useCardData } from '../collection/cardData'
import { buyListUrl } from '../api/buy'
import { shortBuyList, shortCost, spreadThin, thinLine, type ThinCard } from '../collection/spreadThin'

// Cards spread too thin: what your decks between them use more copies of than you own, shortest
// first, with the decks using each, what the missing copies cost and a list to buy them from.
// Mirrors the Android app's SpreadThinScreen (ui/collection/SpreadThinScreen.kt).

export function SpreadThinPage() {
  const back = useBack('/collections')
  const navigate = useNavigate()
  const money = useMoney()
  const { collections, decks } = useSync()
  const cards = useMemo(() => spreadThin(collections, decks), [collections, decks])
  const cardsById = useCardData(cards.flatMap((c) => c.scryfallIds))
  const prices = useMemo(() => {
    const m = new Map<string, number | null>()
    if (cardsById) for (const [id, c] of cardsById) m.set(id, c.prices?.usd ? Number(c.prices.usd) : null)
    return m
  }, [cardsById])
  const [copied, setCopied] = useState(false)

  const copies = cards.reduce((n, c) => n + c.short, 0)
  const costs = cards.map((c) => shortCost(c, prices))
  const total = costs.reduce<number>((n, c) => n + (c ?? 0), 0)
  const unpriced = costs.filter((c) => c == null).length

  return (
    <>
      <TopBar title="Spread thin" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <p className="muted rise" style={{ ...rise(0), marginTop: 0 }}>
            Cards your decks use more copies of than you own, so they're moved from deck to deck. Copies in your binders
            and in the decks you hold count as owned; any printing will do, and basic lands are left out.
          </p>
          {cards.length === 0 ? (
            <div className="empty-state rise" style={rise(1)}>
              <Icon name="check_circle" />
              <div>Nothing is spread thin. Every deck can have its own copy of each card.</div>
            </div>
          ) : (
            <>
              <div className="stats rise" style={rise(1)}>
                <StatFigure value={cards.length} label={cards.length === 1 ? 'Card short' : 'Cards short'} />
                <StatFigure value={copies} label={copies === 1 ? 'Copy to buy' : 'Copies to buy'} />
                <button type="button" className="stat" style={{ cursor: 'default' }}>
                  <span className="num">{cardsById ? money.format(total, total >= 100) : <span style={{ color: 'var(--t2)' }}>—</span>}</span>
                  <span className="lbl">To buy them</span>
                </button>
              </div>
              {cardsById && unpriced > 0 && (
                <div className="dim" style={{ marginTop: 6 }}>{unpriced} {unpriced === 1 ? 'card has' : 'cards have'} no price, so {unpriced === 1 ? "isn't" : "aren't"} in the total.</div>
              )}
              <div className="row rise" style={{ ...rise(2), flexWrap: 'wrap', gap: 8, margin: '14px 0' }}>
                <button type="button" className="btn gold sm" onClick={() => { void navigator.clipboard.writeText(shortBuyList(cards)).then(() => setCopied(true)) }}>
                  <Icon name={copied ? 'check' : 'content_copy'} aria-hidden />{copied ? 'Copied' : 'Copy buy list'}
                </button>
                <button
                  type="button"
                  className="btn line sm"
                  onClick={() => {
                    const url = buyListUrl(cards.map((c) => ({ name: c.name, quantity: c.short })))
                    if (url) window.open(url, '_blank', 'noopener,noreferrer')
                  }}
                >
                  <Icon name="shopping_cart" aria-hidden />Buy at TCGplayer
                </button>
              </div>
              <div className="list wide-list">
                {cards.map((c, i) => (
                  <ThinRow key={c.name} card={c} index={i} cost={cardsById ? costs[i] : undefined} format={(usd) => money.format(usd)} onOpenDeck={(id) => navigate(`/decks/${id}`)} />
                ))}
              </div>
              <p className="dim" style={{ fontSize: 12.5, marginTop: 16 }}>
                Prices are TCGplayer's market price for the cheapest printing your decks play
                {money.isUsd ? '' : `, in ${money.currency.code} at today's exchange rate`}.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function ThinRow({ card, index, cost, format, onOpenDeck }: {
  card: ThinCard
  index: number
  /** Undefined while prices load, null for a card with none. */
  cost: number | null | undefined
  format: (usd: number) => string
  onOpenDeck: (id: string) => void
}) {
  return (
    <div className="crow no-qty rise" style={{ ...rise(Math.min(index, 8) + 3), alignItems: 'start' }}>
      <ArtImage className="thumb" src={toArtCrop(card.imageUrl)} seed={card.name} />
      <div className="cmain">
        <div className="cname">{card.name}</div>
        <div className="cmeta"><span>{thinLine(card)}</span></div>
        <div className="chips wrap" style={{ marginTop: 4, gap: 6 }}>
          {card.decks.map((u) => (
            <button key={u.deckId} type="button" className="chip on-g2" style={{ padding: '5px 10px', fontSize: 12, maxWidth: '100%', minWidth: 0 }} onClick={() => onOpenDeck(u.deckId)}>
              {/* A long deck name ellipsizes inside the chip rather than running under the price. */}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{u.deckName}</span>{u.copies > 1 ? ` ×${u.copies}` : ''}
            </button>
          ))}
        </div>
      </div>
      <div style={{ textAlign: 'right', paddingRight: 8 }}>
        <div style={{ fontWeight: 800, color: 'var(--error)' }}>{card.short} short</div>
        <div className="dim">{cost === undefined ? '' : cost === null ? 'No price' : format(cost)}</div>
      </div>
    </div>
  )
}
