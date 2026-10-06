// Turns an imported card list into real cards: 75 lines at a time through Scryfall's collection
// lookup (by id, exact printing, or name), then one fuzzy name search each for the few it missed.

import { getByFuzzyName, getCollection, OfflineError, type CardIdentifier } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import type { ListLine } from './cardListText'
import type { ImportedLocation } from './importPlaces'

export interface ImportedCard {
  card: ScryfallCard
  quantity: number
  foilQuantity: number
  /** The copies' condition and language, when the list said (a CSV's columns); the first line's wins. */
  condition?: string | null
  language?: string | null
  /** Where the list said the copies are kept (a CSV's location column, importPlaces.ts), line by line. */
  locations?: ImportedLocation[]
}

export interface ImportResult {
  /** One per card, copies of the same printing added together. */
  cards: ImportedCard[]
  /** The names (or lines) nothing was found for. */
  missing: string[]
}

function identifier(line: ListLine): CardIdentifier {
  if (line.scryfallId) return { id: line.scryfallId }
  if (line.set && line.number) return { set: line.set, collector_number: line.number }
  if (line.set && line.name) return { name: line.name, set: line.set }
  return { name: line.name ?? '' }
}

const lower = (s: string | undefined | null) => (s ?? '').toLowerCase()

/** Whether [card] is the one [name] means; a double-faced card also answers to its front face. */
function sameName(card: ScryfallCard, name: string | null): boolean {
  const n = lower(name)
  if (!n) return false
  return lower(card.name) === n || lower(card.name).startsWith(`${n} //`) || lower(card.card_faces?.[0]?.name) === n
}

function matches(card: ScryfallCard, line: ListLine): boolean {
  if (line.scryfallId) return card.id === line.scryfallId
  // A printing only counts if it's the card the line names: a mistyped number mustn't bring in
  // another card. Missed, the line is looked up by name instead.
  if (line.set && line.number) {
    return lower(card.set) === line.set && lower(card.collector_number) === lower(line.number) && (!line.name || sameName(card, line.name))
  }
  if (line.set) return sameName(card, line.name) && lower(card.set) === line.set
  return sameName(card, line.name)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Finds the card for every line; [onProgress] hears how many of them are done. */
export async function resolveCardList(lines: ListLine[], onProgress: (done: number, total: number) => void): Promise<ImportResult> {
  const found = new Map<ListLine, ScryfallCard>()
  const total = lines.length
  let done = 0
  onProgress(0, total)

  for (let i = 0; i < lines.length; i += 75) {
    const chunk = lines.slice(i, i + 75)
    const { data } = await getCollection(chunk.map(identifier))
    for (const line of chunk) {
      const card = data.find((c) => matches(c, line))
      if (card) {
        found.set(line, card)
        done++
      }
    }
    onProgress(done, total)
  }

  // What the batches missed (a mistyped name, a printing Scryfall doesn't know) gets a fuzzy search
  // by name — spaced out, as Scryfall asks.
  const missing: string[] = []
  for (const line of lines) {
    if (found.has(line)) continue
    if (line.name) {
      try {
        found.set(line, await getByFuzzyName(line.name))
      } catch (e) {
        if (e instanceof OfflineError) throw e
        missing.push(line.name)
      }
      await sleep(100)
    } else {
      missing.push(line.scryfallId ?? '?')
    }
    onProgress(++done, total)
  }

  const byCard = new Map<string, ImportedCard>()
  // In the list's own order, so "the first line's" is the first in the list, not the first found.
  const order = new Map(lines.map((l, i) => [l, i]))
  for (const [line, card] of [...found].sort(([a], [b]) => order.get(a)! - order.get(b)!)) {
    const item = byCard.get(card.id) ?? { card, quantity: 0, foilQuantity: 0 }
    // One entry describes all its copies, so lines of the same card share the first one's say.
    item.condition = item.condition ?? line.condition ?? null
    item.language = item.language ?? line.language ?? null
    if (line.location) item.locations = [...(item.locations ?? []), { value: line.location, qty: line.quantity, foil: line.foil }]
    if (line.foil) item.foilQuantity += line.quantity
    else item.quantity += line.quantity
    byCard.set(card.id, item)
  }
  return { cards: [...byCard.values()], missing }
}
