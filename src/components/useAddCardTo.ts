import { useSync } from '../sync/SyncContext'
import { deckPlace, doneMessage } from '../collection/addTo'
import { UNSORTED_COLLECTION_ID } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import type { AddTarget } from './AddToSheet'
import { useUndoBar } from './useUndoBar'

/**
 * Puts one card where the sheet said — the copies picked, foil or not, into a binder, or into a deck
 * or its Considering list — and says so on the Undo bar, with any copy-rule warning under it.
 */
export function useAddCardTo() {
  const { addCardToDeck, addCardsToDeck, addEntryToCollection, importIntoCollection, recordUndo } = useSync()
  const showUndo = useUndoBar()
  return (card: ScryfallCard, target: AddTarget) => {
    let warning = null as string | null
    const undo = recordUndo(() => {
      if (target.kind === 'deck') {
        if (target.considering) addCardsToDeck(target.id, [card], true)
        else warning = addCardToDeck(target.id, card, target.quantity)
      } else {
        const counts: [number, number] = target.foil ? [0, target.quantity] : [target.quantity, 0]
        // The Unsorted pile is made if there isn't one yet.
        if (target.id === UNSORTED_COLLECTION_ID) importIntoCollection(target.id, [{ card, quantity: counts[0], foilQuantity: counts[1] }])
        else addEntryToCollection(target.id, card, ...counts)
      }
    })
    const place = target.kind === 'deck' ? deckPlace(target.name, target.considering) : target.name
    showUndo(undo
      ? { message: doneMessage('add', card.name, place), warning, undo }
      : { message: `${card.name} is already in ${target.kind === 'deck' ? target.name : place}` })
  }
}
