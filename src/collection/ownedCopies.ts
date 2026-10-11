// Which deck copies count as the user's own — one rule for every number that says "owned" or what
// the collection is worth: All cards, the Collection home's count, the dashboard's value, set
// completion, collection goals, "You own N", the smart piles, a deck's upgrade spares.
//
// - A Physical deck's cards are owned (a deck saved with no ownership, or one this app doesn't know,
//   is Physical — ownershipOf, as the Android app's DeckOwnership.fromName).
// - A Proxy deck counts as built: its proxies show among the copies on All cards but are worth
//   nothing, and the real copies swapped into it are owned like a Physical deck's.
// - Virtual and Prototype decks hold nothing the user owns, and neither does a cube (kept as an
//   archived Virtual deck) or a welcome-flow sample.
//
// Storage, Where it is and the Unsorted pile keep their own, narrower rule: realCopiesOf (Physical
// decks only). Mirrors the Android app's data/OwnedCopies.kt.

import { ownershipOf, type Deck, type DeckCardEntry } from '../types/models'
import { proxyCopies } from '../decks/proxies'

/** decks/cube.ts's isCube, said here so this low-level rule doesn't import the cube code. */
const CUBE_MODE = 'CUBE'

/** Whether this deck's cards count toward what the user owns (see above). */
export function countsAsOwned(deck: Deck): boolean {
  if (deck.sample || deck.gameMode === CUBE_MODE) return false
  const o = ownershipOf(deck)
  return o === 'PHYSICAL' || o === 'PROXY'
}

/** The real copies of [entry] the deck holds that are the user's own — the ones with a value. */
export function ownedCopies(deck: Deck, entry: DeckCardEntry): number {
  return countsAsOwned(deck) ? Math.max(0, entry.quantity - proxyCopies(deck, entry)) : 0
}

/** The proxies of [entry] in a deck that counts as owned: shown among its copies, never valued. */
export function ownedProxies(deck: Deck, entry: DeckCardEntry): number {
  return countsAsOwned(deck) ? proxyCopies(deck, entry) : 0
}
