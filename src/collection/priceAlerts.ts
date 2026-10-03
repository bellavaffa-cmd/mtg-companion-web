// Price alerts: on wishlist cards, a price per card to hear about when the card is at or under it;
// on owned binder cards, a price to hear about when it rises to or over it. When each goes off is
// priceAlertRules.ts. The web app checks when it's opened (Home); the Android app also checks in the
// background. Prices are Scryfall's (USD), which it updates once a day.

import { currentMoney } from '../money/currency'
import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { Collection, CollectionEntry } from '../types/models'
import { alertHits, alertNotification, alertPrice, alertStep, alertWatches, byDirection, memoryKey, type AlertHit } from './priceAlertRules'
import { recordCardPrices } from './priceHistoryStore'

/** Scryfall's prices change once a day: checking more often than this is wasted. */
const CHECK_EVERY_MS = 60 * 60 * 1000
const SEEN_KEY = 'mtgweb_price_alerts_seen'
const CHECKED_KEY = 'mtgweb_price_alerts_checked'

/** A US dollar price in the currency prices show in (Account → Prices). Components use useMoney() so they follow a change. */
export const formatUsd = (v: number) => currentMoney().format(v)

/** The prices (USD, non-foil) of [entries] — undefined while loading, null for a card with none. */
export function usePrices(entries: CollectionEntry[], enabled = true): Map<string, number | null> | undefined {
  const [prices, setPrices] = useState<Map<string, number | null> | undefined>(undefined)
  const key = enabled ? entries.map((e) => e.scryfallId).sort().join(',') : ''
  useEffect(() => {
    if (!key) { setPrices(new Map()); return }
    let cancelled = false
    getCardsByIds(key.split(','))
      .then((cards) => {
        if (cancelled) return
        setPrices(new Map(cards.map((c) => [c.id, c.prices?.usd ? Number(c.prices.usd) : null])))
      })
      .catch(() => { if (!cancelled) setPrices(new Map()) })
    return () => { cancelled = true }
  }, [key])
  return prices
}

function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') } catch { return {} }
}

/** The prices last fetched for the alerts (non-foil, foil), kept for this visit so Home doesn't ask again each time. */
let lastPrices: { key: string; at: number; prices: Map<string, [number | null, number | null]> } | null = null
/** The banner the user closed, by what it listed; it comes back when the list changes. */
let dismissedKey: string | null = null

const usd = (v: string | null | undefined) => (v ? Number(v) : null)
const hitsKey = (hits: AlertHit[]) => hits.map((h) => `${memoryKey(h.watch)}@${h.price}`).sort().join(',')

/**
 * Price alerts past their line now — wishlist cards at or under theirs, owned cards at or over
 * theirs — for Home's banner. Checks at most hourly (and again every hour while the app stays open);
 * a card crossing for the first time, or moving further past, also shows a phone/desktop
 * notification when the user has allowed them and the app is in the background. The same check notes
 * each watched card's prices for its price history.
 */
export function usePriceAlertHits(collections: Collection[]): { hits: AlertHit[]; dismiss: () => void } {
  const watches = alertWatches(collections)
  // A rise alert on all-foil copies watches the foil price, so the copies are part of what's checked.
  const key = watches.map((w) => `${memoryKey(w)}${w.direction === 'BELOW' ? '<' : '>'}${w.target}${w.entry.quantity <= 0 ? 'f' : ''}`).sort().join(',')
  const [prices, setPrices] = useState(() => (lastPrices && lastPrices.key === key ? lastPrices.prices : null))
  const [dismissed, setDismissed] = useState(dismissedKey)
  // Checked again every hour while the app stays open (a notification then, if it's in the background).
  const [hour, setHour] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setHour((h) => h + 1), CHECK_EVERY_MS)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!key) { setPrices(null); return }
    // Once an hour per set of alerts, not on every visit to Home.
    if (lastPrices && lastPrices.key === key && Date.now() - lastPrices.at < CHECK_EVERY_MS - 60_000) {
      setPrices(lastPrices.prices)
      return
    }
    let last: { at: number; key: string } | null = null
    try { last = JSON.parse(sessionStorage.getItem(CHECKED_KEY) ?? 'null') } catch { /* not kept */ }
    const told = !(last && last.key === key && Date.now() - last.at < CHECK_EVERY_MS - 60_000)
    let cancelled = false
    getCardsByIds(watches.map((w) => w.entry.scryfallId))
      .then((cards) => {
        if (cancelled) return
        // Each card's own prices, for its price history (see cardPriceHistory.ts).
        void recordCardPrices(new Map(cards.map((c) => [c.id, c.prices])))
        const fetched = new Map(cards.map((c): [string, [number | null, number | null]] => [c.id, [usd(c.prices?.usd), usd(c.prices?.usd_foil)]]))
        lastPrices = { key, at: Date.now(), prices: fetched }
        setPrices(fetched)
        if (!told) return
        try { sessionStorage.setItem(CHECKED_KEY, JSON.stringify({ at: Date.now(), key })) } catch { /* not kept */ }
        const seen = readSeen()
        const fresh: AlertHit[] = []
        for (const w of watches) {
          const p = fetched.get(w.entry.scryfallId)
          const price = p ? alertPrice(w, p[0], p[1]) : null
          if (price == null) continue
          const step = alertStep(w, price, seen[memoryKey(w)] ?? null)
          if (step.kind === 'forget') delete seen[memoryKey(w)]
          else if (step.kind === 'tell') {
            seen[memoryKey(w)] = step.price
            fresh.push({ watch: w, price: step.price })
          }
        }
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* not kept */ }
        const note = alertNotification(fresh, formatUsd)
        if (note && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          try { new Notification(note.title, { body: note.body, icon: fresh[0].watch.entry.imageUrl ?? undefined }) } catch { /* not allowed here */ }
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // [key] covers [watches]: a fresh array every render would restart the check forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hour])

  const hits = prices ? byDirection(alertHits(watches, prices)) : []
  const shownKey = hitsKey(hits)
  return {
    hits: hits.length > 0 && shownKey !== dismissed ? hits : [],
    dismiss: () => { dismissedKey = shownKey; setDismissed(shownKey) },
  }
}

/** Asks once for permission to show notifications, when the user first sets an alert. */
export function askForNotifications() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {})
  }
}
