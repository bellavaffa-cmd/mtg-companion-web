// The scanner's "Last scanned" panel (components/LastScannedPanel.tsx): the words on it, worked out
// here so they can be tested. The card's bottom-left details as printed ("FIN · 0306 · L · EN"), how
// the scanner knew the card, what a screen reader hears, and how many copies you already own. Mirrors
// the Android app's data/ScanCardPanel.kt, with the same checks — except the Android panel's flash when
// the camera reads another printing off the card still held, which the web scanner leaves out: it can't
// tell a same-name card laid on top from the one still held.

import { languageName } from '../collection/copyDetails'
import { placedCopies, placesOf, sameCardName } from '../collection/storagePlaces'
import { realCopiesOf } from '../collection/unsorted'
import type { Collection, Deck } from '../types/models'

/** How a scan was identified, for the panel's "From small print" / "By name" / "Best guess" / "Learned". */
export type ScanHow = 'SMALL_PRINT' | 'NAME' | 'SIGHT' | 'LEARNED' | 'PICKED'

/** The rarity letter printed at the card's bottom left: C/U/R/M, L for a basic land, T for a token, S for special. */
export function rarityLetter(rarity: string | null | undefined, typeLine: string | null | undefined): string | null {
  const type = (typeLine ?? '').toLowerCase()
  if (type.includes('basic') && type.includes('land')) return 'L'
  if (type.startsWith('token')) return 'T'
  switch ((rarity ?? '').toLowerCase()) {
    case 'common': return 'C'
    case 'uncommon': return 'U'
    case 'rare': return 'R'
    case 'mythic': return 'M'
    case 'special': case 'bonus': return 'S'
    default: return null
  }
}

const RARITY_WORDS: Record<string, string> = { L: 'basic land', T: 'token', C: 'common', U: 'uncommon', R: 'rare', M: 'mythic rare', S: 'special' }

/** The rarity in words, for a screen reader: "basic land", "mythic rare". */
export function rarityWords(rarity: string | null | undefined, typeLine: string | null | undefined): string | null {
  const letter = rarityLetter(rarity, typeLine)
  return letter ? RARITY_WORDS[letter] : null
}

/** The language code as a card prints it: "EN", "JP" for Scryfall's "ja", "KR", "CS"/"CT" for Chinese. English when unknown. */
export function printedLanguage(lang: string | null | undefined): string {
  const l = (lang ?? '').trim().toLowerCase() || 'en'
  return ({ ja: 'JP', ko: 'KR', zhs: 'CS', zht: 'CT' } as Record<string, string>)[l] ?? l.toUpperCase()
}

/** "FIN · 0306": the set code in capitals and the collector number as Scryfall has it. */
export function setAndNumber(set: string | null | undefined, number: string | null | undefined): string {
  return [set?.trim() ? set.toUpperCase() : null, number?.trim() ? number : null].filter(Boolean).join(' · ')
}

/** The bottom-left details, all on one line: "FIN · 0306 · L · EN · Foil". */
export function scanDetailsLine(
  set: string | null | undefined, number: string | null | undefined, rarity: string | null | undefined,
  typeLine: string | null | undefined, lang: string | null | undefined, foil: boolean,
): string {
  return [setAndNumber(set, number) || null, rarityLetter(rarity, typeLine), printedLanguage(lang), foil ? 'Foil' : null].filter(Boolean).join(' · ')
}

/** Whether the scanner was only guessing at the printing: shown amber, to be checked. */
export const scanIsGuess = (how: ScanHow | null | undefined, exact: boolean): boolean =>
  how !== 'LEARNED' && how !== 'PICKED' && how !== 'SMALL_PRINT' && !exact

/** How the card was identified, in a word or two; null when there's nothing to say. */
export function scanHowLabel(how: ScanHow | null | undefined, exact: boolean): string | null {
  if (how === 'LEARNED') return 'Learned'
  if (how === 'PICKED') return 'Picked by you'
  if (how === 'SMALL_PRINT') return 'From small print'
  if (!exact) return 'Best guess'
  if (how === 'SIGHT') return 'By sight'
  if (how === 'NAME') return 'By name'
  return null
}

