import { createContext, useContext } from 'react'

/** What the bar says after a card went somewhere, and how to take it back. */
export interface UndoNote {
  /** "Added Sol Ring to Elves". */
  message: string
  /** A second line: the deck now breaks its format's copy rules, say (see useAddWarning). */
  warning?: string | null
  /** Takes back exactly what was done (SyncContext's recordUndo); no Undo button without it. */
  undo?: (() => void) | null
  /** Anything else to put back on Undo — the scanned pile, say. */
  onUndone?: () => void
}

export const UndoContext = createContext<(note: UndoNote) => void>(() => {})

/** Shows the Undo bar. */
export function useUndoBar(): (note: UndoNote) => void {
  return useContext(UndoContext)
}
