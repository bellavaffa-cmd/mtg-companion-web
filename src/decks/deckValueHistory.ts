// Each deck's value over time: one point a day, the deck's total (in US dollars, worked out the way
// its Stats do — every main-deck copy at its printing's price), noted in this browser whenever the
// deck's prices are looked up — opening the deck, or once a day for every deck when the decks list
// opens. Kept on this device only, like the collection's value history (collection/valueHistory.ts),
// whose points and ranges it shares. Mirrors the Android app's data/DeckValueHistory.kt.

import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { changeOf, pointsIn, today, withPoint, type ValueChange, type ValuePoint } from '../collection/valueHistory'
import type { Deck } from '../types/models'
import { isArchived } from './deckFolders'

/** About thirteen months of days, per deck. */
export const DECK_KEEP = 400

/** Points by deck id, oldest first. */
export type DeckValueHistory = Record<string, ValuePoint[]>

/**
 * The deck's value from [prices] (scryfallId → US dollars; null: looked up, but no price), and how
 * many cards it's of. Null when under 98% of the deck's copies were looked up — a dropped request
 * mustn't read as a crash in value.
 */
export function deckValueOf(deck: Deck, prices: Map<string, number | null>): { usd: number; cards: number } | null {
  let usd = 0
  let cards = 0
  let known = 0
  for (const e of deck.cards) {
    cards += e.quantity
    if (!prices.has(e.scryfallId)) continue
    known += e.quantity
    usd += (prices.get(e.scryfallId) ?? 0) * e.quantity
  }
  if (cards === 0 || known < cards * 0.98) return null
  return { usd: Math.round(usd * 100) / 100, cards }
}

/** [history] with [point] as [deckId]'s for its day. */
export function withDeckPoint(history: DeckValueHistory, deckId: string, point: ValuePoint, keep = DECK_KEEP): DeckValueHistory {
  return { ...history, [deckId]: withPoint(history[deckId] ?? [], point, keep) }
}

/** The decks that have no point for [day] yet — not archived, and with cards. */
export function decksDue(history: DeckValueHistory, decks: Deck[], day: string): Deck[] {
  return decks.filter((d) => !isArchived(d) && d.cards.length > 0 && history[d.id]?.[history[d.id].length - 1]?.date !== day)
}

/** [history] with only the decks still there. */
export function prunedDeckHistory(history: DeckValueHistory, deckIds: string[]): DeckValueHistory {
  const keep = new Set(deckIds)
  return Object.fromEntries(Object.entries(history).filter(([id]) => keep.has(id)))
}

/** How the value moved over the last month of [points]; null under two points. */
export const monthChange = (points: ValuePoint[]): ValueChange | null => changeOf(pointsIn(points, '1M'))

// ---- Kept in this browser ----

const HISTORY_KEY = 'mtgweb_deck_value_history'
const listeners = new Set<() => void>()
let history: DeckValueHistory = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, { d: string; v: number; n: number }[]>
    return Object.fromEntries(Object.entries(raw).map(([id, list]) => [id, list.map((p) => ({ date: p.d, usd: p.v, cards: p.n }))]))
  } catch {
    return {}
  }
})()

function save(next: DeckValueHistory) {
  history = next
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(Object.entries(history).map(([id, list]) => [id, list.map((p) => ({ d: p.date, v: p.usd, n: p.cards }))]))))
  } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

/** Notes today's value of a deck. */
export function recordDeckValue(deckId: string, usd: number, cards: number) {
  save(withDeckPoint(history, deckId, { date: today(), usd: Math.round(usd * 100) / 100, cards }))
}

/** A deck's value history, oldest first, re-rendering when a point is added. */
export function useDeckValueHistory(deckId: string): ValuePoint[] {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return history[deckId] ?? []
}

let sampledOn = ''

/**
 * Once a day, while the decks list is open: today's value of every deck that has none yet, from one
 * lookup of all their cards. Points of decks that are gone are forgotten.
 */
export function useDeckValueSampler(decks: Deck[]) {
  const due = decksDue(history, decks, today())
  const key = due.map((d) => d.id).join(',')
  useEffect(() => {
    if (decks.length > 0 && Object.keys(history).some((id) => !decks.some((d) => d.id === id))) {
      save(prunedDeckHistory(history, decks.map((d) => d.id)))
    }
    if (!key || sampledOn === today()) return
    sampledOn = today()
    const ids = [...new Set(due.flatMap((d) => d.cards.map((c) => c.scryfallId)))]
    void getCardsByIds(ids).then((cards) => {
      const prices = new Map<string, number | null>(cards.map((c) => [c.id, c.prices?.usd ? Number(c.prices.usd) : null]))
      for (const d of due) {
        const value = deckValueOf(d, prices)
        if (value) recordDeckValue(d.id, value.usd, value.cards)
      }
    }).catch(() => { sampledOn = '' })
    // key stands for the decks due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
