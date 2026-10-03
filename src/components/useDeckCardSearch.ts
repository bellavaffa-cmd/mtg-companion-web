import { useEffect, useRef, useState } from 'react'
import { searchCards } from '../api/scryfall'
import { findCombosInDeck, relayAvailable } from '../api/relay'
import { ADD_SEARCH_PAUSE_MS, addSearchQuery, latestOnly } from '../decks/addSearch'
import { NO_COMBO_PIECES, comboLookupNames, comboPieces, type ComboPieces } from '../decks/comboPieces'
import type { Deck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

/**
 * Scryfall's cards for what's typed in a deck's search, once three letters are typed and typing
 * pauses. Empty for anything shorter. A failed search shows nothing, as on the phone.
 */
export function useAddSearch(typed: string): ScryfallCard[] {
  const [results, setResults] = useState<ScryfallCard[]>([])
  const requests = useRef(latestOnly())
  const query = addSearchQuery(typed)

  useEffect(() => {
    // Every change starts a new request, even an empty one, so an answer still on its way for an
    // older query is dropped when it arrives.
    const isLatest = requests.current.start()
    if (!query) {
      setResults([])
      return
    }
    const timer = window.setTimeout(() => {
      searchCards(query)
        .then((page) => { if (isLatest()) setResults(page.cards) })
        .catch(() => { if (isLatest()) setResults([]) })
    }, ADD_SEARCH_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  return query ? results : []
}

/**
 * The deck's cards that are pieces of a combo it has, or of one it's a card short of, from
 * Commander Spellbook. Nothing until that answers, and nothing at all without the relay.
 */
export function useComboPieces(deck: Deck | undefined): ComboPieces {
  const [found, setFound] = useState<ComboPieces>(NO_COMBO_PIECES)
  const names = deck ? comboLookupNames(deck) : { commanders: [], main: [] }
  const allNames = [...names.commanders, ...names.main]
  // What the lookup depends on: re-run it only when the decklist itself changes.
  const key = `${names.commanders.join('|')}#${[...names.main].sort().join('|')}`

  useEffect(() => {
    if (!relayAvailable || allNames.length === 0) return
    let cancelled = false
    findCombosInDeck(names.commanders, names.main)
      .then((combos) => { if (!cancelled) setFound(comboPieces(combos, allNames)) })
      .catch(() => { /* Spellbook out of reach: no badges, as if none were found. */ })
    return () => { cancelled = true }
    // key captures every name the lookup depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // A previous decklist's answer still applies to the cards both lists share, so it's kept until the
  // new one arrives rather than every badge blinking off at each edit.
  return found
}
