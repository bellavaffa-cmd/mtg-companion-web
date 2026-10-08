// Spoiler season: the cards revealed so far for a set coming out soon (or just out), built on New sets
// (newSets.ts). Pure, so it can be tested. Mirrors the Android app's data/Spoilers.kt, with the same
// tests (tests/collection/spoilers.test.ts ↔ SpoilersTest.kt).
//
//  - The countdown and how much of the set is revealed ("48 of 286 revealed").
//  - Wanting a revealed card: a normal Wishlist entry for that printing with `preRelease` set to the
//    set's release date. Before that day it shows "Releases in 5 days" and no price; from that day on
//    the date is taken off (withReleasedCleared) and the Wishlist's price targets apply.
//  - Which of the user's Commander decks a revealed card could go in (cardFits): in the commander's
//    colours, not in the deck already, legal in Commander once it's out (before that Scryfall can't
//    say), and sharing a theme, role or creature type the deck has plenty of (DeckProfile).
//  - Opening packs: the wanted cards from the set, ticked off as they're pulled (withPulled).
//  - The daily "new cards revealed that fit your decks" news (revealNews, mayTellReveals).

import { UNSORTED_COLLECTION_ID, type Collection, type CollectionEntry, type Deck } from '../types/models'
import type { SetInfo } from './setCompletion'
import { COMMON_KEYWORDS, creatureTypes, daysUntil, fitReason, nameKeys, themeKey, type DeckProfile, type SetCard, type Shared } from './newSets'
import { isWishlist, WISHLIST_ID, WISHLIST_NAME } from './wishlist'
import { withUnsortedPile } from './unsorted'

/** "Releases in 5 days", "Releases tomorrow", "Out today" — null once it's out (or with no date). */
export function releaseCountdown(releasedAt: string | null | undefined, today: string): string | null {
  if (!releasedAt) return null
  const d = daysUntil(releasedAt, today)
  if (d > 1) return `Releases in ${d} days`
  if (d === 1) return 'Releases tomorrow'
  if (d === 0) return 'Out today'
  return null
}

/**
 * How much of [set] Scryfall has: before release "48 of 286 revealed" (its printed size, when Scryfall
 * knows it) or "48 revealed"; "Nothing revealed yet"; once out, "286 cards".
 */
export function revealedLabel(set: SetInfo, today: string): string {
  const n = set.cardCount
  if (n <= 0) return 'Nothing revealed yet'
  if ((set.releasedAt ?? '') <= today) return `${n} ${n === 1 ? 'card' : 'cards'}`
  const total = set.printedSize
  return total != null && total > 0 && n < total ? `${n} of ${total} revealed` : `${n} revealed`
}

/** Whether [entry] is wanted from the spoilers and its set isn't out yet. */
export const isPreRelease = (entry: CollectionEntry, today: string): boolean => !!entry.preRelease && entry.preRelease > today

/** "Releases in 5 days" for a Wishlist card wanted before its set is out; null otherwise (its price shows). */
export const preReleaseLabel = (entry: CollectionEntry, today: string): string | null =>
  isPreRelease(entry, today) ? releaseCountdown(entry.preRelease, today) : null

/** How many of the printing [scryfallId] the Wishlist wants. */
export const wantedCount = (collections: Collection[], scryfallId: string): number =>
  collections.find(isWishlist)?.entries.find((e) => e.scryfallId === scryfallId)?.quantity ?? 0

const nameKey = (name: string) => name.trim().toLowerCase()

/** [entry] without its pre-release date. */
function plain(entry: CollectionEntry): CollectionEntry {
  const { preRelease: _gone, ...rest } = entry
  return rest
}

/**
 * [collections] with [quantity] of the revealed [card] wanted on the Wishlist (made if needed): that
 * printing, the count as given (0 takes it off), wanted by hand. Before [releasedAt] it's flagged
 * pre-release with that date; once the set is out it's a plain Wishlist card.
 */
export function withSpoilerWant(collections: Collection[], card: SetCard, quantity: number, releasedAt: string | null | undefined, today: string): Collection[] {
  const existing = collections.find(isWishlist)
  const entries = existing?.entries ?? []
  const had = entries.find((e) => e.scryfallId === card.id)
  const pre = releasedAt && releasedAt > today ? releasedAt : null
  let next: CollectionEntry[]
  if (quantity <= 0) next = entries.filter((e) => e.scryfallId !== card.id)
  else if (had) next = entries.map((e) => e.scryfallId !== card.id ? e : { ...e, quantity, auto: false, ...(pre ? { preRelease: pre } : {}) })
  else {
    next = [...entries, {
      scryfallId: card.id, name: card.name, imageUrl: card.imageUrl, quantity, foilQuantity: 0, tags: card.tags,
      ...(pre ? { preRelease: pre } : {}),
    }]
  }
  if (existing && quantity <= 0 && !had) return collections
  const notWanted = existing?.notWanted ?? []
  const wishlist: Collection = {
    ...(existing ?? { id: WISHLIST_ID, name: WISHLIST_NAME, createdAt: 0, type: 'WISHLIST' as const, entries: [] }),
    entries: next,
    notWanted: quantity > 0 ? notWanted.filter((n) => nameKey(n) !== nameKey(card.name)) : notWanted,
  }
  return existing ? collections.map((c) => (isWishlist(c) ? wishlist : c)) : [...collections, wishlist]
}

