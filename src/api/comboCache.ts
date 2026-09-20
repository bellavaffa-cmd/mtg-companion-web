/**
 * The combos each card is in, kept in this browser. Commander Spellbook has to be reached through
 * the relay and the lookup takes about a second, so the same card is never asked for twice: what
 * came back is kept for a week, "no combos" included. Mirrors the Android app's data/ComboCache.kt.
 */

import type { ComboVariant, DeckCombos } from './relay'

/** How long an answer is trusted. Combos change when cards are printed or banned, not by the hour. */
export const TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Cards kept; the ones asked for longest ago go first. */
export const KEEP = 200

export interface ComboEntry { at: number; variants: ComboVariant[] }
export type ComboStore = Record<string, ComboEntry>

export const cacheKey = (cardName: string) => cardName.trim().toLowerCase()

/**
 * A combo as the card view shows it: which cards it takes and what it does. Spellbook also sends
 * every card's art and a step-by-step description, which this app doesn't show — and keeping them
 * would make the cache about twenty times the size.
 */
export function trim(variant: ComboVariant): ComboVariant {
  return {
    id: variant.id,
    uses: variant.uses.map((use) => ({ card: { name: use.card.name } })),
    produces: variant.produces.map((p) => ({ feature: { name: p.feature.name } })),
  }
}

/** What [store] holds for [cardName], or undefined when it isn't held or is a week old. */
export function cacheGet(store: ComboStore, cardName: string, now = Date.now()): ComboVariant[] | undefined {
  const entry = store[cacheKey(cardName)]
  if (!entry || now - entry.at > TTL_MS) return undefined
  return entry.variants
}

/** [store] with [variants] kept for [cardName] — an empty list ("no combos") too, since that's an answer. */
export function cachePut(store: ComboStore, cardName: string, variants: ComboVariant[], now = Date.now()): ComboStore {
  return prune({ ...store, [cacheKey(cardName)]: { at: now, variants: variants.map(trim) } }, now)
}

/** [store] without the stale cards, and no more than [KEEP] of them — the newest kept. */
export function prune(store: ComboStore, now = Date.now()): ComboStore {
  const fresh = Object.entries(store).filter(([, e]) => now - e.at <= TTL_MS)
  const kept = fresh.sort(([, a], [, b]) => b.at - a.at).slice(0, KEEP)
  return Object.fromEntries(kept)
}

/** Decklists kept. A deck's answer is only good for that exact list, so a few is plenty. */
export const KEEP_DECKS = 20

export interface DeckComboEntry { at: number; combos: DeckCombos }
export type DeckComboStore = Record<string, DeckComboEntry>

/**
 * A decklist's key: its commanders and its cards, so a deck that's edited asks again while two
 * decks holding the same cards share the one answer.
 */
export function deckKey(commanders: string[], cards: string[]): string {
  const names = (list: string[]) => [...new Set(list.map(cacheKey))].sort().join('|')
  return `${names(commanders)}#${names(cards)}`
}

/** What [store] holds for the decklist [key], or undefined when it isn't held or is a week old. */
export function deckGet(store: DeckComboStore, key: string, now = Date.now()): DeckCombos | undefined {
  const entry = store[key]
  if (!entry || now - entry.at > TTL_MS) return undefined
  return entry.combos
}

/** [store] with [combos] kept for the decklist [key], trimmed to what the deck panel shows. */
export function deckPut(store: DeckComboStore, key: string, combos: DeckCombos, now = Date.now()): DeckComboStore {
  const entry = { at: now, combos: { included: combos.included.map(trim), almostIncluded: combos.almostIncluded.map(trim) } }
  return deckPrune({ ...store, [key]: entry }, now)
}

/** [store] without the stale decklists, and no more than [KEEP_DECKS] — the newest kept. */
export function deckPrune(store: DeckComboStore, now = Date.now()): DeckComboStore {
  const fresh = Object.entries(store).filter(([, e]) => now - e.at <= TTL_MS)
  return Object.fromEntries(fresh.sort(([, a], [, b]) => b.at - a.at).slice(0, KEEP_DECKS))
}

const STORAGE_KEY = 'mtgweb_combo_cache'

let store: ComboStore = (() => {
  try {
    return prune(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ComboStore)
  } catch {
    return {}
  }
})()

/** The combos kept for [cardName], or undefined to go and ask. */
export function cachedCombos(cardName: string): ComboVariant[] | undefined {
  return cacheGet(store, cardName)
}

/** Keeps what came back for [cardName]; a browser that won't store it just asks again next time. */
export function keepCombos(cardName: string, variants: ComboVariant[]) {
  store = cachePut(store, cardName, variants)
  save(STORAGE_KEY, store)
}

const DECK_STORAGE_KEY = 'mtgweb_deck_combos'

let deckStore: DeckComboStore = (() => {
  try {
    return deckPrune(JSON.parse(localStorage.getItem(DECK_STORAGE_KEY) ?? '{}') as DeckComboStore)
  } catch {
    return {}
  }
})()

/** The combos kept for a decklist, or undefined to go and ask. */
export function cachedDeckCombos(key: string): DeckCombos | undefined {
  return deckGet(deckStore, key)
}

/** Keeps what came back for a decklist. */
export function keepDeckCombos(key: string, combos: DeckCombos) {
  deckStore = deckPut(deckStore, key, combos)
  save(DECK_STORAGE_KEY, deckStore)
}

function save(storageKey: string, value: unknown) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Full or blocked storage: this visit still has it in memory.
  }
}
