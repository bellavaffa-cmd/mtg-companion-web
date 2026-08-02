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
  }
}

export type CollectionType = 'OWNED' | 'WISHLIST'

export interface CollectionEntry {
  scryfallId: string
  name: string
  imageUrl: string | null
  quantity: number
  foilQuantity: number
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
