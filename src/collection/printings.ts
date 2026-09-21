/**
 * Switching a card to a different printing — another art, another set — wherever it sits: a
 * binder, a deck, or everywhere the collection holds it. What changes is which card it is and what
 * it looks like; how many there are, which are foil, a price alert, and which copies are proxies
 * all stay. Mirrors the Android app's data/Printings.kt.
 *
 * If the printing chosen is one the binder or deck already holds, the two become one entry with
 * the copies added together — two entries for the same printing would each show half the count.
 */

import type { CollectionEntry, Deck, DeckCardEntry } from '../types/models'
import { proxyCopies } from '../decks/proxies'
import { backImageUrl, cardTags, displayImageUrl, partnerAbility, type ScryfallCard } from '../types/scryfall'

/** [entries] with the copies of [oldId] moved to [card]'s printing. The same array when there's nothing to change. */
export function withEntryPrinting(entries: CollectionEntry[], oldId: string, card: ScryfallCard): CollectionEntry[] {
  if (oldId === card.id) return entries
  const old = entries.find((e) => e.scryfallId === oldId)
  if (!old) return entries
  if (entries.some((e) => e.scryfallId === card.id)) {
    return entries
      .filter((e) => e.scryfallId !== oldId)
      .map((e) => (e.scryfallId !== card.id ? e : {
        ...e,
        quantity: e.quantity + old.quantity,
        foilQuantity: e.foilQuantity + old.foilQuantity,
      }))
  }
  return entries.map((e) => (e.scryfallId !== oldId ? e : {
    ...e,
    scryfallId: card.id,
    name: card.name,
    imageUrl: displayImageUrl(card),
    backImageUrl: backImageUrl(card),
    tags: cardTags(card),
  }))
}

/** A deck entry turned into [card]'s printing, everything about the copies kept. */
function retarget(entry: DeckCardEntry, card: ScryfallCard): DeckCardEntry {
  return {
    ...entry,
    scryfallId: card.id,
    name: card.name,
    imageUrl: displayImageUrl(card),
    typeLine: card.type_line ?? entry.typeLine,
    partnerAbility: partnerAbility(card),
    backImageUrl: backImageUrl(card),
    tags: cardTags(card),
  }
}

/** [deck] with [oldId] switched to [card]'s printing — its cards and, if it's one, its commander. The same deck when there's nothing to change. */
export function withDeckPrinting(deck: Deck, oldId: string, card: ScryfallCard): Deck {
  if (oldId === card.id) return deck
  const inCards = deck.cards.some((e) => e.scryfallId === oldId)
  const isCommander = deck.commander?.scryfallId === oldId || deck.partnerCommander?.scryfallId === oldId
  if (!inCards && !isCommander) return deck

  let cards = deck.cards
  const old = deck.cards.find((e) => e.scryfallId === oldId)
  const already = deck.cards.find((e) => e.scryfallId === card.id)
  if (old && already) {
    // One entry, the copies added together. Proxies are counted out of each before they're
    // joined: "unset" means something different on its own than it does beside a number.
    const bothUnset = old.proxyQuantity === undefined && already.proxyQuantity === undefined
    const merged: DeckCardEntry = {
      ...already,
      quantity: already.quantity + old.quantity,
      proxyQuantity: bothUnset ? undefined : proxyCopies(deck, already) + proxyCopies(deck, old),
    }
    cards = deck.cards.filter((e) => e.scryfallId !== oldId).map((e) => (e.scryfallId === card.id ? merged : e))
  } else if (old) {
    cards = deck.cards.map((e) => (e.scryfallId === oldId ? retarget(e, card) : e))
  }

  const commander = deck.commander?.scryfallId === oldId ? retarget(deck.commander, card) : deck.commander
  const partnerCommander = deck.partnerCommander?.scryfallId === oldId ? retarget(deck.partnerCommander, card) : deck.partnerCommander
  return { ...deck, cards, commander, partnerCommander }
}
