import { useSync } from '../sync/SyncContext'
import { deckPlace, doneMessage } from '../collection/addTo'
import { UNSORTED_COLLECTION_ID } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import type { AddTarget } from './AddToSheet'
import { useAddCheck } from './useAddCheck'
import { useUndoBar } from './useUndoBar'

/**
 * Puts one card where the sheet said — the copies picked, foil or not, into a binder, or into a deck,
 * its sideboard or its Considering list, as the printing chosen in the sheet if another was — and
 * says so on the Undo bar. Into a deck or its sideboard, the add check asks first if the card breaks
 * the deck's rules (useAddCheck); cancelled, nothing is added.
 */
export function useAddCardTo() {
  const { addCardToDeck, addCardsToDeck, addCardToSideboard, addEntryToCollection, importIntoCollection, recordUndo } = useSync()
  const showUndo = useUndoBar()
  const confirmAdd = useAddCheck()
  return async (given: ScryfallCard, target: AddTarget) => {
    const card = target.printing ?? given
    if (target.kind === 'deck' && !target.considering) {
      const ok = await confirmAdd(target, [card], (c) => ({ scryfallId: c.id, name: c.name, quantity: target.quantity, card: c, toSideboard: !!target.sideboard }))
      if (!ok || ok.length === 0) return
    }
    const undo = recordUndo(() => {
      if (target.kind === 'deck') {
        if (target.considering) addCardsToDeck(target.id, [card], true)
        else if (target.sideboard) addCardToSideboard(target.id, card, target.quantity)
        else addCardToDeck(target.id, card, target.quantity)
      } else {
        const counts: [number, number] = target.foil ? [0, target.quantity] : [target.quantity, 0]
        // The Unsorted pile is made if there isn't one yet.
        if (target.id === UNSORTED_COLLECTION_ID) importIntoCollection(target.id, [{ card, quantity: counts[0], foilQuantity: counts[1] }])
        else addEntryToCollection(target.id, card, ...counts)
      }
    })
    const place = target.kind === 'deck' ? deckPlace(target.name, target.considering, target.sideboard) : target.name
    showUndo(undo
      ? { message: doneMessage('add', card.name, place), undo }
      : { message: `${card.name} is already in ${target.kind === 'deck' ? target.name : place}` })
  }
}
