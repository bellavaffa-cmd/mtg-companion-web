// The cards the user owns, gathered across their binders — for the automatic tag binders and a
// deck's "you own N more" gaps. Kept apart from TagBinders.tsx so tests can run it.

import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { cachedIdentity, cachedTags } from '../tags/roleTags'

/** One card the user owns, however many binders its copies are spread over. */
export interface OwnedCard {
  key: string
  name: string
  scryfallId: string
  imageUrl: string | null
  backImageUrl?: string | null
  copies: number
  /** Where the copies are: binder name and how many. */
  where: { collectionId: string; name: string; copies: number }[]
}

/** Every card in the user's own binders (and the Unsorted pile) — not their wishlists. */
export function ownedCards(collections: Collection[]): OwnedCard[] {
  const byName = new Map<string, OwnedCard>()
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      const copies = e.quantity + e.foilQuantity
      if (copies <= 0) continue
      const key = e.name.trim().toLowerCase()
      const card = byName.get(key) ?? { key, name: e.name, scryfallId: e.scryfallId, imageUrl: e.imageUrl, backImageUrl: e.backImageUrl, copies: 0, where: [] }
      card.copies += copies
      const here = card.where.find((w) => w.collectionId === c.id)
      if (here) here.copies += copies
      else card.where.push({ collectionId: c.id, name: c.name, copies })
      byName.set(key, card)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Cards the user owns that do [tagId]'s job and aren't in [deck] yet — for a deck short of ramp,
 * say, the ramp already in their binders. With a commander, only cards in its colours (and none
 * until the commander's colours are known). The Android app's ownedForTag is the same.
 */
export function ownedForTag(
  owned: OwnedCard[],
  deck: Deck,
  tagId: string,
  tagsOfCard: (name: string) => string[] | undefined = cachedTags,
  identityOf: (name: string) => string | undefined = cachedIdentity,
): OwnedCard[] {
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
  let colours: Set<string> | null = null
  if (commanders.length) {
    const ids = commanders.map((c) => identityOf(c.name))
    if (ids.some((id) => id == null)) return []
    colours = new Set(ids.join(''))
  }
  const inDeck = new Set([...deck.cards, ...commanders].map((c) => c.name.trim().toLowerCase()))
  return owned.filter((card) => {
    if (inDeck.has(card.key) || !tagsOfCard(card.name)?.includes(tagId)) return false
    if (!colours) return true
    const id = identityOf(card.name)
    return id != null && [...id].every((c) => colours.has(c))
  })
}
