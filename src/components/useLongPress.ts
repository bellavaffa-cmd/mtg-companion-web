import { useCallback, useRef } from 'react'
import type { MouseEvent, TouchEvent } from 'react'

interface Options {
  onLongPress: (x: number, y: number) => void
  onClick?: () => void
  delay?: number
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
 */
export function useLongPress({ onLongPress, onClick, delay = 500 }: Options) {
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

  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onClick: handleClick,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      onLongPress(e.clientX, e.clientY)
    },
  }
}
