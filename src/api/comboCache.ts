/**
 * The combos each card is in, kept in this browser. Commander Spellbook has to be reached through
 * the relay and the lookup takes about a second, so the same card is never asked for twice: what
 * came back is kept for a week, "no combos" included. Mirrors the Android app's data/ComboCache.kt.
 */

import type { ComboVariant } from './relay'

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Full or blocked storage: this visit still has them in memory.
  }
}
