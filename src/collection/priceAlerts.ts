// Price alerts: on wishlist cards, a price per card to hear about when the card is at or under it;
// on owned binder cards, a price to hear about when it rises to or over it. When each goes off is
// priceAlertRules.ts. The web app checks when it's opened (Home); the Android app also checks in the
// background. Prices are Scryfall's (USD), which it updates once a day.

import { currentMoney } from '../money/currency'
import { useEffect, useState } from 'react'
import { getCardsByIds, getPrintings } from '../api/scryfall'
import type { Collection, CollectionEntry } from '../types/models'
import { alertHits, alertNotification, alertPrice, alertStep, alertWatches, byDirection, memoryKey, priceKey, type AlertHit, type AlertWatch } from './priceAlertRules'
import { cheapestPrinting, type PrintingPrice } from './wishlistTargets'
import { recordCardPrices } from './priceHistoryStore'

/** Scryfall's prices change once a day: checking more often than this is wasted. */
const CHECK_EVERY_MS = 60 * 60 * 1000
const SEEN_KEY = 'mtgweb_price_alerts_seen'
const GOT_IT_KEY = 'mtgweb_wishlist_got_it'
const CHECKED_KEY = 'mtgweb_price_alerts_checked'

/** A US dollar price in the currency prices show in (Account → Prices). Components use useMoney() so they follow a change. */
export const formatUsd = (v: number) => currentMoney().format(v)

/** The prices (USD, non-foil) of [entries] — undefined while loading, null for a card with none. */
export function usePrices(entries: CollectionEntry[], enabled = true): Map<string, number | null> | undefined {
  const pairs = usePricePairs(entries, enabled)
  return pairs && new Map([...pairs].map(([id, [plain]]) => [id, plain]))
}

/** The prices (USD: non-foil, foil) of [entries] — undefined while loading, null for one there's none of. */
export function usePricePairs(entries: CollectionEntry[], enabled = true): Map<string, [number | null, number | null]> | undefined {
  const [prices, setPrices] = useState<Map<string, [number | null, number | null]> | undefined>(undefined)
  const key = enabled ? entries.map((e) => e.scryfallId).sort().join(',') : ''
  useEffect(() => {
    if (!key) { setPrices(new Map()); return }
    let cancelled = false
    getCardsByIds(key.split(','))
      .then((cards) => {
        if (cancelled) return
        setPrices(new Map(cards.map((c): [string, [number | null, number | null]] => [c.id, [usd(c.prices?.usd), usd(c.prices?.usd_foil)]])))
      })
      .catch(() => { if (!cancelled) setPrices(new Map()) })
    return () => { cancelled = true }
  }, [key])
  return prices
}

/** The Wishlist's "Got it"s (see wishlistTargets.ts underYourPrice): card → its price then. This browser only. */
export function readGotIt(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(GOT_IT_KEY) ?? '{}') ?? {} } catch { return {} }
}

export function writeGotIt(gotIt: Record<string, number>) {
  try { localStorage.setItem(GOT_IT_KEY, JSON.stringify(gotIt)) } catch { /* this visit only */ }
}

function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') } catch { return {} }
}

/** The prices last fetched for the alerts (non-foil, foil), kept for this visit so Home doesn't ask again each time. */
let lastPrices: { key: string; at: number; prices: Map<string, [number | null, number | null]> } | null = null
/** The banner the user closed, by what it listed; it comes back when the list changes. */
let dismissedKey: string | null = null

function usd(v: string | null | undefined): number | null { return v ? Number(v) : null }
const hitsKey = (hits: AlertHit[]) => hits.map((h) => `${memoryKey(h.watch)}@${h.price}`).sort().join(',')

/** Each card's printings' prices, by name, kept for this visit as long as the alert prices are. */
const printingsSeen = new Map<string, { at: number; prices: PrintingPrice[] }>()

/** Every printing of [name] with its prices; none when Scryfall can't be reached. */
async function printingPrices(name: string): Promise<PrintingPrice[]> {
  const had = printingsSeen.get(name.toLowerCase())
  if (had && Date.now() - had.at < CHECK_EVERY_MS) return had.prices
  const prices = (await getPrintings(name).catch(() => [])).map((c) => ({ name: c.name, usd: usd(c.prices?.usd), usdFoil: usd(c.prices?.usd_foil) }))
  printingsSeen.set(name.toLowerCase(), { at: Date.now(), prices })
  return prices
}

/**
 * [fetched] (each watched printing's prices, by scryfallId) with, for each watch any printing of
 * which counts, the cheapest printing's prices under its priceKey — its own printing's when the
 * others can't be had.
 */
async function withAnyPrinting(watches: AlertWatch[], fetched: Map<string, [number | null, number | null]>): Promise<Map<string, [number | null, number | null]>> {
  const out = new Map(fetched)
  for (const w of watches) {
    const key = priceKey(w)
    if (key === w.entry.scryfallId || out.has(key)) continue
    const own = fetched.get(w.entry.scryfallId)
    const all = [...(await printingPrices(w.entry.name)), ...(own ? [{ name: w.entry.name, usd: own[0], usdFoil: own[1] }] : [])]
    out.set(key, cheapestPrinting(w.entry.name, all))
  }
  return out
}

/**
 * Price alerts past their line now — wishlist cards at or under theirs, owned cards at or over
 * theirs — for Home's banner. Checks at most hourly (and again every hour while the app stays open);
 * a card crossing for the first time, or moving further past, also shows a phone/desktop
 * notification when the user has allowed them and the app is in the background. The same check notes
 * each watched card's prices for its price history.
 */
export function usePriceAlertHits(collections: Collection[]): {
  hits: AlertHit[]
  dismiss: () => void
  /** Every hit, dismissed or not — undefined until the prices are in. */
  allHits: AlertHit[] | undefined
  /** The prices the alerts were checked against (priceKey → non-foil, foil US dollars); undefined until they're in. */
  prices: Map<string, [number | null, number | null]> | undefined
} {
  const watches = alertWatches(collections)
  // A rise alert on all-foil copies watches the foil price, so the copies are part of what's checked;
  // and a wishlist target's options, which say which price.
  const key = watches.map((w) => `${memoryKey(w)}${w.direction === 'BELOW' ? '<' : '>'}${w.target}${w.entry.quantity <= 0 ? 'f' : ''}${w.entry.alertAnyPrinting ? 'a' : ''}${w.entry.alertFoilOnly ? 'F' : ''}:${w.entry.name}`).sort().join(',')
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
      .then(async (cards) => {
        if (cancelled) return
        // Each card's own prices, for its price history (see cardPriceHistory.ts).
        void recordCardPrices(new Map(cards.map((c) => [c.id, c.prices])))
        const own = new Map(cards.map((c): [string, [number | null, number | null]] => [c.id, [usd(c.prices?.usd), usd(c.prices?.usd_foil)]]))
        // A target any printing of which counts is checked against the cheapest printing.
        const fetched = await withAnyPrinting(watches, own)
        if (cancelled) return
        lastPrices = { key, at: Date.now(), prices: fetched }
        setPrices(fetched)
        if (!told) return
        try { sessionStorage.setItem(CHECKED_KEY, JSON.stringify({ at: Date.now(), key })) } catch { /* not kept */ }
        const seen = readSeen()
        const fresh: AlertHit[] = []
        for (const w of watches) {
          const p = fetched.get(priceKey(w))
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
    allHits: prices ? hits : undefined,
    prices: prices ?? undefined,
  }
}

/** Asks once for permission to show notifications, when the user first sets an alert. */
export function askForNotifications() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {})
  }
}
