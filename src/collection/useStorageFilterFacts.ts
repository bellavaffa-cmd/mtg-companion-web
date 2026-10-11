// What filtering the copies in storage needs (placeFilter.ts FilterFacts), for a place's page and the
// Storage tab — the same card data, copies and tags the Cards tab judges by.

import { useMemo } from 'react'
import { useMoney } from '../money/currency'
import { useSync } from '../sync/SyncContext'
import { matchesNameOrTag, tagsOf, useRoleTags } from '../tags/roleTags'
import type { ScryfallCard } from '../types/scryfall'
import { advancedFactsOf, copyFactsOf, type AdvancedFacts } from './advancedFilter'
import { cardFactsOf, type CardFacts } from './cardFilter'
import { useCardData } from './cardData'
import type { FilterFacts } from './placeFilter'
import { namesDecksUse } from './spares'
import { placeChains, placesOf, type PlacedCard } from './storagePlaces'
import { userTagIndex } from './userTags'

/**
 * What judging [copies] needs (FilterFacts) — their cards' Scryfall data, the collection's copies,
 * what the decks use, and the role and user tags as Cards has them (for the search and the Tags
 * row) — and the data itself, for prices. [searching]: whether role tags are needed (something typed,
 * or Untagged on).
 */
export function useStorageFilterFacts(copies: PlacedCard[], searching = true): { facts: FilterFacts; data: Map<string, ScryfallCard> | undefined } {
  const { collections, decks } = useSync()
  const money = useMoney()
  const ids = useMemo(() => [...new Set(copies.map((c) => c.entry.scryfallId))], [copies])
  // Role tags are looked up only while they're needed: something typed, or the Tags row's Untagged.
  const names = useMemo(() => (searching ? [...new Set(copies.map((c) => c.entry.name))] : []), [copies, searching])
  const data = useCardData(ids)
  const { tags: roleTags } = useRoleTags(names)
  const userTags = useMemo(() => userTagIndex(decks, collections), [decks, collections])
  const copyFacts = useMemo(() => copyFactsOf(collections, decks), [collections, decks])
  const chains = useMemo(() => placeChains(placesOf(collections)), [collections])
  const usedNames = useMemo(() => namesDecksUse(decks), [decks])
  const facts = useMemo((): FilterFacts => {
    const card = new Map<string, CardFacts>()
    const advanced = new Map<string, AdvancedFacts>()
    if (data) for (const [id, c] of data) { card.set(id, cardFactsOf(c)); advanced.set(id, advancedFactsOf(c)) }
    return {
      card: (id) => card.get(id),
      advanced: (id) => advanced.get(id),
      copies: copyFacts,
      chains,
      usedNames,
      toUsd: (n) => money.toUsd(n),
      searchMatches: (c, q) => matchesNameOrTag(c.entry.name, [...tagsOf(roleTags, c.entry.name), ...(userTags.get(c.entry.scryfallId) ?? [])], q),
      roleTags: (name) => roleTags.get(name.trim().toLowerCase()),
      userTags: (id) => userTags.get(id) ?? [],
    }
  }, [data, copyFacts, chains, usedNames, money, roleTags, userTags])
  return { facts, data }
}
