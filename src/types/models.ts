// Mirrors the Android app's Moshi-serialized data classes field-for-field (camelCase keys,
// same enum-name strings) so a backup written by one app is read correctly by the other.
// See MtgCompanionApp/app/src/main/java/com/mtgcompanion/app/data/{DeckModels,CollectionModels,SyncModels}.kt

import type { ScryfallCard } from './scryfall'

export interface DeckCardEntry {
  scryfallId: string
  name: string
  imageUrl: string | null
  quantity: number
  canBeCommander: boolean
  typeLine: string | null
  partnerAbility: string | null
  /** Cached from ScryfallCard's back face — see backImageUrl() in api/scryfall.ts. Null/undefined
   * for single-faced cards and for entries added before this field existed. */
  backImageUrl?: string | null
  /** Cached from cardTags() at add-time — see types/scryfall.ts. Undefined for entries added
   * before this field existed. */
  tags?: string[]
  /**
   * The user's own words about this copy — "proxy", "signed", "borrowed from Sam". They belong to
   * the copy, not to the card, so they follow it from a binder into a deck and back; every entry
   * holding the same printing carries the same set (see collection/userTags.ts). Not to be confused
   * with [tags], which Scryfall writes and the user can't change.
   */
  userTags?: string[]
  /**
   * How many of this entry's copies are proxies (see decks/proxies.ts). Undefined means "whatever
   * the deck is": all of them in a deck marked Proxy, none in any other.
   */
  proxyQuantity?: number
  /**
   * A cut candidate: still in the deck (and in every stat) but flagged as the first thing to take
   * out for something better. Synced under the same key as the phone's DeckCardEntry.replaceable.
   */
  replaceable?: boolean
}

export interface GameResult {
  id: string
  result: 'WIN' | 'LOSS' | 'DRAW'
  /** Who they played, as names joined by ", ". */
  opponent: string | null
  playedAt: number
  /** How long the game ran, when a life counter table kept track. */
  turns?: number | null
  minutes?: number | null
  /** The commanders the opponents played (a partner pair as "A & B"). */
  commanders?: string[]
}

export const GAME_MODES = [
  'COMMANDER', 'BRAWL', 'STANDARD', 'PIONEER', 'MODERN', 'PAUPER', 'LEGACY', 'VINTAGE',
] as const
export type GameMode = (typeof GAME_MODES)[number]

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  COMMANDER: 'Commander',
  BRAWL: 'Brawl',
  STANDARD: 'Standard',
  PIONEER: 'Pioneer',
  MODERN: 'Modern',
  PAUPER: 'Pauper',
  LEGACY: 'Legacy',
  VINTAGE: 'Vintage',
}

export const GAME_MODES_USING_COMMANDER: ReadonlySet<GameMode> = new Set(['COMMANDER', 'BRAWL'])

/**
 * Whether a deck's cards represent real cards the user owns.
 * - PHYSICAL: a deck the user physically owns — its cards count toward what they own.
 * - VIRTUAL: a deck the user doesn't physically own (a copy of someone else's list, an
 *   online-only deck) — its cards don't count toward owned totals.
 * - PROTOTYPE: a deck still being built/tested, incomplete by design — same as Virtual, not
 *   counted as owned until the deck is finished and marked Physical.
 */
export const DECK_OWNERSHIP_OPTIONS = ['PHYSICAL', 'PROXY', 'VIRTUAL', 'PROTOTYPE'] as const
export type DeckOwnership = (typeof DECK_OWNERSHIP_OPTIONS)[number]
export const DECK_OWNERSHIP_DEFAULT: DeckOwnership = 'PHYSICAL'

export const DECK_OWNERSHIP_LABELS: Record<DeckOwnership, string> = {
  PHYSICAL: 'Physical',
  PROXY: 'Proxy',
  VIRTUAL: 'Virtual',
  PROTOTYPE: 'Prototype',
}

export const DECK_OWNERSHIP_DESCRIPTIONS: Record<DeckOwnership, string> = {
  PHYSICAL: "You own this deck's cards — they count toward your collection.",
  PROXY: "A real deck built with proxies. It counts as built, but its cards are worth nothing and aren't real copies you can trade.",
  VIRTUAL: "You don't own this deck physically — its cards aren't counted as owned.",
  PROTOTYPE: "Still being built — its cards aren't counted as owned yet.",
}

/**
 * The deck's list as it stood at [savedAt]: card name -> copies (commanders included), keyed by name
 * so that changing a card's printing doesn't read as a change. Edits within one sitting share one
 * version — see decks/versions.ts. The Android app's DeckVersion, field for field.
 */
export interface DeckVersion {
  id: string
  savedAt: number
  cards: Record<string, number>
  commanders: string[]
}

export interface Deck {
  id: string
  name: string
  commander: DeckCardEntry | null
  partnerCommander: DeckCardEntry | null
  cards: DeckCardEntry[]
  gameMode: string
  createdAt: number
  tags: string[]
  gameResults: GameResult[]
  ownership: DeckOwnership
  /** Cards being thought about for this deck (the Android app's "Considering" list). Not in the deck. */
  considering?: DeckCardEntry[]
  /** Saved versions of the list, oldest first, capped (decks/versions.ts). */
  versions?: DeckVersion[]
  /**
   * The sideboard, for formats that have one (decks/sideboard.ts). Like [considering] it's kept out of
   * [cards], so it never counts toward size, curve, price or combos — only the legality check looks at
   * it (at most 15 cards; copy limits count main deck and sideboard together). JSON key "sideboard",
   * as on the phone; data saved before it existed reads as empty. Synced and merged like [considering].
   */
  sideboard?: DeckCardEntry[]
}

