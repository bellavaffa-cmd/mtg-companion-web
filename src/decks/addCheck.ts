// The check before a card goes into a deck (main deck or sideboard, never Considering): is it legal
// in the deck's format, inside its commander's colours, and within the copy limit? Built on the same
// rules as deckLegality.ts. Pure, so it can be tested; the Android app's AddCheck.kt says the same words.

import { copyLimitExempt, formatRules } from './deckLegality'
import { hasSideboard, MAX_SIDEBOARD } from './sideboard'
import type { Deck } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'

/** One card about to go in: which printing, its name, and how many copies. */
export interface Adding {
  scryfallId: string
  name: string
  quantity: number
  /** Going into the sideboard, which holds at most MAX_SIDEBOARD cards. */
  toSideboard?: boolean
}

/**
 * What's wrong with each of [adding] going into [deck], in the same order (an empty list: nothing).
 * [cardsById] holds what's known of the cards being added and of the deck's commanders; a card or
 * commander missing from it isn't checked for legality or colours, only for copies. Copies count the
 * main deck and sideboard together by name, plus those added earlier in the same list. With
 * [copiesOnly] (one more copy of a card already in, from a "+": its format and colours were accepted
 * when it went in) only the copy limit is checked. With [moving] (from the main deck to the
 * sideboard: the same cards, so nothing about them changes) only the sideboard's size is.
 */
export function addProblems(deck: Deck, adding: Adding[], cardsById: Map<string, ScryfallCard>, copiesOnly = false, moving = false): string[][] {
  const rules = formatRules(deck.gameMode)
  const label = rules.label

  // The commanders' combined colour identity, when the format has one and every commander is known.
  const commanders = rules.usesCommander ? [deck.commander, deck.partnerCommander].filter((c) => !!c) : []
  const commanderCards = commanders.map((c) => cardsById.get(c.scryfallId))
  const identity = commanders.length > 0 && commanderCards.every((c) => c?.color_identity)
    ? new Set(commanderCards.flatMap((c) => c!.color_identity!))
    : null
  const commanderNames = commanders.map((c) => c.name).join(' & ')
  const commanderIds = new Set(commanders.map((c) => c.scryfallId))

  const key = (name: string) => name.trim().toLowerCase()
  const counts = new Map<string, number>()
  for (const e of [...deck.cards, ...(deck.sideboard ?? [])]) counts.set(key(e.name), (counts.get(key(e.name)) ?? 0) + e.quantity)

  let sideboardCount = (deck.sideboard ?? []).reduce((n, e) => n + e.quantity, 0)
  const sideboardKept = hasSideboard(deck.gameMode)

  return adding.map((item) => {
    const card = cardsById.get(item.scryfallId)
    const problems: string[] = []
    if (item.toSideboard && sideboardKept) {
      sideboardCount += item.quantity
      if (sideboardCount > MAX_SIDEBOARD) problems.push(`Sideboard is full (${MAX_SIDEBOARD} max)`)
    }
    if (moving) return problems
    const legality = card?.legalities?.[rules.scryfall]
    if (copiesOnly) {
      // Only the copy limit, below.
    } else if (legality === 'banned') problems.push(`Banned in ${label}`)
    else if (legality && legality !== 'legal' && legality !== 'restricted') problems.push(`Not legal in ${label}`)

    if (!copiesOnly && identity && card?.color_identity && !commanderIds.has(item.scryfallId) && card.color_identity.some((c) => !identity.has(c))) {
      problems.push(`Outside ${commanderNames}'s colours`)
    }

    const total = (counts.get(key(item.name)) ?? 0) + item.quantity
    counts.set(key(item.name), total)
    if (!copyLimitExempt(item.name, card)) {
      if (legality === 'restricted') {
        if (total > 1) problems.push(`Restricted in ${label}`)
      } else {
        const limit = rules.singleton ? 1 : rules.maxCopies
        if (total > limit) problems.push(rules.singleton ? `Singleton: only 1 copy allowed in ${label}` : `Over the copy limit (${limit} max)`)
      }
    }
    return problems
  })
}

/** At most this many cards are listed in the dialog for several cards; the rest are "and {m} more". */
export const LISTED_PROBLEMS = 8

/** The confirmation's words: for one card, or for several (only the ones with problems listed). */
export function addCheckText(deckName: string, cards: { name: string; problems: string[] }[]): { title: string; lines: string[]; single: boolean } {
  if (cards.length === 1) {
    return { title: `Add ${cards[0].name} anyway?`, lines: cards[0].problems, single: true }
  }
  const failing = cards.filter((c) => c.problems.length > 0)
  const lines = failing.slice(0, LISTED_PROBLEMS).map((c) => `${c.name}: ${c.problems.join('; ')}`)
  if (failing.length > LISTED_PROBLEMS) lines.push(`and ${failing.length - LISTED_PROBLEMS} more`)
  return { title: `${failing.length} of these cards aren't allowed in ${deckName}`, lines, single: false }
}
