import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

interface Props {
  title: string
  children: ReactNode
  onDismiss: () => void
  actions?: ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The dialogs open now, newest last: only the one on top answers Escape. */
const openDialogs: object[] = []

/**
 * Mirrors the Android app's AlertDialog styling. Works from the keyboard and with screen readers
 * too: focus moves into it on opening and stays there while it's open, Escape dismisses it, and
 * focus goes back to where it was once it closes.
 */
export function Dialog({ title, children, onDismiss, actions }: Props) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  // Read while rendering, before an input in the dialog takes focus with autoFocus.
  const [returnFocus] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null))
  const dismiss = useRef(onDismiss)
  useEffect(() => { dismiss.current = onDismiss })

  useEffect(() => {
    const me = {}
    openDialogs.push(me)
    // Caught before the page's own Escape handlers (closing a card zoom, clearing a selection), so
    // Escape only closes the dialog on top.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openDialogs[openDialogs.length - 1] !== me) return
      e.stopPropagation()
      dismiss.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      openDialogs.splice(openDialogs.indexOf(me), 1)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  // Into the dialog on opening — and again when one dialog gives way to the next in the same place
  // (a step that asks to confirm). An input that focused itself keeps it.
  useEffect(() => {
    const el = box.current
    if (!el || el.contains(document.activeElement)) return
    ;(el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()
  }, [title])

  // Tab and Shift+Tab go round the dialog's own controls rather than out to the page behind it.
  const keepFocusIn = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return
    // A dialog opened from inside another's content handles its own Tab.
    e.stopPropagation()
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const at = document.activeElement
    if (e.shiftKey && (at === first || at === box.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
  }

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
        <div className="dialog-title" id={titleId}>{title}</div>
        <div>{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}
