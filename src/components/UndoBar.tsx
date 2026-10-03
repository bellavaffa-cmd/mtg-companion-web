import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { useLayoutSize } from './kit'
import { TAB_ROUTES } from './Layout'
import { UndoContext, type UndoNote } from './useUndoBar'

/** How long the bar stays: long enough to read and reach Undo, short enough not to linger. */
const SHOWN_MS = 5000

/**
 * The one confirmation for adding, moving and copying cards, wherever it happened — a bar at the
 * bottom with Undo, like the Android app's snackbar. A newer note replaces the one showing.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [note, setNote] = useState<(UndoNote & { id: number }) | null>(null)
  const show = useCallback((next: UndoNote) => setNote({ ...next, id: Date.now() + Math.random() }), [])

  useEffect(() => {
    if (!note) return
    const t = window.setTimeout(() => setNote(null), note.warning ? SHOWN_MS + 1500 : SHOWN_MS)
    return () => window.clearTimeout(t)
  }, [note])

  return (
    <UndoContext.Provider value={show}>
      {children}
      {note && <UndoBar key={note.id} note={note} onClose={() => setNote(null)} />}
    </UndoContext.Provider>
  )
}

function UndoBar({ note, onClose }: { note: UndoNote; onClose: () => void }) {
  const location = useLocation()
  // On a phone's tab screens the bar sits above the tab bar rather than over it.
  const raised = useLayoutSize() === 'phone' && TAB_ROUTES.has(location.pathname)
  return (
    <div className={`undo-bar${raised ? ' raised' : ''}`} role="status" aria-live="polite">
      <Icon name="check_circle" className="undo-ic" aria-hidden />
      <div className="undo-text">
        <div>{note.message}</div>
        {note.warning && <div className="undo-warn">{note.warning}</div>}
      </div>
      {note.undo && (
        <button
          type="button"
          className="undo-btn"
          onClick={() => {
            note.undo?.()
            note.onUndone?.()
            onClose()
          }}
        >
          Undo
        </button>
      )}
    </div>
  )
}
