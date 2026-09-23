/**
 * The user's own tags on a card they own.
 *
 * A tag belongs to the copy, not to the card: "proxy" said of a printing is true of that printing
 * wherever it sits, so tagging it in a binder tags it in every deck it's in too, and it survives
 * being moved between them. That's the difference from something like a cut candidate, which is
 * only true inside one deck — see DeckCardEntry.userTags.
 *
 * A copy is a printing (scryfallId): a different art of the same card is a different card to own,
 * and the library counts copies rather than naming them, so that's as fine as it can get.
 */

import type { CollectionEntry, DeckCardEntry, Deck, Collection } from '../types/models'

/** Two tags are the same tag when they differ only in case or spacing. */
const key = (tag: string) => tag.trim().toLowerCase()

/** What the user typed, tidied: trimmed, deduped case-insensitively, first spelling kept. */
export function tidyTags(tags: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
    if (!tag || seen.has(key(tag))) continue
    seen.add(key(tag))
    out.push(tag)
  }
  return out
}

/** Long enough for "borrowed from Sam", short enough to read as a chip. */
export const MAX_TAG_LENGTH = 30

type AnyEntry = DeckCardEntry | CollectionEntry

const entriesOf = (deck: Deck): AnyEntry[] => [...deck.cards, ...(deck.considering ?? []),
  ...(deck.commander ? [deck.commander] : []), ...(deck.partnerCommander ? [deck.partnerCommander] : [])]

/** Every tag on this printing, wherever it's held. */
export function userTagsOf(decks: Deck[], collections: Collection[], scryfallId: string): string[] {
  const found: string[] = []
  for (const deck of decks) {
    for (const e of entriesOf(deck)) if (e.scryfallId === scryfallId) found.push(...(e.userTags ?? []))
  }
  for (const c of collections) {
    for (const e of c.entries) if (e.scryfallId === scryfallId) found.push(...(e.userTags ?? []))
  }
  return tidyTags(found)
}

/** Every tag the user has used, for offering them again. Most-used first. */
export function allUserTags(decks: Deck[], collections: Collection[]): string[] {
  const counts = new Map<string, { tag: string; n: number }>()
  const note = (tags: string[] | undefined) => {
    for (const tag of tidyTags(tags ?? [])) {
      const at = counts.get(key(tag))
      if (at) at.n += 1
      else counts.set(key(tag), { tag, n: 1 })
    }
  }
  for (const deck of decks) for (const e of entriesOf(deck)) note(e.userTags)
  for (const c of collections) for (const e of c.entries) note(e.userTags)
  return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((c) => c.tag)
}

/** [entry] with [tags] on it, or with the field gone when there are none to keep entries tidy. */
function withTags<T extends AnyEntry>(entry: T, tags: string[]): T {
  if (tags.length === 0) {
    if (!entry.userTags?.length) return entry
    const { userTags: _dropped, ...rest } = entry
    return rest as T
  }
  return { ...entry, userTags: tags }
}

const sameTags = (a: string[] | undefined, b: string[]) =>
  (a ?? []).length === b.length && (a ?? []).every((t, i) => t === b[i])

/** [deck] with every copy of [scryfallId] in it carrying [tags]. */
export function deckWithTags(deck: Deck, scryfallId: string, tags: string[]): Deck {
  const one = <T extends DeckCardEntry>(e: T): T =>
    (e.scryfallId === scryfallId && !sameTags(e.userTags, tags) ? withTags(e, tags) : e)
  const commander = deck.commander ? one(deck.commander) : deck.commander
  const partner = deck.partnerCommander ? one(deck.partnerCommander) : deck.partnerCommander
  const cards = deck.cards.map(one)
  const considering = deck.considering?.map(one)
  if (commander === deck.commander && partner === deck.partnerCommander
    && cards.every((c, i) => c === deck.cards[i])
    && (!considering || considering.every((c, i) => c === deck.considering![i]))) return deck
  return { ...deck, commander, partnerCommander: partner, cards, ...(considering ? { considering } : {}) }
}

/** [collection] with every copy of [scryfallId] in it carrying [tags]. */
export function collectionWithTags(collection: Collection, scryfallId: string, tags: string[]): Collection {
  const entries = collection.entries.map((e) =>
    (e.scryfallId === scryfallId && !sameTags(e.userTags, tags) ? withTags(e, tags) : e))
  return entries.every((e, i) => e === collection.entries[i]) ? collection : { ...collection, entries }
}
