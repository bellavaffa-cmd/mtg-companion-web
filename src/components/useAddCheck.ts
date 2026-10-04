import { createContext, useContext } from 'react'
import type { ScryfallCard } from '../types/scryfall'

/** The deck a card is going into: found by id, or — a deck made a moment ago — taken as given. */
export interface AddCheckDeck {
  id: string
  name: string
  gameMode?: string
}

/** One card about to go in, as the check sees it; [card] is the full card when the caller has it. */
export interface AddCheckCard {
  scryfallId: string
  name: string
  quantity: number
  card?: ScryfallCard | null
  /** Going into the sideboard rather than the main deck. */
  toSideboard?: boolean
}

/**
 * Checks [items] against the deck's rules before they go in (decks/addCheck.ts) and, if any breaks
 * one, asks first. Resolves with the items to add — all of them, or only the allowed ones — or null
 * when the user cancelled. With [options.copiesOnly] only the copy limit is checked — for one more
 * copy of a card already in (a "+"), whose format and colours were accepted when it went in.
 * With [options.moving] (main deck to sideboard) only the sideboard's size is checked.
 */
export type ConfirmAdd = <T>(
  deck: AddCheckDeck, items: T[], describe: (item: T) => AddCheckCard, options?: { copiesOnly?: boolean; moving?: boolean },
) => Promise<T[] | null>

export const AddCheckContext = createContext<ConfirmAdd>(async (_deck, items) => items)

/** The check before cards go into a deck's main deck or sideboard (never Considering). */
export function useAddCheck(): ConfirmAdd {
  return useContext(AddCheckContext)
}
