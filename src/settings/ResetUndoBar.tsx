// The Undo bar after Reset collection (ResetCollectionPanel.tsx), on every screen while it's offered.
// It goes when the reset is committed — Undo's time up, or the tab left (SyncContext.commitReset).

import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { RESET_DONE } from './resetCollection'

export function ResetUndoBar() {
  const { pendingReset, undoReset } = useSync()
  if (!pendingReset) return null
  return (
    <div className="undo-bar" role="status" aria-live="polite">
      <Icon name="check_circle" className="undo-ic" aria-hidden />
      <div className="undo-text"><div>{RESET_DONE}</div></div>
      <button type="button" className="undo-btn" onClick={undoReset}>Undo</button>
    </div>
  )
}
