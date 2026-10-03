// The words and counts behind the one "Add to…" sheet (components/AddToSheet.tsx) and the Undo bar
// that confirms it. Every way of putting a card in a deck or binder — Search, the deck page, a
// binder's Move and Copy, All cards, tag binders, Scan — reads the same way, here and in the Android
// app, which is being built to the same wording.

export type TargetKind = 'binder' | 'deck'

/** What's being done: new copies added, copies taken out of a binder and put elsewhere, or listed in two places. */
export type AddVerb = 'add' | 'move' | 'copy'

/**
 * Which kinds of place an "add to…" sheet asks about first — null when there's only one kind to
 * offer, so there's nothing to ask. One long list of binders and decks mixed together is how a card
 * meant for a deck ended up in a binder. The Android app does the same in MoveTargetDialog.
 */
export function kindsToChoose(binders: number, decks: number): TargetKind[] | null {
  return binders > 0 && decks > 0 ? ['binder', 'deck'] : null
}

/** The second line under "A binder" / "A deck" on the first step. */
export function kindDetail(kind: TargetKind, count: number): string {
  return `${count} ${kind}${count === 1 ? '' : 's'}`
}

/** One card by its name, several by how many: "Sol Ring", "3 cards". */
export function cardsLabel(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.length} cards`
}

const VERB: Record<AddVerb, [string, string]> = { add: ['Add', 'Added'], move: ['Move', 'Moved'], copy: ['Copy', 'Copied'] }

/** The sheet's title: "Add Sol Ring to…", "Move 3 cards to…". */
export function sheetTitle(verb: AddVerb, what: string): string {
  return `${VERB[verb][0]} ${what} to…`
}

/** The Undo bar's line once it's done: "Added Sol Ring to Elves", "Moved 3 cards to Trade binder". */
export function doneMessage(verb: AddVerb, what: string, place: string): string {
  return `${VERB[verb][1]} ${what} to ${place}`
}

/** A deck as a place: the deck itself, or its Considering list. */
export function deckPlace(deckName: string, considering: boolean): string {
  return considering ? `${deckName} · Considering` : deckName
}

/** Whether a printing comes in foil (cards Scryfall says nothing about might). */
export function canBeFoil(card: { finishes?: string[] }): boolean {
  return !card.finishes || card.finishes.includes('foil')
}

/** Whether a printing only comes in foil, so the Foil switch starts on. */
export function onlyFoil(card: { finishes?: string[] }): boolean {
  return !!card.finishes && card.finishes.includes('foil') && !card.finishes.includes('nonfoil')
}

/**
 * [count] of a binder card's copies, to move or copy elsewhere — the regular ones first, then foils.
 * Never more than there are.
 */
export function takeCopies(entry: { quantity: number; foilQuantity: number }, count: number): { quantity: number; foilQuantity: number } {
  const quantity = Math.max(0, Math.min(entry.quantity, count))
  const foilQuantity = Math.max(0, Math.min(entry.foilQuantity, count - quantity))
  return { quantity, foilQuantity }
}
