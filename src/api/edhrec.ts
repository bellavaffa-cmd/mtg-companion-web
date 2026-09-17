// EDHREC's public page JSON — what other people play with a given commander. It allows browser
// requests, so this calls it directly (no relay). Mirrors the Android app's EdhrecRepository.kt.

const BASE = 'https://json.edhrec.com/pages'

export interface EdhrecCard {
  name: string
  /** Scryfall id, when EDHREC knows it — enough to build the card image URL without a lookup. */
  id?: string
  numDecks?: number
  potentialDecks?: number
  synergy?: number
}

interface RawCardView {
  id?: string
  name: string
  synergy?: number
  num_decks?: number
  potential_decks?: number
}

interface RawPage {
  container?: { json_dict?: { cardlists?: { tag?: string; header?: string; cardviews?: RawCardView[] }[] } }
}

/**
 * EDHREC's own slug: lowercase, strip punctuation, spaces to hyphens — e.g.
 * "Yuriko, the Tiger's Shadow" becomes "yuriko-the-tigers-shadow".
 */
export function edhrecSlug(cardName: string): string {
  return cardName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

/** Scryfall's image CDN keys off the card id's first two characters — no API call needed. */
export function edhrecImageUrl(card: EdhrecCard): string | null {
  const id = card.id
  return id && id.length > 2 ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg` : null
}

/** What fraction of eligible decks run the card — EDHREC's headline stat. */
export function inclusionPercent(card: EdhrecCard): number | null {
  if (!card.potentialDecks || !card.numDecks) return null
  return card.potentialDecks > 0 ? Math.floor((card.numDecks * 100) / card.potentialDecks) : null
}

/** A card's name and its front face, so "A // B" matches a deck entry stored either way. */
export function cardNameKeys(name: string): string[] {
  const full = name.trim().toLowerCase()
  return [full, full.split(' // ')[0].trim()]
}

async function cardLists(path: string) {
  const res = await fetch(`${BASE}/${path}.json`)
  if (res.status === 404) return null // EDHREC has no page for this card
  if (!res.ok) throw new Error(`EDHREC ${res.status}`)
  const page = (await res.json()) as RawPage
  return page.container?.json_dict?.cardlists ?? []
}

const toCard = (raw: RawCardView): EdhrecCard => ({
  name: raw.name,
  id: raw.id,
  numDecks: raw.num_decks,
  potentialDecks: raw.potential_decks,
  synergy: raw.synergy,
})

/**
 * Cards other people play with [commanderName] that this deck doesn't have yet, best first. Null
 * when EDHREC has no page for the commander.
 *
 * EDHREC's top cards are mostly staples a deck already runs, so those are filtered out; if that
 * empties the list (a precon's commander page is mostly the precon itself), it falls through to
 * high-synergy cards and then everything else by how many decks run them. Mirrors the Android app's
 * DeckDetailViewModel.suggestions.
 */
export async function commanderSuggestions(commanderName: string, alreadyHave: string[], limit = 12): Promise<EdhrecCard[] | null> {
  const lists = await cardLists(`commanders/${edhrecSlug(commanderName)}`)
  if (!lists) return null
  const have = new Set(alreadyHave.flatMap(cardNameKeys))
  const priority = ['topcards', 'highsynergycards']
  const headline = lists
    .filter((l) => priority.includes(l.tag ?? ''))
    .sort((a, b) => priority.indexOf(a.tag ?? '') - priority.indexOf(b.tag ?? ''))
    .flatMap((l) => l.cardviews ?? [])
  const rest = lists
    .filter((l) => !priority.includes(l.tag ?? ''))
    .flatMap((l) => l.cardviews ?? [])
    .map(toCard)
    .sort((a, b) => (inclusionPercent(b) ?? -1) - (inclusionPercent(a) ?? -1))

  const seen = new Set<string>()
  const out: EdhrecCard[] = []
  for (const card of [...headline.map(toCard), ...rest]) {
    if (seen.has(card.name)) continue
    seen.add(card.name)
    if (cardNameKeys(card.name).some((key) => have.has(key))) continue
    out.push(card)
    if (out.length >= limit) break
  }
  return out
}
