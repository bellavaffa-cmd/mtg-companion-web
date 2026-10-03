// A decklist pasted (or picked as a file) into an existing deck: the main deck's lines go into the
// deck, sideboard and maybeboard lines onto its Considering list. Mirrors the Android app's
// DeckDetailViewModel.importDecklist and importSummary (ui/decks/DeckDetailScreen.kt).

import { sectionOf, type ListLine } from '../collection/cardListText'

/** The lines for the deck, and those for Considering. Lines naming no card (an id-only CSV row) need a name here. */
export function splitBySection(lines: ListLine[]): { main: ListLine[]; considering: ListLine[] } {
  const named = lines.filter((l) => !!l.name).map((l) => ({ ...l, quantity: Math.min(Math.max(l.quantity, 1), 99) }))
  return {
    main: named.filter((l) => sectionOf(l) === 'main'),
    considering: named.filter((l) => sectionOf(l) !== 'main'),
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What an import did, as the phone says it: copies imported, how many went to Considering, what failed. */
export function importSummary(added: number, considering: number, failed: string[]): string[] {
  const out = [`Imported ${plural(added, 'card')}.`]
  if (considering > 0) out.push(`${considering} sideboard/maybeboard ${considering === 1 ? 'card' : 'cards'} went to Considering.`)
  if (failed.length > 0) {
    const shown = failed.slice(0, 25).map((name) => `• ${name}`)
    if (failed.length > 25) shown.push(`…and ${failed.length - 25} more`)
    out.push(`${plural(failed.length, 'line')} couldn't be matched:\n${shown.join('\n')}`)
  }
  return out
}
