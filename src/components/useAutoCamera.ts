// Auto zoom and focus while scanning a card (scan/autoCamera.ts): the camera wiring. Each frame the
// card's edges are found and its sharpness measured (cardInView); the zoom follows the card through
// useScanZoom's auto zoom, focus and exposure are pointed at it where the camera allows, and a card
// that stays blurred has its focus run again. Whatever a camera can't do is simply not done, and any
// constraint it refuses is let go quietly.
//
// Switched on and off in Settings › Scanner ("Auto zoom and focus"), kept in this browser.

import { useCallback, useRef, useState, type RefObject } from 'react'
import { AUTO_CAMERA_KEY, autoCameraOn, AutoZoom, BLUR_SHARPNESS, cardFit, focusPoint, focusPointMoved, Refocus } from '../scan/autoCamera'
import type { Pt } from '../scan/cardEdges'
import { cardInView } from '../scan/flatCard'
import type { Box } from '../scan/ocr'
import type { ScanZoom } from './useScanZoom'

/** Whether auto zoom and focus are switched on (Settings › Scanner); on unless switched off. */
export function loadAutoCamera(): boolean {
  try { return autoCameraOn(localStorage.getItem(AUTO_CAMERA_KEY)) } catch { return true }
}

/** The setting, for Settings › Scanner. */
export function useAutoCameraSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadAutoCamera)
  const change = useCallback((next: boolean) => {
    setOn(next)
    try { localStorage.setItem(AUTO_CAMERA_KEY, String(next)) } catch { /* this visit only */ }
  }, [])
  return [on, change]
}

/** How long single-shot focus is given before going back to continuous. */
const SINGLE_SHOT_MS = 600
/** How long a refocus by re-asking for continuous focus is waited out. */
const CONTINUOUS_NUDGE_MS = 400

interface FocusCaps {
  focus: string[]
  exposure: string[]
  points: boolean
}

/** These are real and supported by Chrome on Android, but still outside the DOM types. */
const constraints = (c: Record<string, unknown>) => ({ advanced: [c] }) as unknown as MediaTrackConstraints
const modes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((m): m is string => typeof m === 'string') : [])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface AutoCamera {
  /** The stream's video track, once it's running (null when it stops). */
  attach: (track: MediaStreamTrack | null) => void
  /** One frame, at [box] (the guide, in the video's pixels); [titleRead]: the card's title read on it. */
  onFrame: (video: HTMLVideoElement, box: Box, titleRead: boolean) => void
  /** True while the focus is being run again: nothing should be taken from the frames then. */
  adjusting: RefObject<boolean>
}

/**
 * [enabled]: the setting. [onAdjust] is called as a refocus starts and ends — the picture changes
 * under the card, so whatever was held steady counts afresh.
 */
export function useAutoCamera(zoom: ScanZoom, enabled: boolean, onAdjust: () => void): AutoCamera {
  const track = useRef<MediaStreamTrack | null>(null)
  const caps = useRef<FocusCaps>({ focus: [], exposure: [], points: false })
  const autoZoom = useRef(new AutoZoom())
  const refocus = useRef(new Refocus())
  const point = useRef<Pt | null>(null)
  const adjusting = useRef(false)
  const live = useRef({ zoom, enabled, onAdjust })
  live.current = { zoom, enabled, onAdjust }

  const apply = (t: MediaStreamTrack, c: Record<string, unknown>) => t.applyConstraints(constraints(c)).catch(() => {})

  const attach = useCallback((t: MediaStreamTrack | null) => {
    track.current = t
    adjusting.current = false
    point.current = null
    autoZoom.current.reset()
    refocus.current.reset()
    const c = (t?.getCapabilities?.() ?? {}) as Record<string, unknown>
    let points = false
    try { points = (navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, unknown> | undefined)?.pointsOfInterest === true } catch { /* none */ }
    caps.current = { focus: modes(c.focusMode), exposure: modes(c.exposureMode), points }
    if (!t || !live.current.enabled) return
    // Continuous focus and exposure from the start, where the camera has them.
    if (caps.current.focus.includes('continuous')) void apply(t, { focusMode: 'continuous' })
    if (caps.current.exposure.includes('continuous')) void apply(t, { exposureMode: 'continuous' })
  }, [])

  const onFrame = useCallback((video: HTMLVideoElement, box: Box, titleRead: boolean) => {
    const t = track.current
    const { zoom: z, enabled } = live.current
    if (!t || !enabled || adjusting.current) return
    const { focus, exposure, points } = caps.current
    const zooming = z.autoRef.current && !!z.range
    const focusing = focus.length > 0 || (points && exposure.length > 0)
    if (!zooming && !focusing) return
    const seen = cardInView(video, box)
    const now = performance.now()

    if (zooming && z.range) {
      const next = autoZoom.current.onFrame(seen ? cardFit(seen.quad, box) : null, z.zoomNow.current, z.range, now)
      if (next !== null) z.autoSet(next)
    } else autoZoom.current.reset()

    // Focus and exposure metered on the card, where the camera can be told where to look.
    if (seen && points && (focus.length > 0 || exposure.length > 0) && video.videoWidth && video.videoHeight) {
      const at = focusPoint(seen.quad, video.videoWidth, video.videoHeight)
      if (focusPointMoved(point.current, at)) {
        point.current = at
        void apply(t, { pointsOfInterest: [at] })
      }
    }

    // A card that stays blurred: the focus is run again.
    const sharp = seen ? titleRead || seen.sharpness >= BLUR_SHARPNESS : null
    if (!refocus.current.onFrame(sharp, now)) return
    const single = focus.includes('single-shot')
    const continuous = focus.includes('continuous')
    if (!single && !continuous) return
    const at = point.current && points ? { pointsOfInterest: [point.current] } : {}
    adjusting.current = true
    live.current.onAdjust()
    void (async () => {
      if (single) {
        await apply(t, { focusMode: 'single-shot', ...at })
        await sleep(SINGLE_SHOT_MS)
        if (continuous && track.current === t) await apply(t, { focusMode: 'continuous', ...at })
      } else {
        await apply(t, { focusMode: 'continuous', ...at })
        await sleep(CONTINUOUS_NUDGE_MS)
      }
      if (track.current !== t) return
      adjusting.current = false
      live.current.onAdjust()
    })()
  }, [])

  return { attach, onFrame, adjusting }
}
