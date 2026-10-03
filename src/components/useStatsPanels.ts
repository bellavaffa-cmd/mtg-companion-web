import { useCallback, useState } from 'react'
import { isPanelOpen, loadPanels, savePanels, type PanelState } from '../decks/statsPanels'

/** Which Stats panels are open, kept per panel id in this browser (decks/statsPanels.ts). */
export function useStatsPanels(): [(id: string) => boolean, (id: string) => void] {
  const [state, setState] = useState<PanelState>(loadPanels)
  const isOpen = useCallback((id: string) => isPanelOpen(id, state), [state])
  const toggle = useCallback((id: string) => setState((s) => {
    const next = { ...s, [id]: !isPanelOpen(id, s) }
    savePanels(next)
    return next
  }), [])
  return [isOpen, toggle]
}
