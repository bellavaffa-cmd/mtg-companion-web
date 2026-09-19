// Price alerts on wishlist cards: the user sets a price per card, and hears about it when the card
// is at or under it. The web app checks when it's opened (Home); the Android app also checks in the
// background. Prices are Scryfall's (USD, non-foil), which it updates once a day.

import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { Collection, CollectionEntry } from '../types/models'

export interface PriceAlertHit {
  collectionId: string
  entry: CollectionEntry
  price: number
}

/** Scryfall's prices change once a day: checking more often than this is wasted. */
const CHECK_EVERY_MS = 60 * 60 * 1000
const SEEN_KEY = 'mtgweb_price_alerts_seen'
const CHECKED_KEY = 'mtgweb_price_alerts_checked'

export const formatUsd = (v: number) => `$${v.toFixed(2)}`

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

/**
 * Wishlist cards now at or under their alert price, and not already told about at this price (a card
 * is told about again only when it drops further, or after going back over and dropping again).
 * Checks at most hourly; shows a phone/desktop notification too when the user has allowed them.
 */
export function usePriceAlertHits(collections: Collection[]): { hits: PriceAlertHit[]; dismiss: () => void } {
  const [hits, setHits] = useState<PriceAlertHit[]>([])
  // Checked again every hour while the app stays open (a notification then, if it's in the background).
  const [hour, setHour] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setHour((h) => h + 1), CHECK_EVERY_MS)
    return () => window.clearInterval(t)
  }, [])
  const watched = collections
    .filter((c) => c.type === 'WISHLIST')
    .flatMap((c) => c.entries.filter((e) => (e.priceAlert ?? 0) > 0).map((entry) => ({ collectionId: c.id, entry })))
  const key = watched.map((w) => `${w.entry.scryfallId}<${w.entry.priceAlert}`).sort().join(',')

  useEffect(() => {
    if (!key) return
    // Once an hour per set of alerts, not on every visit to Home.
    let last: { at: number; key: string } | null = null
    try { last = JSON.parse(sessionStorage.getItem(CHECKED_KEY) ?? 'null') } catch { /* not kept */ }
    if (last && last.key === key && Date.now() - last.at < CHECK_EVERY_MS - 60_000) return
    let cancelled = false
    getCardsByIds(watched.map((w) => w.entry.scryfallId))
      .then((cards) => {
        if (cancelled) return
        try { sessionStorage.setItem(CHECKED_KEY, JSON.stringify({ at: Date.now(), key })) } catch { /* not kept */ }
        const price = new Map(cards.map((c) => [c.id, c.prices?.usd ? Number(c.prices.usd) : null]))
        const seen = readSeen()
        const fresh: PriceAlertHit[] = []
        for (const w of watched) {
          const p = price.get(w.entry.scryfallId)
          if (p == null) continue
          if (p > (w.entry.priceAlert ?? 0)) { delete seen[w.entry.scryfallId]; continue }
          if (seen[w.entry.scryfallId] !== undefined && p >= seen[w.entry.scryfallId]) continue
          seen[w.entry.scryfallId] = p
          fresh.push({ ...w, price: p })
        }
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch { /* not kept */ }
        if (fresh.length === 0) return
        setHits(fresh)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          const first = fresh[0]
          const body = fresh.length === 1
            ? `${first.entry.name} is ${formatUsd(first.price)} — under your ${formatUsd(first.entry.priceAlert ?? 0)} alert`
            : `${fresh.length} wishlist cards are under your alert prices`
          try { new Notification('MTG Companion', { body, icon: first.entry.imageUrl ?? undefined }) } catch { /* not allowed here */ }
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // [key] covers [watched]: a fresh array every render would restart the check forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hour])

  return { hits, dismiss: () => setHits([]) }
}

/** Asks once for permission to show notifications, when the user first sets an alert. */
export function askForNotifications() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {})
  }
}
