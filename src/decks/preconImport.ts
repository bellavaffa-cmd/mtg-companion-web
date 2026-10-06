// A Commander precon copied in as a new deck with its list filled in — from the Precons page, and when
// a sealed precon is opened (collection/sealed.ts). The decklist is MTGJSON's (api/mtgjson.ts), each
// card resolved on Scryfall. Mirrors the Android app's importPreconDeck in data/PreconRepository.kt.

import { preconContents, type PreconContents } from '../api/mtgjson'
import { getCardsByIds } from '../api/scryfall'
import type { Deck, DeckCardEntry } from '../types/models'
import { backImageUrl, canBeCommander, cardTags, displayImageUrl, partnerAbility } from '../types/scryfall'

/** A precon's decklist, fetched once per visit: the preview and the import share it. */
const contentsCache = new Map<string, Promise<PreconContents>>()
export function contentsOf(fileName: string): Promise<PreconContents> {
  let found = contentsCache.get(fileName)
  if (!found) {
    found = preconContents(fileName)
    found.catch(() => contentsCache.delete(fileName))
    contentsCache.set(fileName, found)
  }
  return found
}

type CreateDeck = (name: string, cards: DeckCardEntry[], commander?: DeckCardEntry | null, partnerCommander?: DeckCardEntry | null) => Deck

/** Makes the precon in MTGJSON's [fileName] a new deck called [name]. Throws with a message to show when it can't. */
export async function importPreconDeck(fileName: string, name: string, createDeckWithCards: CreateDeck): Promise<Deck> {
  const contents = await contentsOf(fileName)
  const all = [...contents.commander, ...contents.cards]
  const ids = [...new Set(all.map((c) => c.scryfallId).filter((id): id is string => !!id))]
  if (ids.length === 0) throw new Error("Couldn't resolve any cards for this precon.")
  // Strict: a batch that fails would otherwise make a deck that's quietly missing cards.
  const byId = new Map((await getCardsByIds(ids, true)).map((card) => [card.id, card]))
  const entries: DeckCardEntry[] = []
  for (const entry of all) {
    const card = entry.scryfallId ? byId.get(entry.scryfallId) : undefined
    if (!card) continue
    entries.push({
      scryfallId: card.id,
      name: card.name,
      imageUrl: displayImageUrl(card),
      quantity: entry.quantity,
      canBeCommander: canBeCommander(card),
      typeLine: card.type_line ?? null,
      partnerAbility: partnerAbility(card),
      backImageUrl: backImageUrl(card),
      tags: cardTags(card),
    })
  }
  if (entries.length === 0) throw new Error("None of this precon's cards could be found on Scryfall.")
  // MTGJSON lists two commanders for a partner precon — set both when they're there.
  const commanders = contents.commander
    .map((c) => entries.find((e) => e.scryfallId === c.scryfallId))
    .filter((e): e is DeckCardEntry => !!e)
  return createDeckWithCards(name, entries, commanders[0] ?? null, commanders[1] ?? null)
}
