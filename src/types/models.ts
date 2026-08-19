// Mirrors the Android app's Moshi-serialized data classes field-for-field (camelCase keys,
// same enum-name strings) so a backup written by one app is read correctly by the other.
// See MtgCompanionApp/app/src/main/java/com/mtgcompanion/app/data/{DeckModels,CollectionModels,SyncModels}.kt

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
}

export interface GameResult {
  id: string
  result: 'WIN' | 'LOSS' | 'DRAW'
  opponent: string | null
  playedAt: number
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
export const DECK_OWNERSHIP_OPTIONS = ['PHYSICAL', 'VIRTUAL', 'PROTOTYPE'] as const
export type DeckOwnership = (typeof DECK_OWNERSHIP_OPTIONS)[number]
export const DECK_OWNERSHIP_DEFAULT: DeckOwnership = 'PHYSICAL'

export const DECK_OWNERSHIP_LABELS: Record<DeckOwnership, string> = {
  PHYSICAL: 'Physical',
  VIRTUAL: 'Virtual',
  PROTOTYPE: 'Prototype',
}

export const DECK_OWNERSHIP_DESCRIPTIONS: Record<DeckOwnership, string> = {
  PHYSICAL: "You own this deck's cards — they count toward your collection.",
  VIRTUAL: "You don't own this deck physically — its cards aren't counted as owned.",
  PROTOTYPE: "Still being built — its cards aren't counted as owned yet.",
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
}

export function newDeck(name: string, gameMode: GameMode = 'COMMANDER'): Deck {
  return {
    id: crypto.randomUUID(),
    name,
    commander: null,
    partnerCommander: null,
    cards: [],
    gameMode,
    createdAt: Date.now(),
    tags: [],
    gameResults: [],
    ownership: DECK_OWNERSHIP_DEFAULT,
  }
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
}

export interface Collection {
  id: string
  name: string
  entries: CollectionEntry[]
  createdAt: number
  type: CollectionType
}

export function newCollection(name: string, type: CollectionType = 'OWNED'): Collection {
  return { id: crypto.randomUUID(), name, entries: [], createdAt: Date.now(), type }
}

/** The whole backed-up library, plus the wall-clock time of the edit that produced it. */
export interface SyncPayload {
  decks: Deck[]
  collections: Collection[]
  updatedAt: number
}