/**
 * [collections] with the pre-release date taken off every Wishlist card whose set is out ([today] or
 * before) — from then on it's a plain Wishlist card, priced and watched like any other. The same array
 * when nothing changes.
 */
export function withReleasedCleared(collections: Collection[], today: string): Collection[] {
  const wishlist = collections.find(isWishlist)
  const out = (e: CollectionEntry) => !!e.preRelease && e.preRelease <= today
  if (!wishlist || !wishlist.entries.some(out)) return collections
  const cleared = { ...wishlist, entries: wishlist.entries.map((e) => (out(e) ? plain(e) : e)) }
  return collections.map((c) => (isWishlist(c) ? cleared : c))
}

/**
 * [theirs] with each entry's pre-release date put back where [source] (the same binder, as this
 * device has it) has one and [theirs] doesn't — an entry saved by an app that doesn't know about
 * spoilers comes without it. A date put back that has passed is taken off again by
 * withReleasedCleared. The same object when nothing changes.
 */
export function keepPreReleaseFromOlderApp(source: Collection, theirs: Collection): Collection {
  const mine = new Map(source.entries.filter((e) => !!e.preRelease).map((e) => [e.scryfallId, e.preRelease!]))
  if (mine.size === 0 || !theirs.entries.some((e) => !e.preRelease && mine.has(e.scryfallId))) return theirs
  return { ...theirs, entries: theirs.entries.map((e) => (!e.preRelease && mine.has(e.scryfallId) ? { ...e, preRelease: mine.get(e.scryfallId)! } : e)) }
}

/** A deck a revealed card could go in, and why ("Elf, like 14 cards in the deck"). */
export interface DeckMatch { deckId: string; deckName: string; why: string }

/**
 * The decks (as [profiles]) [card] could go in: within the commander's colour identity, not in the
 * deck already, legal in Commander once the card is out ([today] on or after its release; before
 * that Scryfall marks every card not legal), and sharing a creature type or a theme / role tag with
 * at least MIN_SHARED of the deck's cards. Best first.
 */
export function cardFits(card: SetCard, profiles: DeckProfile[], today: string): DeckMatch[] {
  if (/\bBasic\b.*\bLand\b/.test(card.typeLine) || /\b(Token|Emblem)\b/.test(card.typeLine)) return []
  const released = !!card.releasedAt && card.releasedAt <= today
  if (released && card.commanderLegality != null && card.commanderLegality !== 'legal') return []
  const keys = nameKeys(card.name)
  const cardTypes = creatureTypes(card.typeLine)
  const cardThemes = [...new Set([...card.tags, ...(card.roles ?? [])].map(themeKey).filter((k) => !!k && !COMMON_KEYWORDS.has(k)))]
  const out: { match: DeckMatch; score: number }[] = []
  for (const p of profiles) {
    if (keys.some((k) => p.names.has(k))) continue
    if (!card.colorIdentity.every((x) => p.identity.has(x))) continue
    const shared: Shared[] = [
      ...cardTypes.map((t) => p.types.get(t)).filter((s): s is Shared => !!s),
      ...cardThemes.map((k) => p.themes.get(k)).filter((s): s is Shared => !!s),
    ]
    if (shared.length === 0) continue
    shared.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    out.push({ match: { deckId: p.deckId, deckName: p.deckName, why: fitReason({ card, shared, score: 0 }) }, score: shared.reduce((n, s) => n + s.count, 0) })
  }
  return out.sort((a, b) => b.score - a.score || a.match.deckName.localeCompare(b.match.deckName)).map((o) => o.match)
}

/** Each of [cards]' decks, by card id (cards that fit none left out). */
export function fitsByCard(cards: SetCard[], profiles: DeckProfile[], today: string): Map<string, DeckMatch[]> {
  const out = new Map<string, DeckMatch[]>()
  if (profiles.length === 0) return out
  for (const c of cards) {
    const fits = cardFits(c, profiles, today)
    if (fits.length > 0) out.set(c.id, fits)
  }
  return out
}

/** The gallery: every revealed card, or with [onlyMine] only those that fit one of the user's decks. */
export const galleryCards = (cards: SetCard[], fits: Map<string, DeckMatch[]>, onlyMine: boolean): SetCard[] =>
  onlyMine ? cards.filter((c) => (fits.get(c.id)?.length ?? 0) > 0) : cards

