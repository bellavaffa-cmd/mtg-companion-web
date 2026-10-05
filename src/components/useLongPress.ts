import { useCallback, useRef } from 'react'
import type { KeyboardEvent, MouseEvent, TouchEvent } from 'react'

interface Options {
  onLongPress: (x: number, y: number) => void
  onClick?: () => void
  delay?: number
  /** While picking several, whether this one is picked: read out as a pressed toggle. */
  selected?: boolean
}

function pointFromEvent(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const mouse = e as MouseEvent
  return { x: mouse.clientX, y: mouse.clientY }
}

/**
 * Mirrors the Android app's long-press-for-quick-actions convention: hold ~500ms to open a
 * context menu instead of tapping/clicking. Right-click is wired to the same menu as an
 * immediate desktop-native alternative, since a mouse has no real equivalent of a touch hold.
 *
 * The element it is spread on becomes a keyboard button: Tab reaches it, Enter or Space is the tap,
 * and the context-menu key or Shift+F10 (the browser's keyboard right-click) is the hold. Spread it on an element with no buttons inside.
 */
export function useLongPress({ onLongPress, onClick, delay = 500, selected }: Options) {
  const timerRef = useRef<number | undefined>(undefined)
  const firedRef = useRef(false)

  const start = useCallback(
    (e: MouseEvent | TouchEvent) => {
      firedRef.current = false
      const { x, y } = pointFromEvent(e)
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true
        onLongPress(x, y)
      }, delay)
    },
    [onLongPress, delay],
  )

  const clear = useCallback(() => {
    window.clearTimeout(timerRef.current)
  }, [])

  const handleClick = useCallback(() => {
    if (firedRef.current) {
      firedRef.current = false
      return
    }
    onClick?.()
  }, [onClick])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick?.()
      }
    },
    [onClick],
  )

  return {
    role: 'button' as const,
    tabIndex: 0,
    ...(selected === undefined ? {} : { 'aria-pressed': selected }),
    onKeyDown,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onClick: handleClick,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      // From the keyboard (the context-menu key, Shift+F10) there is no pointer: open by the element.
      if (e.clientX === 0 && e.clientY === 0) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        onLongPress(r.left + r.width / 2, r.top + r.height / 2)
      } else onLongPress(e.clientX, e.clientY)
    },
  }
}
