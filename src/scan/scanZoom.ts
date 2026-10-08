// Zooming in and out while scanning: the − / + buttons, a pinch, ctrl + the wheel (a trackpad's
// pinch). Only a camera that says it can zoom (getCapabilities().zoom) gets any of it; most laptops
// don't, and then there's no control at all — no pretend zoom by enlarging the picture.
//
// The pure part, mirrored by the Android app's data/ScanZoom.kt. The page wiring is
// components/useScanZoom.tsx.

import { LENS_SWITCH_ZOOM, zoomFor } from './guide'

/** How far one press of − or + moves the zoom. */
export const ZOOM_STEP = 0.25

/** What a camera says about its zoom: always min < max; step 0 when it gave none. */
export interface ZoomRange {
  min: number
  max: number
  step: number
}

/** The zoom a track's capabilities offer, or null when it has none worth a control. */
export function zoomRangeOf(capabilities: unknown): ZoomRange | null {
  const zoom = capabilities && typeof capabilities === 'object' ? (capabilities as { zoom?: unknown }).zoom : undefined
  if (!zoom || typeof zoom !== 'object') return null
  const { min, max, step } = zoom as { min?: unknown; max?: unknown; step?: unknown }
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null
  return { min, max, step: typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : 0 }
}

/** Rounded to hundredths, so 1.8 + 0.25 steps don't drift into 2.0500000001. */
const tidy = (z: number) => Math.round(z * 100) / 100

/** [zoom] held within the camera's range, on its own step when it has one. */
export function clampZoom(zoom: number, range: ZoomRange): number {
  if (!Number.isFinite(zoom)) return range.min
  let z = Math.min(Math.max(zoom, range.min), range.max)
  if (range.step > 0) {
    z = range.min + Math.round((z - range.min) / range.step) * range.step
    if (z > range.max) z -= range.step
  }
  return tidy(Math.min(Math.max(z, range.min), range.max))
}

/**
 * One press of − (direction -1) or + (1): to the next quarter in that direction (1.8 → 2.0 or 1.75),
 * so the chip reads round numbers after the first press. A camera whose own step is coarser than a
 * quarter moves by that step instead, so a press always does something until the end of the range.
 */
export function stepZoom(current: number, direction: 1 | -1, range: ZoomRange): number {
  const grid = current / ZOOM_STEP
  const next = (direction > 0 ? Math.floor(grid + 1e-6) + 1 : Math.ceil(grid - 1e-6) - 1) * ZOOM_STEP
  const z = clampZoom(next, range)
  if (Math.abs(z - current) > 1e-6 || range.step <= 0) return z
  return clampZoom(current + direction * range.step, range)
}

/** Whether − (or +) can still move: false at that end of the range. */
export function canStepZoom(current: number, direction: 1 | -1, range: ZoomRange): boolean {
  return Math.abs(stepZoom(current, direction, range) - current) > 1e-6
}

/** The zoom a pinch has reached: where it started, scaled by how far apart the fingers are now. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number, range: ZoomRange): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom, range)
  return clampZoom(startZoom * (distance / startDistance), range)
}

/**
 * The zoom after one ctrl + wheel event — what a trackpad's pinch sends, and a mouse wheel with ctrl
 * held. Wheeling up (negative delta) zooms in. A trackpad sends many small deltas; a mouse notch's
 * ±100 is held to a sixth or so of a step up, so it doesn't leap from one end to the other.
 * [deltaMode] is the event's: 0 pixels, 1 lines, 2 pages.
 */
export function wheelZoom(current: number, deltaY: number, deltaMode: number, range: ZoomRange): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1)
  const held = Math.min(Math.max(pixels, -25), 25)
  return clampZoom(current * Math.exp(-held / 100), range)
}

/**
 * The zoom a card scan starts at, and goes back to when the chip is tapped: SCAN_ZOOM as the camera
 * can give it (zoomFor), on the camera's step, and never past the lens switch.
 */
export function defaultZoom(range: ZoomRange): number {
  const z = clampZoom(zoomFor(range) ?? range.min, range)
  if (z > LENS_SWITCH_ZOOM && range.step > 0 && z - range.step >= range.min) return tidy(z - range.step)
  return z
}

/** The chip's text: "1.8×", "2.0×", "1.75×". */
export function zoomLabel(zoom: number): string {
  const z = tidy(zoom)
  return `${Number.isInteger(z * 10) ? z.toFixed(1) : z.toFixed(2)}×`
}

/**
 * What to say under the chip: past the lens switch the phone may hand over to a telephoto that can't
 * focus on something held close (see LENS_SWITCH_ZOOM), so the card has to be held farther off.
 * [thing] is what is held: a card, or a binder page.
 */
export function zoomHint(zoom: number, thing = 'card'): string | null {
  return zoom > LENS_SWITCH_ZOOM + 1e-6 ? `Hold the ${thing} farther away` : null
}

/** A zoom kept from last time, as stored; null when there's none or it isn't one. */
export function savedZoom(text: string | null): number | null {
  if (text === null || text.trim() === '') return null
  const z = Number(text)
  return Number.isFinite(z) && z > 0 ? z : null
}

/** Where to start: the zoom kept from last time if there is one, else [fallback]; within the range. */
export function startZoom(saved: number | null, fallback: number, range: ZoomRange): number {
  return clampZoom(saved ?? fallback, range)
}