/** [decks] with the revealed [card] on [deckId]'s Considering list (left as it is when the deck has it already). */
export function withConsideredCard(decks: Deck[], deckId: string, card: SetCard): Deck[] {
  const keys = nameKeys(card.name)
  const has = (d: Deck) => [...d.cards, ...(d.considering ?? [])].some((c) => nameKeys(c.name).some((k) => keys.includes(k)))
  const deck = decks.find((d) => d.id === deckId)
  if (!deck || has(deck)) return decks
  const entry = { scryfallId: card.id, name: card.name, imageUrl: card.imageUrl, quantity: 1, canBeCommander: false, typeLine: card.typeLine, partnerAbility: null, tags: card.tags }
  return decks.map((d) => (d.id === deckId ? { ...d, considering: [...(d.considering ?? []), entry] } : d))
}

/** Whether [deck] is considering [card] (by name) — the deck chip's tick. */
export const isConsidering = (deck: Deck | undefined, card: SetCard): boolean =>
  !!deck && (deck.considering ?? []).some((c) => nameKeys(c.name).some((k) => nameKeys(card.name).includes(k)))

/** A wanted card from the set being opened: the Wishlist [entry] and the set's printing of it. */
export interface PackCard { entry: CollectionEntry; card: SetCard }

/**
 * Opening packs: the Wishlist's cards from this set ([cards]: its revealed printings) — the printing
 * wanted, or another of the same card — A–Z. Cards added by a deck's Considering list count too.
 */
export function openingPacks(collections: Collection[], cards: SetCard[]): PackCard[] {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const byName = new Map<string, SetCard>()
  for (const c of cards) for (const k of nameKeys(c.name)) if (!byName.has(k)) byName.set(k, c)
  const wishlist = collections.find(isWishlist)
  if (!wishlist) return []
  const out: PackCard[] = []
  for (const e of wishlist.entries) {
    if (e.quantity <= 0) continue
    const card = byId.get(e.scryfallId) ?? nameKeys(e.name).map((k) => byName.get(k)).find((c) => !!c)
    if (card) out.push({ entry: e, card })
  }
  return out.sort((a, b) => {
    const x = a.entry.name.toLowerCase()
    const y = b.entry.name.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/**
 * [collections] once one [pulled] card (a PackCard) is out of a pack: one copy of the set's printing
 * into the Unsorted pile (made if needed; [foil] for a foil one), one fewer wanted on the Wishlist
 * (taken off at none).
 */
export function withPulled(collections: Collection[], pulled: PackCard, foil = false): Collection[] {
  const card = pulled.card
  return withUnsortedPile(collections).map((c) => {
    if (isWishlist(c)) {
      return {
        ...c,
        entries: c.entries.flatMap((e) => (e.scryfallId !== pulled.entry.scryfallId ? [e] : e.quantity <= 1 ? [] : [{ ...e, quantity: e.quantity - 1 }])),
      }
    }
    if (c.id === UNSORTED_COLLECTION_ID) {
      const had = c.entries.some((e) => e.scryfallId === card.id)
      return {
        ...c,
        entries: had
          ? c.entries.map((e) => (e.scryfallId !== card.id ? e : foil ? { ...e, foilQuantity: e.foilQuantity + 1 } : { ...e, quantity: e.quantity + 1 }))
          : [...c.entries, { scryfallId: card.id, name: card.name, imageUrl: card.imageUrl, quantity: foil ? 0 : 1, foilQuantity: foil ? 1 : 0, tags: card.tags }],
      }
    }
    return c
  })
}

/** How often the "new cards revealed" news may come: once a day at most. */
export const REVEAL_NEWS_GAP_MS = 24 * 60 * 60 * 1000

/** Whether the reveal news may be told now: never told, or last told a day or more before [now]. */
export const mayTellReveals = (lastTold: number | null, now: number): boolean => lastTold == null || now - lastTold >= REVEAL_NEWS_GAP_MS

/**
 * The cards among [fitting] (ids of the set's revealed cards that fit a deck) not [seen] before. The
 * first look at a set ([seen] null) only notes what's there: nothing is news yet.
 */
export function revealNews(seen: Set<string> | null, fitting: string[]): string[] {
  if (!seen) return []
  return [...new Set(fitting.filter((id) => !seen.has(id)))]
}

/** "3 new cards revealed for Bloomburrow that fit your decks" — or, for several sets, theirs together. */
export function revealNewsTitle(news: { set: SetInfo; count: number }[]): string {
  const total = news.reduce((n, x) => n + x.count, 0)
  const cards = total === 1 ? '1 new card' : `${total} new cards`
  return news.length === 1 ? `${cards} revealed for ${news[0].set.name} that fit your decks` : `${cards} revealed that fit your decks`
}