/** Commander/Brawl allow only 1 copy of any non-basic-land card; other formats allow up to
 * MAX_COPIES_DEFAULT. Mirrors the Android app's GameMode.singleton/maxCopies fields. */
export const SINGLETON_GAME_MODES: ReadonlySet<GameMode> = new Set(['COMMANDER', 'BRAWL'])
export const MAX_COPIES_DEFAULT = 4

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
])

function isBasicLand(card: ScryfallCard): boolean {
  return BASIC_LAND_NAMES.has(card.name) || (card.type_line ?? '').toLowerCase().includes('basic')
}

/**
 * Null if adding [addingQuantity] more cop(ies) of [card] to [deck] stays within its format's copy
 * limit; otherwise a short warning to show the user (the card is still added — this is
 * informational, not a block, since testing/sideboard scenarios are legitimate). Basic lands are
 * always unlimited. Mirrors the Android app's duplicateWarning() in data/DeckLegality.kt.
 */
export function duplicateWarning(deck: Deck, card: ScryfallCard, addingQuantity = 1): string | null {
  if (isBasicLand(card)) return null
  const mode = deck.gameMode as GameMode
  const modeLabel = GAME_MODE_LABELS[mode] ?? deck.gameMode
  // The sideboard's copies count toward the same limit.
  const existingQuantity = [...deck.cards, ...(deck.sideboard ?? [])].filter((c) => c.scryfallId === card.id).reduce((n, c) => n + c.quantity, 0)
  const newQuantity = existingQuantity + addingQuantity
  if (SINGLETON_GAME_MODES.has(mode) && newQuantity > 1) {
    return `${modeLabel} is singleton — you'll have ${newQuantity} copies of "${card.name}".`
  }
  if (!SINGLETON_GAME_MODES.has(mode) && newQuantity > MAX_COPIES_DEFAULT) {
    return `Max ${MAX_COPIES_DEFAULT} copies allowed in ${modeLabel} — you'll have ${newQuantity} of "${card.name}".`
  }
  return null
}

/** Fills in fields that may be missing from JSON written by an older version of either app. */
export function normalizeDeck(raw: Partial<Deck> & { id: string; name: string }): Deck {
  return {
    commander: null,
    partnerCommander: null,
    cards: [],
    gameMode: 'COMMANDER',
    createdAt: Date.now(),
    tags: [],
    gameResults: [],
    ownership: DECK_OWNERSHIP_DEFAULT,
    ...raw,
  }
}

export type CollectionType = 'OWNED' | 'WISHLIST'

export interface CollectionEntry {
  scryfallId: string
  name: string
  imageUrl: string | null
  quantity: number
  foilQuantity: number
  /** Cached from ScryfallCard's back face — see DeckCardEntry.backImageUrl. */
  backImageUrl?: string | null
  /** Cached from cardTags() at add-time — see DeckCardEntry.tags. */
  tags?: string[]
  /** Wishlists: tell the user when this card's price (USD, non-foil) is at or under this. */
  priceAlert?: number | null
  /**
   * The user's own words about this copy — "proxy", "signed", "borrowed from Sam". They belong to
   * the copy, not to the card, so they follow it from a binder into a deck and back; every entry
   * holding the same printing carries the same set (see collection/userTags.ts). Not to be confused
   * with [tags], which Scryfall writes and the user can't change.
   */
  userTags?: string[]
  /** The Wishlist: added by itself because a deck is considering the card (see collection/wishlist.ts). */
  auto?: boolean
  /**
   * Owned binders: tell the user when this card's price rises to this or more (US dollars; see
   * collection/priceAlertRules.ts). Checked against the non-foil price, or the foil price when every
   * copy in the entry is foil. The "above" twin of [priceAlert], the wishlist's "at or below".
   */
  priceAlertAbove?: number | null
  /** The copies' condition: one of CARD_CONDITIONS ("NM", "LP", "MP", "HP", "DMG"); left out = not said. */
  condition?: string | null
  /** The language the copies are printed in, as Scryfall codes it (CARD_LANGUAGES: "en", "ja"…); left out = not said. */
  language?: string | null
}

// The entry as JSON — locally, in sync and in shared binders — is these fields by name. Keys added
// for collecting, which the Android app reads and writes the same way (all optional, left out when
// there's nothing to say; see collection/copyDetails.ts):
//   "priceAlert":      number, USD — wishlists: notify when the price is at or below it
//   "priceAlertAbove": number, USD — owned binders: notify when the price is at or above it
//   "condition":       "NM" | "LP" | "MP" | "HP" | "DMG" — for every copy in the entry
//   "language":        "en" | "ja" | "de" | "fr" | "it" | "es" | "pt" | "ru" | "ko" | "zhs" | "zht"
// Copies of one printing in different conditions aren't split into entries: the entry says one.

export interface Collection {
  id: string
  name: string
  entries: CollectionEntry[]
  createdAt: number
  type: CollectionType
  /**
   * The Wishlist: cards taken off it that a deck is still considering, so they aren't put back
   * (see collection/wishlist.ts). Lower-cased names. Forgotten once no deck considers the card.
   */
  notWanted?: string[]
}

/**
 * The one pile of owned cards that aren't in a binder yet — a whole collection imported before it's
 * sorted. The same id on every device, so piles made on two devices merge into one when they sync.
 */
export const UNSORTED_COLLECTION_ID = 'unsorted'
export const UNSORTED_COLLECTION_NAME = 'Unsorted'

/** Whether [c] is the Unsorted pile — owned cards, but not a binder itself. */
export const isUnsorted = (c: Collection): boolean => c.id === UNSORTED_COLLECTION_ID
