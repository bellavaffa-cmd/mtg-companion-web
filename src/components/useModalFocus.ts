// Keyboard and screen-reader behaviour shared by every modal layer — Dialog, the bottom sheets, the
// card zoom: focus moves in on opening and goes round the layer's own controls, Escape closes only
// the layer on top, and focus goes back to where it was once it closes. On Android the same layers
// are ModalBottomSheet / Dialog, which do this themselves (their pane titles: ui/common/A11y.kt).
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The modal layers open now, newest last: only the one on top answers Escape. */
const openLayers: object[] = []

/**
 * Wires a modal layer's box ([ref]) for the keyboard. Returns the onKeyDown to put on the box, which
 * keeps Tab inside it. [focusKey] moves focus in again when it changes (one step giving way to the
 * next in the same box).
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, focusKey?: unknown) {
  // Read while rendering, before an input in the layer takes focus with autoFocus.
  const [returnFocus] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)))
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })

  useEffect(() => {
    const me = {}
    openLayers.push(me)
    // Caught before the page's own Escape handlers (clearing a selection, say), so Escape only
    // closes the layer on top.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openLayers[openLayers.length - 1] !== me) return
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      openLayers.splice(openLayers.indexOf(me), 1)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])

  // Into the layer on opening. An input that focused itself keeps it.
  useEffect(() => {
    const el = ref.current
    if (!el || el.contains(document.activeElement)) return
    ;(el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()
  }, [ref, focusKey])

  // Tab and Shift+Tab go round the layer's own controls rather than out to the page behind it.
  return (e: ReactKeyboardEvent) => {
    const box = ref.current
    if (e.key !== 'Tab' || !box) return
    // A layer opened from inside another's content handles its own Tab.
    e.stopPropagation()
    const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const at = document.activeElement
    if (e.shiftKey && (at === first || at === box)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
  }
}
