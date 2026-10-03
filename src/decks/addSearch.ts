/**
 * The deck search's "Add to this deck" list: cards from all of Magic matching what's typed, so a
 * card the deck doesn't have can be added without leaving for Search. Mirrors the Android app's
 * DeckDetailViewModel.addResults.
 */

import type { ScryfallCard } from '../types/scryfall'

/** Scryfall is only asked once this many letters are typed. */
export const ADD_SEARCH_MIN_LETTERS = 3
/** And only after typing pauses this long. */
export const ADD_SEARCH_PAUSE_MS = 400
/** How many of Scryfall's answers are offered. */
export const ADD_SEARCH_LIMIT = 12

/** What to ask Scryfall for [typed], or null when it's too short to ask yet. */
export function addSearchQuery(typed: string): string | null {
  const q = typed.trim()
  return q.length >= ADD_SEARCH_MIN_LETTERS ? q : null
}

/**
 * The cards to offer: Scryfall's first few, less any the deck already has by name. Like the phone,
 * the first [ADD_SEARCH_LIMIT] are taken before the deck's own are dropped.
 */
export function addableCards(results: ScryfallCard[], deckNames: Iterable<string>): ScryfallCard[] {
  const owned = new Set(deckNames)
  return results.slice(0, ADD_SEARCH_LIMIT).filter((card) => !owned.has(card.name))
}

/**
 * Numbers each request, so an answer that comes back after a newer request was made is known to be
 * stale and dropped — an older query's results never replace a newer one's.
 */
export function latestOnly() {
  let latest = 0
  return {
    /** Starts a request: the function answers whether it's still the newest. */
    start(): () => boolean {
      const id = ++latest
      return () => id === latest
    },
  }
}
