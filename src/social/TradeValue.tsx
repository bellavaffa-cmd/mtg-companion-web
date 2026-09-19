import { useEffect, useState } from 'react'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { getCardsByIds } from '../api/scryfall'
import type { TradeCard } from './api'

/** Prices of [cards] (USD, and the foil price for foil copies), fetched when the list changes. */
function useTradePrices(cards: TradeCard[]) {
  const [prices, setPrices] = useState<Map<string, { usd: number | null; foil: number | null }> | null>(null)
  const key = [...new Set(cards.map((c) => c.scryfallId))].sort().join(',')
  useEffect(() => {
    if (!key) { setPrices(new Map()); return }
    let cancelled = false
    getCardsByIds(key.split(','))
      .then((list) => {
        if (cancelled) return
        setPrices(new Map(list.map((c) => [c.id, {
          usd: c.prices?.usd ? Number(c.prices.usd) : null,
          foil: c.prices?.usd_foil ? Number(c.prices.usd_foil) : null,
        }])))
      })
      .catch(() => { if (!cancelled) setPrices(null) })
    return () => { cancelled = true }
  }, [key])
  return prices
}

/**
 * Both sides' total value, and whether that's roughly even: within $2, or 10% of the bigger side.
 * Scryfall's prices are a guide (market prices, updated daily), not an appraisal.
 */
export function TradeValue({ get, give }: { get: TradeCard[]; give: TradeCard[] }) {
  const prices = useTradePrices([...get, ...give])
  // Worked out in US dollars (within $2 or a tenth is fair), shown in the chosen currency.
  const money = useMoney()
  const usd = (v: number) => money.format(v)
  if (get.length + give.length === 0) return null
  if (!prices) return <div className="trade-value dim">Couldn't load prices.</div>
  const total = (cards: TradeCard[]) => {
    let sum = 0
    let unpriced = 0
    for (const c of cards) {
      const p = prices.get(c.scryfallId)
      const each = c.foil ? p?.foil ?? p?.usd : p?.usd ?? p?.foil
      if (each == null) unpriced += c.quantity
      else sum += each * c.quantity
    }
    return { sum, unpriced }
  }
  const mine = total(get)
  const theirs = total(give)
  // Nothing priced: no verdict to give.
  if (mine.sum === 0 && theirs.sum === 0) {
    return <div className="trade-value dim">There are no prices for these cards, so their value can't be compared.</div>
  }
  const diff = mine.sum - theirs.sum
  const fair = Math.abs(diff) <= Math.max(2, 0.1 * Math.max(mine.sum, theirs.sum))
  const unpriced = mine.unpriced + theirs.unpriced
  return (
    <div className={`trade-value${fair ? ' fair' : ' uneven'}`} role="status">
      <div className="tv-row"><span>You get</span><b>{usd(mine.sum)}</b></div>
      <div className="tv-row"><span>You give</span><b>{usd(theirs.sum)}</b></div>
      <div className="tv-verdict">
        <Icon name={fair ? 'balance' : 'warning'} aria-hidden />
        {fair
          ? (Math.abs(diff) < 0.005 ? 'Even — a fair trade' : `Within ${usd(Math.abs(diff))} — a fair trade`)
          : diff > 0 ? `You get ${usd(diff)} more` : `You give ${usd(-diff)} more`}
      </div>
      {unpriced > 0 && (
        <div className="dim tv-note">{unpriced} {unpriced === 1 ? 'card has no price and is' : 'cards have no price and are'} left out.</div>
      )}
    </div>
  )
}
