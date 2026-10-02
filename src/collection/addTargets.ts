export type TargetKind = 'binder' | 'deck'

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
