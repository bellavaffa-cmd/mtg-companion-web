// New sets: Scryfall's sets coming out soon and just out, and — for a set whose cards Scryfall has
// shown (previews, then the full set) — which of them suit the user's Commander decks and which are on
// their Wishlist. Followed sets are announced on release day (the Android app with a notification,
// this app with a banner when it's opened). Pure, so it can be tested. Mirrors the Android app's
// data/NewSets.kt, with the same tests (tests/collection/newSets.test.ts ↔ NewSetsTest.kt).
//
// A card suits a deck when its colour identity is within the commander's and it shares something the
// deck already has plenty of: a theme (a printed keyword, a theme tag such as Tokens or Removal, or one
// of the deck's own categories) or a creature type, on at least MIN_SHARED of the deck's cards.

import type { Deck, DeckCardEntry } from '../types/models'
import type { SetInfo } from './setCompletion'

/** Scryfall set types that aren't sets of cards to play: tokens, promos, art cards, digital-only extras. */
export const SKIPPED_SET_TYPES = new Set(['token', 'memorabilia', 'minigame', 'alchemy', 'treasure_chest', 'vanguard', 'promo'])

/** How long a set counts as just out. */
export const RECENT_DAYS = 30

/** How many of a deck's cards must share a theme or creature type for it to count. */
export const MIN_SHARED = 4

/** Keywords nearly every deck is full of, too common to say anything about one. */
export const COMMON_KEYWORDS = new Set([
  'flying', 'first strike', 'double strike', 'trample', 'haste', 'vigilance', 'reach', 'deathtouch', 'menace',
  'defender', 'flash', 'hexproof', 'indestructible', 'ward', 'lifelink', 'scry', 'mill', 'surveil',
])

/** A set's card, as much of it as the matching needs. */
export interface SetCard { id: string; name: string; typeLine: string; colorIdentity: string[]; tags: string[]; imageUrl: string | null; rarity: string | null }

/** Why a card suits a deck: what it shares, with how many of the deck's cards. */
export interface Shared { label: string; count: number }
export interface DeckFit { card: SetCard; shared: Shared[]; score: number }
export interface DeckFits { deckId: string; deckName: string; fits: DeckFit[] }

/** "2026-10-07" + [days]. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from [today] to [date] (both "2026-10-07"); negative once it's past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Whether [set] is one to list: a paper set of cards, with a release date. */
export const listable = (set: SetInfo) => !!set.releasedAt && !set.digital && !SKIPPED_SET_TYPES.has(set.setType ?? '')

/**
 * The sets coming out after [today], soonest first, and those out in the last RECENT_DAYS (today
 * included), newest first.
 */
export function releaseSets(sets: Iterable<SetInfo>, today: string, recentDays = RECENT_DAYS): { upcoming: SetInfo[]; recent: SetInfo[] } {
  const since = addDays(today, -recentDays)
  const upcoming: SetInfo[] = []
  const recent: SetInfo[] = []
  for (const s of sets) {
    if (!listable(s)) continue
    const at = s.releasedAt!
    if (at > today) upcoming.push(s)
    else if (at > since) recent.push(s)
  }
  const byName = (a: SetInfo, b: SetInfo) => a.name.localeCompare(b.name)
  upcoming.sort((a, b) => a.releasedAt!.localeCompare(b.releasedAt!) || byName(a, b))
  recent.sort((a, b) => b.releasedAt!.localeCompare(a.releasedAt!) || byName(a, b))
  return { upcoming, recent }
}

/** "Out today", "Out tomorrow", "In 12 days", "Out 3 days ago", "Out yesterday". */
export function releaseLabel(releasedAt: string, today: string): string {
  const d = daysUntil(releasedAt, today)
  if (d === 0) return 'Out today'
  if (d === 1) return 'Out tomorrow'
  if (d === -1) return 'Out yesterday'
  return d > 0 ? `In ${d} days` : `Out ${-d} days ago`
}

/** "No cards shown yet" / "12 cards shown so far" (before release) / "286 cards". */
export function cardsLabel(set: SetInfo, today: string): string {
  if (set.cardCount <= 0) return 'No cards shown yet'
  const n = `${set.cardCount} ${set.cardCount === 1 ? 'card' : 'cards'}`
  return (set.releasedAt ?? '') > today ? `${n} shown so far` : n
}

/**
 * Followed sets to announce: out on or before [today] (in the last week, so a phone off for a while
 * doesn't announce old news), not announced yet.
 */
export function setsToAnnounce(followed: Set<string>, sets: Iterable<SetInfo>, today: string, told: Set<string>): SetInfo[] {
  const since = addDays(today, -7)
  return [...sets]
    .filter((s) => followed.has(s.code) && !told.has(s.code) && !!s.releasedAt && s.releasedAt <= today && s.releasedAt > since)
    .sort((a, b) => b.releasedAt!.localeCompare(a.releasedAt!) || a.name.localeCompare(b.name))
}

/** A theme as matched: lower case, with the deck categories' and theme tags' spellings brought together. */
export function themeKey(label: string): string {
  const k = label.trim().toLowerCase()
  const same: Record<string, string> = {
    draw: 'card draw', 'card advantage': 'card draw', counterspells: 'counterspell', counters: 'counterspell',
    'board wipes': 'board wipe', wipes: 'board wipe', wraths: 'board wipe', token: 'tokens', 'life gain': 'lifegain',
  }
  return same[k] ?? k
}