/** "×3 in this scan". */
export const copiesInScan = (copies: number): string => `×${copies} in this scan`

/** A collector number as said out loud: "0306" is "306". */
export const spokenNumber = (number: string): string => number.replace(/^0+/, '') || '0'

/** The panel in one breath, for a screen reader: "Forest, FIN 306, basic land, English, $0.40". */
export function scanPanelSpoken(
  name: string, set: string | null | undefined, number: string | null | undefined, rarity: string | null | undefined,
  typeLine: string | null | undefined, lang: string | null | undefined, foil: boolean, price: string | null, guess: boolean,
): string {
  const printing = [set?.trim() ? set.toUpperCase() : null, number?.trim() ? spokenNumber(number) : null].filter(Boolean).join(' ')
  return [
    name, printing || null, rarityWords(rarity, typeLine), languageName((lang ?? '').trim().toLowerCase() || 'en'),
    foil ? 'foil' : null, price, guess ? 'best guess, check the printing' : null,
  ].filter(Boolean).join(', ')
}

/** The price shown: the foil price for a foil copy when there is one, otherwise the plain one (USD, as Scryfall gives it). */
export function panelPrice(usd: string | null | undefined, usdFoil: string | null | undefined, foil: boolean): string | null {
  return (foil ? usdFoil ?? usd : usd ?? usdFoil) ?? null
}

// ---- You own N ----

/** Copies you already have of a scanned card: of this printing (and where), and of its other printings. */
export interface OwnedSummary { samePrinting: number; otherPrintings: number; places: [string, number][] }

/**
 * Copies of the card [name] in binders, the Unsorted pile, storage places and decks that hold their own
 * copies — the scan's own pile isn't in any of those yet. This printing ([cardId]) by where they are
 * (a place's name, "Krenko deck", or the binder for copies with no place), most first.
 */
export function ownedSummary(collections: Collection[], decks: Deck[], cardId: string, name: string): OwnedSummary {
  const places = new Map(placesOf(collections).map((p) => [p.id, p]))
  const where = new Map<string, number>()
  const at = (label: string, n: number) => { if (n > 0) where.set(label, (where.get(label) ?? 0) + n) }
  let same = 0
  let other = 0
  for (const c of collections) {
    if (c.type === 'WISHLIST') continue
    for (const e of c.entries) {
      if (!sameCardName(e.name, name)) continue
      const copies = e.quantity + (e.foilQuantity ?? 0)
      if (copies <= 0) continue
      if (e.scryfallId !== cardId) { other += copies; continue }
      same += copies
      let placed = 0
      for (const line of placedCopies(e)) {
        const place = places.get(line.placeId)
        if (!place) continue
        placed += line.qty
        at(place.name, line.qty)
      }
      at(c.name, copies - placed)
    }
  }
  for (const d of decks) {
    for (const e of realCopiesOf(d)) {
      if (!sameCardName(e.name, name)) continue
      if (e.scryfallId === cardId) { same += e.quantity; at(`${d.name} deck`, e.quantity) } else other += e.quantity
    }
  }
  // Most first; a sort that keeps ties in the order they were found, as Android's does.
  return { samePrinting: same, otherPrintings: other, places: [...where].sort((a, b) => b[1] - a[1]) }
}

/** "You own 3 · 2 in Red box, 1 in Krenko deck · +4 in other printings" — the top two places, then "…". */
export function ownedLine(s: OwnedSummary, top = 2): string {
  const others = s.otherPrintings > 0 ? `+${s.otherPrintings} in other printings` : null
  if (s.samePrinting <= 0) return others ? `None of this printing · ${others}` : "You don't own this card yet"
  const where = s.places.slice(0, top).map(([p, n]) => `${n} in ${p}`).join(', ') + (s.places.length > top ? ', …' : '')
  return [`You own ${s.samePrinting}`, where || null, others].filter(Boolean).join(' · ')
}
