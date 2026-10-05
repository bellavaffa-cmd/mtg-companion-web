import { useId, useRef, type ReactNode } from 'react'
import { useModalFocus } from './useModalFocus'

interface Props {
  title: string
  children: ReactNode
  onDismiss: () => void
  actions?: ReactNode
}

/**
 * Mirrors the Android app's AlertDialog styling. Works from the keyboard and with screen readers
 * too: focus moves into it on opening and stays there while it's open, Escape dismisses it, and
 * focus goes back to where it was once it closes (useModalFocus).
 */
export function Dialog({ title, children, onDismiss, actions }: Props) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  // Focus moves in again when one dialog gives way to the next in the same place (a step that asks to confirm).
  const keepFocusIn = useModalFocus(box, onDismiss, title)

  return (
    <div className="dialog-overlay" onClick={onDismiss}>
      <div
        ref={box}
        className="dialog-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepFocusIn}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="dialog-title" id={titleId}>{title}</h2>
        <div>{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}
