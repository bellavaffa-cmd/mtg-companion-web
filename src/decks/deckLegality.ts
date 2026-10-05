// A deck checked against its format's building rules, mirroring the Android app's DeckLegality.kt:
// deck size, commander, banned/restricted cards, copy limits (main deck and sideboard counted
// together), the sideboard's size, and colour identity. Pure, so it can be tested.

import { canPair, pairingAbility, type PairCard } from './pairing'
import { GAME_MODE_LABELS, type Deck, type DeckCardEntry, type GameMode } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import { hasSideboard, sideboardLimit } from './sideboard'

export type IssueKind = 'DECK_SIZE' | 'COMMANDER' | 'LEGALITY' | 'COPY_LIMIT' | 'COLOR_IDENTITY'

export interface Issue {
  card: string | null
  reason: string
  kind: IssueKind
  /** A copy-limit issue: the main-deck row it sits on, and the count that row could be cut to, when that's enough. */
  scryfallId?: string
  fixQuantity?: number
}

/** Per format: Scryfall's key, how big a deck is, whether that size is exact, copies allowed. */
const FORMATS: Record<string, { scryfall: string; deckSize: number; exactSize: boolean; singleton: boolean; maxCopies: number; usesCommander: boolean }> = {
  COMMANDER: { scryfall: 'commander', deckSize: 100, exactSize: true, singleton: true, maxCopies: 1, usesCommander: true },
  BRAWL: { scryfall: 'brawl', deckSize: 60, exactSize: true, singleton: true, maxCopies: 1, usesCommander: true },
  STANDARD: { scryfall: 'standard', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  PIONEER: { scryfall: 'pioneer', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  MODERN: { scryfall: 'modern', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  PAUPER: { scryfall: 'pauper', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  LEGACY: { scryfall: 'legacy', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  VINTAGE: { scryfall: 'vintage', deckSize: 60, exactSize: false, singleton: false, maxCopies: 4, usesCommander: false },
  // Draft and sealed: no Scryfall format, so no card is banned or not legal, and no copy limit.
  LIMITED: { scryfall: '', deckSize: 40, exactSize: false, singleton: false, maxCopies: Infinity, usesCommander: false },
}

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
])

const isBasicLand = (name: string, card?: ScryfallCard) =>
  BASIC_LAND_NAMES.has(name) || (card?.type_line ?? '').toLowerCase().includes('basic')

/**
 * Cards with no copy limit: basic lands, and cards whose own text says "A deck can have any number of
 * cards named …" (Relentless Rats, Persistent Petitioners).
 */
export function copyLimitExempt(name: string, card?: ScryfallCard): boolean {
  if (isBasicLand(name, card)) return true
  const text = [card?.oracle_text, ...(card?.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n').toLowerCase()
  return text.includes('a deck can have any number of cards named')
}

/** A format's rules as the legality check reads them (Commander's for one we don't know). */
export function formatRules(gameMode: string) {
  const mode = gameMode as GameMode
  return { ...(FORMATS[mode] ?? FORMATS.COMMANDER), label: GAME_MODE_LABELS[mode] ?? gameMode }
}

/**
 * A commander as pairing sees it, its ability read from the card itself where we have it: an entry
 * saved by an older version may have stored a Friends forever card as plain "Partner".
 */
function pairCard(entry: DeckCardEntry, cardsById: Map<string, ScryfallCard>): PairCard {
  const card = cardsById.get(entry.scryfallId)
  return card
    ? { name: card.name, typeLine: card.type_line ?? entry.typeLine, partnerAbility: pairingAbility(card) }
    : entry
}

export function deckIssues(deck: Deck, cardsById: Map<string, ScryfallCard>): Issue[] {
  const mode = (deck.gameMode as GameMode) ?? 'COMMANDER'
  const format = FORMATS[mode] ?? FORMATS.COMMANDER
  const label = GAME_MODE_LABELS[mode] ?? deck.gameMode
  const issues: Issue[] = []
  const totalCards = deck.cards.reduce((sum, c) => sum + c.quantity, 0)

  // Commander requirement, and the colour identity everything else is checked against.
  let commanderIdentity: Set<string> | null = null
  if (format.usesCommander) {
    if (!deck.commander) {
      issues.push({ card: null, reason: `No commander set — ${label} needs a commander.`, kind: 'COMMANDER' })
    } else {
      const main = cardsById.get(deck.commander.scryfallId)?.color_identity ?? []
      const partner = deck.partnerCommander
      if (partner) {
        if (!canPair(pairCard(deck.commander, cardsById), pairCard(partner, cardsById))) {
          issues.push({ card: null, reason: `${deck.commander.name} and ${partner.name} can't be commanders together.`, kind: 'COMMANDER' })
        }
        commanderIdentity = new Set([...main, ...(cardsById.get(partner.scryfallId)?.color_identity ?? [])])
      } else {
        commanderIdentity = new Set(main)
      }
    }
  }

  if (format.exactSize) {
    if (totalCards !== format.deckSize) {
      issues.push({ card: null, reason: `Deck has ${totalCards} cards; ${label} requires exactly ${format.deckSize}.`, kind: 'DECK_SIZE' })
    }
  } else if (totalCards < format.deckSize) {
    issues.push({ card: null, reason: `Deck has ${totalCards} cards; ${label} requires at least ${format.deckSize}.`, kind: 'DECK_SIZE' })
  }

  for (const entry of deck.cards) {
    const card = cardsById.get(entry.scryfallId)

    // Format legality of the card itself. (Restricted cards' copy limit is checked below, with every
    // printing and the sideboard counted together.)
    switch (card?.legalities?.[format.scryfall]) {
      case 'banned':
        issues.push({ card: entry.name, reason: `Banned in ${label}.`, kind: 'LEGALITY' })
        break
      case 'not_legal':
        issues.push({ card: entry.name, reason: `Not legal in ${label}.`, kind: 'LEGALITY' })
        break
    }

    const isCommanderCard = entry.scryfallId === deck.commander?.scryfallId || entry.scryfallId === deck.partnerCommander?.scryfallId
    if (commanderIdentity && card && !isCommanderCard) {
      const outside = (card.color_identity ?? []).filter((c) => !commanderIdentity!.has(c))
      if (outside.length > 0) {
        issues.push({ card: entry.name, reason: `Outside the commander's colour identity (${outside.join('')}).`, kind: 'COLOR_IDENTITY' })
      }
    }
  }

  // The sideboard: only formats that have one, at most 15 cards (a Limited pool: any number), and
  // every card legal there too.
  const side = deck.sideboard ?? []
  const sideboardCount = side.reduce((n, c) => n + c.quantity, 0)
  const sideLimit = sideboardLimit(mode)
  if (sideboardCount > 0 && !hasSideboard(mode)) {
    issues.push({ card: null, reason: `${label} has no sideboard — ${sideboardCount} card${sideboardCount === 1 ? '' : 's'} still there.`, kind: 'DECK_SIZE' })
  } else if (sideLimit !== null && sideboardCount > sideLimit) {
    issues.push({ card: null, reason: `Sideboard has ${sideboardCount} cards; ${label} allows at most ${sideLimit}.`, kind: 'DECK_SIZE' })
  }
  for (const entry of side) {
    switch (cardsById.get(entry.scryfallId)?.legalities?.[format.scryfall]) {
      case 'banned':
        issues.push({ card: entry.name, reason: `Banned in ${label} (sideboard).`, kind: 'LEGALITY' })
        break
      case 'not_legal':
        issues.push({ card: entry.name, reason: `Not legal in ${label} (sideboard).`, kind: 'LEGALITY' })
        break
    }
  }

  issues.push(...copyLimitIssues(deck, cardsById))
  return issues
}

/**
 * Copy limits, with every printing of a card and its sideboard copies counted together (basics are
 * unlimited). The issue sits on the card's biggest main-deck row, and offers to cut that row down when
 * doing so is enough to fix it.
 */
function copyLimitIssues(deck: Deck, cardsById: Map<string, ScryfallCard>): Issue[] {
  const mode = (deck.gameMode as GameMode) ?? 'COMMANDER'
  const format = FORMATS[mode] ?? FORMATS.COMMANDER
  const label = GAME_MODE_LABELS[mode] ?? deck.gameMode
  const group = (list: DeckCardEntry[]) => {
    const out = new Map<string, DeckCardEntry[]>()
    for (const e of list) {
      const k = e.name.trim().toLowerCase()
      out.set(k, [...(out.get(k) ?? []), e])
    }
    return out
  }
  const main = group(deck.cards)
  const side = group(deck.sideboard ?? [])
  const issues: Issue[] = []
  for (const key of new Set([...main.keys(), ...side.keys()])) {
    const mainRows = main.get(key) ?? []
    const sideRows = side.get(key) ?? []
    const all = [...mainRows, ...sideRows]
    const first = mainRows[0] ?? sideRows[0]
    const card = all.map((e) => cardsById.get(e.scryfallId)).find((c) => c !== undefined)
    if (copyLimitExempt(first.name, card)) continue
    const restricted = all.some((e) => cardsById.get(e.scryfallId)?.legalities?.[format.scryfall] === 'restricted')
    const limit = restricted || format.singleton ? 1 : format.maxCopies
    const inMain = mainRows.reduce((n, e) => n + e.quantity, 0)
    const inSide = sideRows.reduce((n, e) => n + e.quantity, 0)
    const total = inMain + inSide
    if (total <= limit) continue
    const has = inSide > 0 ? `has ${inMain} + ${inSide} in the sideboard` : `has ${total}`
    const reason = restricted
      ? `Restricted in ${label} — max 1 copy (${has}).`
      : format.singleton
        ? `${label} is singleton — only 1 copy allowed (${has}).`
        : `Max ${format.maxCopies} copies allowed (${has}).`
    const row = mainRows.reduce<DeckCardEntry | null>((best, e) => (!best || e.quantity > best.quantity ? e : best), null)
    const fix = row ? row.quantity - (total - limit) : 0
    issues.push({ card: first.name, reason, kind: 'COPY_LIMIT', scryfallId: row?.scryfallId, fixQuantity: fix >= 1 ? fix : undefined })
  }
  return issues
}


