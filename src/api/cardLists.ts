// Whole Scryfall searches, every page, kept for the session: the new-deck flow's list of every
// legal commander (a few thousand cards, sixteen-odd pages). Pages are fetched one after another —
// the pacing in scryfall.ts spaces them out — and whoever is watching sees each one as it arrives,
// so the first commanders show at once. Opening the picker again finds the list already here.

import { searchCards, type SearchPage } from './scryfall'
import type { ScryfallCard } from '../types/scryfall'

export interface CardListState {
  cards: ScryfallCard[]
  /** Every page is in. */
  done: boolean
  /** Why the last page didn't arrive; the cards so far stay. Opening the list again carries on. */
  error: string | null
}

/** Far more than any search here needs (Commander runs to about twenty), in case has_more never ends. */
const MOST_PAGES = 60

interface Entry {
  state: CardListState
  nextPage: number
  running: boolean
  listeners: Set<(state: CardListState) => void>
}

/** A loader over [fetchPage], so tests can hand it pages without Scryfall. */
export function createListLoader(fetchPage: (query: string, page: number) => Promise<SearchPage>) {
  const lists = new Map<string, Entry>()

  const notify = (entry: Entry) => entry.listeners.forEach((listener) => listener(entry.state))

  async function run(query: string, entry: Entry) {
    entry.running = true
    while (!entry.state.done) {
      try {
        const page = await fetchPage(query, entry.nextPage)
        const have = new Set(entry.state.cards.map((c) => c.id))
        entry.state = {
          cards: [...entry.state.cards, ...page.cards.filter((c) => !have.has(c.id))],
          done: !page.hasMore || entry.nextPage >= MOST_PAGES,
          error: null,
        }
        entry.nextPage++
      } catch (e) {
        entry.state = { ...entry.state, error: e instanceof Error ? e.message : "Couldn't reach Scryfall." }
        entry.running = false
        notify(entry)
        return
      }
      notify(entry)
    }
    entry.running = false
  }

  return {
    /**
     * Calls [onChange] with the list for [query] now and after every page, fetching what isn't here
     * yet (or carrying on after an error). Returns the way to stop listening; the fetching goes on.
     */
    watch(query: string, onChange: (state: CardListState) => void): () => void {
      let entry = lists.get(query)
      if (!entry) {
        entry = { state: { cards: [], done: false, error: null }, nextPage: 1, running: false, listeners: new Set() }
        lists.set(query, entry)
      }
      entry.listeners.add(onChange)
      onChange(entry.state)
      if (!entry.running && !entry.state.done) void run(query, entry)
      const watched = entry
      return () => { watched.listeners.delete(onChange) }
    },
  }
}

/** Every card for a search, most played on EDHREC first. */
export const allCards = createListLoader((query, page) => searchCards(query, page, 'edhrec'))
