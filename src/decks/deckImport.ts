// A decklist pasted (or picked as a file) into an existing deck: the main deck's lines go into the
// deck, sideboard lines into its sideboard for a format with one (onto Considering for Commander and
// Brawl), maybeboard lines onto Considering. Mirrors the Android app's
// DeckDetailViewModel.importDecklist and importSummary (ui/decks/DeckDetailScreen.kt).

import { sectionOf, type ListLine } from '../collection/cardListText'
import { importPart } from './sideboard'

/**
 * The lines for the deck, its sideboard and Considering, for a [mode] deck. Lines naming no card (an
 * id-only CSV row) need a name here.
 */
export function splitBySection(lines: ListLine[], mode = 'COMMANDER'): { main: ListLine[]; sideboard: ListLine[]; considering: ListLine[] } {
  const named = lines.filter((l) => !!l.name).map((l) => ({ ...l, quantity: Math.min(Math.max(l.quantity, 1), 99) }))
  return {
    main: named.filter((l) => importPart(sectionOf(l), mode) === 'main'),
    sideboard: named.filter((l) => importPart(sectionOf(l), mode) === 'sideboard'),
    considering: named.filter((l) => importPart(sectionOf(l), mode) === 'considering'),
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * What an import did, as the phone says it: copies imported, how many went to the sideboard and to
 * Considering, what failed.
 */
export function importSummary(added: number, considering: number, sideboard: number, failed: string[]): string[] {
  const out = [`Imported ${plural(added, 'card')}.`]
  if (sideboard > 0) out.push(`${plural(sideboard, 'card')} went to the sideboard.`)
  if (considering > 0) out.push(`${considering} sideboard/maybeboard ${considering === 1 ? 'card' : 'cards'} went to Considering.`)
  if (failed.length > 0) {
    const shown = failed.slice(0, 25).map((name) => `• ${name}`)
    if (failed.length > 25) shown.push(`…and ${failed.length - 25} more`)
    out.push(`${plural(failed.length, 'line')} couldn't be matched:\n${shown.join('\n')}`)
  }
  return out
}
