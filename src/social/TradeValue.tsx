import { useEffect, useMemo, useState } from 'react'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { getCardsByIds } from '../api/scryfall'
import { namesDecksUse } from '../collection/spares'
import { useSync } from '../sync/SyncContext'
import type { TradeCard } from './api'
import * as more from './more'
import {
  candidatesFor, evenOut, evenOutTitle, fairness, shortSide, unpricedLine, verdictLine,
  type PriceBook, type Suggestion,
} from './tradeFairness'

/** Prices of [cards] (USD, and the foil price for foil copies), fetched when the list changes. Null when they couldn't be fetched. */
function useTradePrices(cards: TradeCard[]): PriceBook | null | undefined {
  const [prices, setPrices] = useState<{ key: string; book: PriceBook | null } | null>(null)
  const key = [...new Set(cards.map((c) => c.scryfallId))].sort().join(',')
  useEffect(() => {
    if (!key) return
    let cancelled = false
    getCardsByIds(key.split(','))
      .then((list) => {
        if (cancelled) return
        setPrices({ key, book: new Map(list.map((c) => [c.id, {
          usd: c.prices?.usd ? Number(c.prices.usd) : null,
          foil: c.prices?.usd_foil ? Number(c.prices.usd_foil) : null,
        }])) })
      })
      .catch(() => { if (!cancelled) setPrices({ key, book: null }) })
    return () => { cancelled = true }
  }, [key])
  if (!key) return new Map()
  if (prices?.key === key) return prices.book
  // The last answer still does while it has every card (a card taken off), so the totals don't blink.
  const last = prices?.book
  return last && key.split(',').every((id) => last.has(id)) ? last : undefined
}

// The trade matches, asked once a minute at most: every trade on the Trades page shares one answer.
let matchesAsked: { at: number; answer: Promise<more.TradeMatch[]> } | null = null
export function tradeMatchesCached(): Promise<more.TradeMatch[]> {
  if (!matchesAsked || Date.now() - matchesAsked.at > 60_000) {
    matchesAsked = { at: Date.now(), answer: more.tradeMatches().catch(() => { matchesAsked = null; return [] }) }
  }
  return matchesAsked.answer
}

/** The two-way trade matches with [friend] (null: none, or the server doesn't have them yet). */
function useFriendMatch(friend: string | undefined): more.TradeMatch | null {
  const available = more.useSocialMore()
  const [match, setMatch] = useState<{ friend: string; m: more.TradeMatch | null } | null>(null)
  useEffect(() => {
    if (!available || !friend) return
    let cancelled = false
    void tradeMatchesCached().then((list) => { if (!cancelled) setMatch({ friend, m: list.find((x) => x.friend === friend) ?? null }) })
    return () => { cancelled = true }
  }, [available, friend])
  return match && match.friend === friend ? match.m : null
}

/**
 * Is the trade fair? Both sides' total value at today's prices (social/tradeFairness.ts), the
 * difference, a balance bar, and — when [onAdd] is given and it's uneven — up to three cards from
 * [friend]'s trade matches that would even it out, one tap to add. Fair is within $2, or a tenth of
 * the bigger side. Scryfall's prices are a guide (market prices, updated daily), not an appraisal.
 */
export function TradeValue({ get, give, friend, friendName, onAdd, addLabel = 'Add' }: {
  get: TradeCard[]
  give: TradeCard[]
  /** The other person (a user id): their trade matches give the cards to even it out. */
  friend?: string
  friendName?: string
  /** Puts a suggested card on the trade: on the user's ask ('want') or offer ('give'). */
  onAdd?: (side: 'want' | 'give', card: TradeCard) => void
  addLabel?: string
}) {
  const { decks } = useSync()
  const match = useFriendMatch(onAdd ? friend : undefined)
  const decksUse = useMemo(() => namesDecksUse(decks), [decks])
  const extra = useMemo(() => (match ? [...candidatesFor('want', match, decksUse), ...candidatesFor('give', match, decksUse)] : []), [match, decksUse])
  const prices = useTradePrices([...get, ...give, ...extra])
  // Worked out in US dollars, shown in the chosen currency.
  const money = useMoney()
  const fmt = (v: number) => money.format(v)
  if (get.length + give.length === 0) return null
  if (prices === undefined) return <div className="trade-value dim">Looking up prices…</div>
  if (prices === null) return <div className="trade-value dim">Couldn't load prices.</div>
  const f = fairness(get, give, prices)
  // Nothing priced: no verdict to give.
  if (!f) {
    const n = [...get, ...give].reduce((s, c) => s + c.quantity, 0)
    return <div className="trade-value dim">{n === 1 ? 'This card has no price' : `None of these ${n} cards have a price`}, so their value can't be compared.</div>
  }
  const side = shortSide(f)
  const suggestions: Suggestion[] = side && onAdd ? evenOut(f.diff, candidatesFor(side, match, decksUse), [...get, ...give], prices) : []
  const unpriced = unpricedLine(f.unpriced)
  const getPct = Math.round(f.getShare * 100)
  return (
    <div className={`trade-value${f.fair ? ' fair' : ' uneven'}`} role="status">
      <div className="tv-row"><span>You get</span><b>{fmt(f.get.sum)}</b></div>
      <div className="tv-row"><span>You give</span><b>{fmt(f.give.sum)}</b></div>
      <div
        className="tv-bar"
        role="img"
        aria-label={`You get ${getPct}% of the value, you give ${100 - getPct}%`}
      >
        <span className="tv-bar-get" style={{ width: `${getPct}%` }} />
        <span className="tv-bar-give" style={{ width: `${100 - getPct}%` }} />
        <i className="tv-bar-mid" aria-hidden />
      </div>
      <div className="tv-bar-labels dim" aria-hidden><span>You get</span><span>You give</span></div>
      <div className="tv-verdict">
        <Icon name={f.fair ? 'balance' : 'warning'} aria-hidden />
        {verdictLine(f, fmt)}
      </div>
      {unpriced && <div className="dim tv-note">{unpriced}</div>}
      {side && suggestions.length > 0 && onAdd && (
        <div className="tv-even">
          <div className="tv-even-title">{evenOutTitle(side, friendName ?? 'them')}</div>
          {suggestions.map((s) => (
            <div key={`${s.card.collectionId ?? ''}:${s.card.scryfallId}`} className="tv-even-row">
              <span className="tv-even-name">{s.card.name}{s.card.foil ? ' · foil' : ''}</span>
              <span className="tv-even-price">{fmt(s.price)}</span>
              <button type="button" className="btn line sm" onClick={() => onAdd(side, s.card)}>
                <Icon name="add" aria-hidden />{addLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
