// A deck as text for other apps. Four shapes:
//
//  - Simple: "1 Sol Ring" per line, commanders first — what nearly everything reads.
//  - Exact printing: the same with "(SET) number" after each name, so the art survives the trip.
//  - Arena: MTG Arena's own import shape — "Commander" / "Deck" / "Sideboard" sections, every line
//    "1 Name (SET) 123", double-faced cards by their front face.
//  - MTGO: plain "4 Name" lines, the sideboard after a blank line, no set codes; front-face names for
//    double-faced cards, "Fire/Ice" for split cards. A Commander deck's commanders go in the sideboard
//    part, which is where MTGO looks for them.
//
// Simple and Exact printing add a "Sideboard" section when the deck has one, which the importer
// (parseCardList) reads back into the sideboard. Considering is never exported. Mirrors the Android
// app's data/DeckExport.kt.

import type { Deck, DeckCardEntry } from '../types/models'

export const DECK_EXPORT_FORMATS = ['SIMPLE', 'EXACT', 'ARENA', 'MTGO'] as const
export type DeckExportFormat = (typeof DECK_EXPORT_FORMATS)[number]

export const DECK_EXPORT_LABELS: Record<DeckExportFormat, string> = {
  SIMPLE: 'Simple',
  EXACT: 'Exact printing',
  ARENA: 'Arena',
  MTGO: 'MTGO',
}

/** What each format is for, under the chips — the phone's wording. */
export const DECK_EXPORT_HINTS: Record<DeckExportFormat, string> = {
  SIMPLE: 'Copy this decklist to share or back up your deck.',
  EXACT: 'Each card with its set and collector number, so the same art comes back.',
  ARENA: "For MTG Arena's Import: Commander, Deck and Sideboard sections.",
  MTGO: 'For Magic Online: no set codes, the sideboard after a blank line.',
}

/** Whether the format names each card's printing, which needs the cards looked up first. */
export const needsPrintings = (format: DeckExportFormat): boolean => format === 'EXACT' || format === 'ARENA'

/**
 * The name another client knows a card by. Scryfall names a double-faced card "Front // Back"; Arena
 * and MTGO want only the front face. A split card (both halves on one face, like Fire // Ice) keeps
 * both: "Fire // Ice" on Arena, "Fire/Ice" on MTGO. A card is taken as split when it has no back
 * picture and no half of its type line is an Adventure or an Omen.
 */
export function clientCardName(entry: Pick<DeckCardEntry, 'name' | 'typeLine' | 'backImageUrl'>, format: DeckExportFormat): string {
  const name = entry.name
  if (!name.includes(' // ') || format === 'SIMPLE' || format === 'EXACT') return name
  const front = name.split(' // ')[0].trim()
  const type = entry.typeLine ?? ''
  const split = !entry.backImageUrl && type.includes(' // ') && !/adventure/i.test(type) && !/omen/i.test(type)
  if (!split) return front
  return format === 'MTGO' ? name.split(' // ').map((half) => half.trim()).join('/') : name
}

const byName = (a: DeckCardEntry, b: DeckCardEntry) => {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * [deck] as text in [format]. [printings] is scryfallId → [set code, collector number], needed by
 * Exact printing and Arena; a card missing from it is written without one.
 */
export function deckExportText(deck: Deck, format: DeckExportFormat, printings: Map<string, [string, string]> = new Map()): string {
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
  // The rest of the main deck, less one copy of each commander (a commander is in the card list too).
  const rest = deck.cards
    .map((entry) => ({ ...entry, quantity: entry.quantity - commanders.filter((c) => c.scryfallId === entry.scryfallId).length }))
    .filter((entry) => entry.quantity > 0)
    .sort(byName)
  const sideboard = [...(deck.sideboard ?? [])].sort(byName)

  const line = (entry: DeckCardEntry, quantity = entry.quantity) => {
    const name = clientCardName(entry, format)
    const printing = needsPrintings(format) ? printings.get(entry.scryfallId) : undefined
    return printing ? `${quantity} ${name} (${printing[0].toUpperCase()}) ${printing[1]}` : `${quantity} ${name}`
  }

  const sections: string[][] = []
  switch (format) {
    case 'SIMPLE':
    case 'EXACT':
      sections.push([...commanders.map((c) => line(c, 1)), ...rest.map((e) => line(e))])
      if (sideboard.length > 0) sections.push(['Sideboard', ...sideboard.map((e) => line(e))])
      break
    case 'ARENA':
      if (commanders.length > 0) sections.push(['Commander', ...commanders.map((c) => line(c, 1))])
      sections.push(['Deck', ...rest.map((e) => line(e))])
      if (sideboard.length > 0) sections.push(['Sideboard', ...sideboard.map((e) => line(e))])
      break
    case 'MTGO': {
      sections.push(rest.map((e) => line(e)))
      const after = [...commanders.map((c) => line(c, 1)), ...sideboard.map((e) => line(e))]
      if (after.length > 0) sections.push(after)
      break
    }
  }
  return sections.filter((s) => s.length > 0).map((s) => s.join('\n')).join('\n\n')
}
