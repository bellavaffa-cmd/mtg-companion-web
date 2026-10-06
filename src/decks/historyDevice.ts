// This browser as the deck history knows it (decks/deckHistory.ts): an install id kept in
// localStorage, so its entries read "this browser" here and edits in one sitting fold together, and
// the deck's value from the prices already looked up on this visit.

import { knownCards } from '../collection/cardData'
import { deckValueOf } from './deckValueHistory'
import type { HistoryContext } from './deckHistory'
import type { Deck } from '../types/models'

const DEVICE_KEY = 'manabind.historyDevice'
let device: string | null = null

/** This browser's install id: eight letters and digits, made the first time it's asked for. */
export function historyDevice(): string {
  if (device) return device
  try {
    device = localStorage.getItem(DEVICE_KEY)
    if (!device) {
      device = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      localStorage.setItem(DEVICE_KEY, device)
    }
  } catch {
    device = device ?? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  }
  return device
}

/** A new entry id: twelve letters and digits. */
export const historyId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

/** The deck's value from the prices this visit has looked up; null when too few are known. */
export function knownValueOf(deck: Deck): number | null {
  const prices = new Map<string, number | null>()
  for (const e of deck.cards) {
    const card = knownCards.get(e.scryfallId)
    if (card) prices.set(e.scryfallId, card.prices?.usd ? Number(card.prices.usd) : null)
  }
  return deckValueOf(deck, prices)?.usd ?? null
}

/** Recording on this browser, now. */
export function historyContext(now = Date.now()): HistoryContext {
  return { now, from: 'web', dev: historyDevice(), newId: historyId, valueOf: knownValueOf }
}

/** Who is looking: entries made on this browser say so. */
export const historyHere = () => ({ from: 'web', dev: historyDevice() })