/** The creature types on [typeLine] ("Creature — Elf Druid" → Elf, Druid), front face and back. */
export function creatureTypes(typeLine: string | null | undefined): string[] {
  const out = new Set<string>()
  for (const face of (typeLine ?? '').split(' // ')) {
    const [types, subtypes] = face.split(/\s+[—-]\s+/)
    if (!subtypes || !/\b(Creature|Kindred|Tribal)\b/.test(types)) continue
    for (const t of subtypes.trim().split(/\s+/)) if (t) out.add(t)
  }
  return [...out]
}

/** A card's themes: its tags and categories, as keys, without the too-common keywords. */
function themesOf(tags: string[] | null | undefined, categories?: string[] | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const t of [...(tags ?? []), ...(categories ?? [])]) {
    const key = themeKey(t)
    if (!key || COMMON_KEYWORDS.has(key) || out.has(key)) continue
    out.set(key, t.trim())
  }
  return out
}

/** What a deck has plenty of: themes and creature types on at least MIN_SHARED of its cards. */
export interface DeckProfile { deckId: string; deckName: string; identity: Set<string>; themes: Map<string, Shared>; types: Map<string, Shared>; names: Set<string> }

export function deckProfile(deck: Deck, identity: string[]): DeckProfile {
  const entries: DeckCardEntry[] = []
  const seen = new Set<string>()
  for (const e of [deck.commander, deck.partnerCommander, ...deck.cards]) {
    if (!e || seen.has(e.name.toLowerCase())) continue
    seen.add(e.name.toLowerCase())
    entries.push(e)
  }
  const themes = new Map<string, Shared>()
  const types = new Map<string, Shared>()
  for (const e of entries) {
    for (const [key, label] of themesOf(e.tags, e.categories)) {
      const had = themes.get(key)
      themes.set(key, { label: had?.label ?? label, count: (had?.count ?? 0) + 1 })
    }
    for (const t of creatureTypes(e.typeLine)) {
      const had = types.get(t)
      types.set(t, { label: t, count: (had?.count ?? 0) + 1 })
    }
  }
  const plenty = (m: Map<string, Shared>) => new Map([...m].filter(([, s]) => s.count >= MIN_SHARED))
  const names = new Set<string>()
  for (const e of entries) for (const k of nameKeys(e.name)) names.add(k)
  return { deckId: deck.id, deckName: deck.name, identity: new Set(identity), themes: plenty(themes), types: plenty(types), names }
}

const nameKeys = (name: string) => {
  const full = name.trim().toLowerCase()
  const front = full.split(' // ')[0].trim()
  return front === full ? [full] : [full, front]
}

/** Not a basic land, a token or an emblem. */
const playable = (c: SetCard) => !(/\bBasic\b/.test(c.typeLine) && /\bLand\b/.test(c.typeLine)) && !/\b(Token|Emblem)\b/.test(c.typeLine)

/**
 * [cards] that suit the deck: within its colour identity, not in it already, and sharing a theme or
 * creature type it has plenty of — best first (the more of the deck's cards share it, the better),
 * at most [limit].
 */
export function deckFits(profile: DeckProfile, cards: SetCard[], limit = 8): DeckFit[] {
  const out: DeckFit[] = []
  const seen = new Set<string>()
  for (const c of cards) {
    const key = c.name.toLowerCase()
    if (seen.has(key) || !playable(c)) continue
    if (nameKeys(c.name).some((k) => profile.names.has(k))) continue
    if (!c.colorIdentity.every((x) => profile.identity.has(x))) continue
    const shared: Shared[] = []
    for (const t of creatureTypes(c.typeLine)) {
      const s = profile.types.get(t)
      if (s) shared.push(s)
    }
    for (const [k] of themesOf(c.tags)) {
      const s = profile.themes.get(k)
      if (s) shared.push(s)
    }
    if (shared.length === 0) continue
    seen.add(key)
    shared.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    out.push({ card: c, shared, score: shared.reduce((n, s) => n + s.count, 0) })
  }
  return out.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name)).slice(0, limit)
}

/** "Elf, like 14 cards in the deck · Tokens, like 9". */
export function fitReason(fit: DeckFit): string {
  return fit.shared.slice(0, 2).map((s, i) => (i === 0 ? `${s.label}, like ${s.count} cards in the deck` : `${s.label}, like ${s.count}`)).join(' · ')
}

/** The decks the set is checked against: Commander decks with a commander, not put away, not samples. */
export const commanderDecks = (decks: Deck[]) => decks.filter((d) => d.gameMode === 'COMMANDER' && !!d.commander && !d.archived && !d.sample)

/** The set's cards whose name is on [wishlistNames] (lower case) — reprints of cards the user wants. Once each. */
export function wishlistReprints(wishlistNames: Set<string>, cards: SetCard[]): SetCard[] {
  const seen = new Set<string>()
  return cards.filter((c) => {
    const key = c.name.toLowerCase()
    if (seen.has(key) || !nameKeys(c.name).some((k) => wishlistNames.has(k))) return false
    seen.add(key)
    return true
  })
}
