// Zoom while scanning, for a camera that can (see scan/scanZoom.ts): the chip with − and + over the
// preview, a two-finger pinch on it, ctrl + wheel (a trackpad's pinch) and the + / − keys while the
// preview has focus. A camera with no zoom gets none of it, and no control is shown.
//
// The zoom shown is always the last one the camera took: a refused one (applyConstraints rejects) is
// let go quietly. The last zoom is kept on this device for next time.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clampZoom, pinchZoom, savedZoom, startZoom, stepZoom, wheelZoom, zoomHint, zoomRangeOf, type ZoomRange } from '../scan/scanZoom'

interface Options {
  /** Where the last zoom is kept (localStorage). */
  storageKey: string
  /** Where to start the first time, and where tapping the chip goes back to. */
  defaultFor: (range: ZoomRange) => number
  /** What is held in front of the camera, for the hint ("card", "page"). */
  thing?: string
  /** Called each time the camera takes a new zoom — the picture under the card just changed. */
  onZoomChange?: () => void
}

export interface ScanZoom {
  /** The camera's zoom, when it has one; null hides the control. */
  range: ZoomRange | null
  /** The zoom the camera last took. */
  zoom: number
  /** The zoom tapping the chip goes back to. */
  defaultZoom: number
  hint: string | null
  /** True while fingers (or a trackpad) are pinching: nothing should be taken from the frames then. */
  pinching: RefObject<boolean>
  /** The stream's video track, once it's running (null when it stops). */
  attach: (track: MediaStreamTrack | null) => void
  set: (zoom: number) => void
  step: (direction: 1 | -1) => void
  reset: () => void
  /** For the preview element: pinch, ctrl + wheel and keys are listened for on it. */
  viewRef: (el: HTMLElement | null) => void
}

/** Zoom is real and widely supported but still outside the DOM types, hence the casts. */
const zoomConstraints = (zoom: number) => ({ advanced: [{ zoom }] }) as unknown as MediaTrackConstraints
const zoomSetting = (track: MediaStreamTrack): number | undefined => (track.getSettings?.() as { zoom?: number } | undefined)?.zoom

/** How long after a trackpad's last pinch event it counts as still pinching. */
const WHEEL_SETTLE_MS = 250

export function useScanZoom({ storageKey, defaultFor, thing = 'card', onZoomChange }: Options): ScanZoom {
  const [range, setRange] = useState<ZoomRange | null>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState<HTMLElement | null>(null)
  const track = useRef<MediaStreamTrack | null>(null)
  const rangeRef = useRef<ZoomRange | null>(null)
  /** The zoom the camera last took, for gestures to start from without waiting for a render. */
  const accepted = useRef(1)
  /** The zoom most recently asked for, so a pinch or wheel builds on it rather than on a lagging accept. */
  const wanted = useRef(1)
  const busy = useRef(false)
  const pending = useRef<number | null>(null)
  const pinching = useRef(false)
  const options = useRef({ storageKey, defaultFor, onZoomChange })
  options.current = { storageKey, defaultFor, onZoomChange }

  /** One request at a time, newest wins: a pinch asks every frame, and answers mustn't land out of order. */
  const request = useCallback((z: number) => {
    const t = track.current
    const r = rangeRef.current
    if (!t || !r) return
    const next = clampZoom(z, r)
    wanted.current = next
    if (busy.current) { pending.current = next; return }
    if (Math.abs(next - accepted.current) < 1e-6) return
    busy.current = true
    t.applyConstraints(zoomConstraints(next))
      .then(() => {
        if (track.current !== t) return
        accepted.current = next
        setZoom(next)
        try { localStorage.setItem(options.current.storageKey, String(next)) } catch { /* private mode: it just isn't kept */ }
        options.current.onZoomChange?.()
      })
      // Not every browser that reports zoom will take it: the last zoom it took stays shown.
      .catch(() => { if (track.current === t) wanted.current = accepted.current })
      .finally(() => {
        if (track.current !== t) return
        busy.current = false
        const again = pending.current
        pending.current = null
        if (again !== null) request(again)
      })
  }, [])

  const attach = useCallback((t: MediaStreamTrack | null) => {
    track.current = t
    busy.current = false
    pending.current = null
    pinching.current = false
    const r = t ? zoomRangeOf(t.getCapabilities?.()) : null
    rangeRef.current = r
    setRange(r)
    if (!t || !r) return
    // Where the camera is now, until it takes the zoom asked for.
    const now = clampZoom(zoomSetting(t) ?? r.min, r)
    accepted.current = now
    wanted.current = now
    setZoom(now)
    let kept: number | null = null
    try { kept = savedZoom(localStorage.getItem(options.current.storageKey)) } catch { /* nothing kept */ }
    request(startZoom(kept, options.current.defaultFor(r), r))
  }, [request])

  const step = useCallback((direction: 1 | -1) => {
    const r = rangeRef.current
    if (r) request(stepZoom(wanted.current, direction, r))
  }, [request])
  const reset = useCallback(() => {
    const r = rangeRef.current
    if (r) request(options.current.defaultFor(r))
  }, [request])

  // Pinch, ctrl + wheel and keys, on the preview — only when there's a zoom to change.
  useEffect(() => {
    if (!view || !range) return
    const fingers = new Map<number, { x: number; y: number }>()
    let start: { distance: number; zoom: number } | null = null
    let wheelTimer: ReturnType<typeof setTimeout> | undefined
    const distance = () => {
      const [a, b] = [...fingers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const onControl = (e: Event) => e.target instanceof Element && !!e.target.closest('.scan-zoom')
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || onControl(e)) return
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (fingers.size === 2) {
        start = { distance: distance(), zoom: wanted.current }
        pinching.current = true
      }
    }
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (fingers.size === 2 && start && rangeRef.current) {
        e.preventDefault()
        request(pinchZoom(start.zoom, start.distance, distance(), rangeRef.current))
      }
    }
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return
      if (fingers.size < 2 && start) {
        start = null
        pinching.current = false
        // The picture moved while the fingers were on it: whatever was steady before isn't now.
        options.current.onZoomChange?.()
      }
    }
    const wheel = (e: WheelEvent) => {
      // Only ctrl + wheel (a trackpad's pinch sends it): a plain wheel still scrolls the page.
      if (!e.ctrlKey || !rangeRef.current) return
      e.preventDefault()
      pinching.current = true
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => { pinching.current = false; options.current.onZoomChange?.() }, WHEEL_SETTLE_MS)
      request(wheelZoom(wanted.current, e.deltaY, e.deltaMode, rangeRef.current))
    }
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const direction = e.key === '+' || e.key === '=' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0
      if (!direction) return
      e.preventDefault()
      step(direction)
    }
    view.addEventListener('pointerdown', down)
    view.addEventListener('pointermove', move, { passive: false })
    view.addEventListener('pointerup', up)
    view.addEventListener('pointercancel', up)
    view.addEventListener('wheel', wheel, { passive: false })
    view.addEventListener('keydown', key)
    return () => {
      clearTimeout(wheelTimer)
      pinching.current = false
      view.removeEventListener('pointerdown', down)
      view.removeEventListener('pointermove', move)
      view.removeEventListener('pointerup', up)
      view.removeEventListener('pointercancel', up)
      view.removeEventListener('wheel', wheel)
      view.removeEventListener('keydown', key)
    }
  }, [view, range, request, step])

  return {
    range,
    zoom,
    defaultZoom: range ? defaultFor(range) : 1,
    hint: range ? zoomHint(zoom, thing) : null,
    pinching,
    attach,
    set: request,
    step,
    reset,
    viewRef: setView,
  }
}
