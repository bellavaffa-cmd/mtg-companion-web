// Auto zoom and auto focus while scanning a card (Settings › Scanner › Auto zoom and focus).
//
// Auto zoom: the card's edges, found each frame (findCards in cardEdges.ts), say how much of the
// guide it fills; the zoom is nudged until it fills about 87% — small steps, not too often, only for
// a card seen a few frames running, never past the lens switch and never so far that the card would
// spill out of the guide. Moving the zoom by hand turns it off until the chip is tapped.
//
// Auto focus: continuous focus where the camera has it, pointed at the card; a card that stays
// blurred has the focus run again (single-shot, then back to continuous), not more than every 1.5 s.
//
// The pure part; the camera wiring is components/useAutoCamera.ts. The Android app does the same.

import type { Box } from './ocr'
import type { CardQuad, Pt } from './cardEdges'
import { LENS_SWITCH_ZOOM } from './guide'
import { clampZoom, type ZoomRange } from './scanZoom'

/** How much of the guide the card is zoomed to fill (its width or height, whichever is more). */
export const AUTO_ZOOM_TARGET = 0.875
/** Fills this close to the target are left alone, so the zoom doesn't hunt. */
export const AUTO_ZOOM_DEADBAND = 0.1
/** The most one nudge moves the zoom. */
export const AUTO_ZOOM_MAX_STEP = 0.15
/** The least time between nudges, so each settles (and is read) before the next. */
export const AUTO_ZOOM_EVERY_MS = 400
/** Frames running the card has to be found in before the zoom follows it. */
export const AUTO_ZOOM_SEEN_FRAMES = 3
/** How far from the guide's centre the card's farthest edge may reach after a nudge (1 = the guide's edge). */
export const AUTO_ZOOM_MAX_REACH = 0.98

/** How long a card has to stay blurred before the focus is run again. */
export const REFOCUS_BLUR_MS = 700
/** The least time between refocuses. */
export const REFOCUS_EVERY_MS = 1500
/** Below this sharpness (see [sharpness]) a card counts as blurred. */
export const BLUR_SHARPNESS = 0.12
/** How far the card's centre has to move (as a share of the frame) before focus is pointed at it again. */
export const FOCUS_POINT_MOVE = 0.05

/** Where the card sits against the guide: how much of it it fills, and how far out its edges reach. */
export interface CardFit {
  /** The card's width or height over the guide's, whichever is more. */
  fill: number
  /** Its farthest edge from the guide's centre, over the guide's half-size that way (over 1: outside it). */
  reach: number
}

const boundsOf = (q: CardQuad) => {
  const xs = [q.topLeft.x, q.topRight.x, q.bottomRight.x, q.bottomLeft.x]
  const ys = [q.topLeft.y, q.topRight.y, q.bottomRight.y, q.bottomLeft.y]
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

/** How [card] (in the same pixels as [guide]) sits in the guide. */
export function cardFit(card: CardQuad, guide: Box): CardFit {
  const b = boundsOf(card)
  const cx = guide.x + guide.width / 2
  const cy = guide.y + guide.height / 2
  const hw = guide.width / 2
  const hh = guide.height / 2
  return {
    fill: Math.max((b.right - b.left) / guide.width, (b.bottom - b.top) / guide.height),
    reach: Math.max(Math.abs(b.left - cx) / hw, Math.abs(b.right - cx) / hw, Math.abs(b.top - cy) / hh, Math.abs(b.bottom - cy) / hh),
  }
}

/**
 * The zoom to nudge to for a card that sits [fit] at [zoom], or null to leave it. Zooming scales
 * everything about the frame's centre, where the guide is, so the fill and the reach both scale with
 * the zoom.
 */
export function autoZoomStep(zoom: number, fit: CardFit, range: ZoomRange): number | null {
  if (!(fit.fill > 0) || !(fit.reach > 0)) return null
  const spilling = fit.reach > 1
  if (!spilling && Math.abs(fit.fill - AUTO_ZOOM_TARGET) <= AUTO_ZOOM_DEADBAND) return null
  const wanted = zoom * (AUTO_ZOOM_TARGET / fit.fill)
  let next = zoom + Math.min(Math.max(wanted - zoom, -AUTO_ZOOM_MAX_STEP), AUTO_ZOOM_MAX_STEP)
  // Never so far the card spills out of the guide, nor past the lens switch.
  const ceiling = Math.min(range.max, LENS_SWITCH_ZOOM, zoom * (AUTO_ZOOM_MAX_REACH / fit.reach))
  next = Math.max(Math.min(next, ceiling), range.min)
  let z = clampZoom(next, range)
  // The camera's step may round it back over the ceiling.
  if (z > ceiling + 1e-6 && range.step > 0 && z - range.step >= range.min) z = Math.round((z - range.step) * 100) / 100
  if (z > zoom && z > ceiling + 1e-6) return null
  return Math.abs(z - zoom) >= 0.01 ? z : null
}

/** Auto zoom across frames: the card seen a few frames running, and not nudged too often. */
export class AutoZoom {
  private seen = 0
  private lastAt = -Infinity

  /** One frame: where the card sits (null: not found). The zoom to ask for, or null. */
  onFrame(fit: CardFit | null, zoom: number, range: ZoomRange, now: number): number | null {
    if (!fit) { this.seen = 0; return null }
    this.seen++
    if (this.seen < AUTO_ZOOM_SEEN_FRAMES || now - this.lastAt < AUTO_ZOOM_EVERY_MS) return null
    const next = autoZoomStep(zoom, fit, range)
    if (next === null) return null
    this.lastAt = now
    // The card moves in the frame with the zoom: it's watched afresh before the next nudge.
    this.seen = 0
    return next
  }

  reset() {
    this.seen = 0
    this.lastAt = -Infinity
  }
}

/** Refocusing across frames: a card blurred for a while, and not too often. */
export class Refocus {
  private blurredSince: number | null = null
  private lastAt = -Infinity

  /**
   * One frame: whether the card in view is sharp (null: no card found). True when this is the
   * moment to run the focus again.
   */
  onFrame(sharp: boolean | null, now: number): boolean {
    if (sharp !== false) { this.blurredSince = null; return false }
    this.blurredSince ??= now
    if (now - this.blurredSince < REFOCUS_BLUR_MS || now - this.lastAt < REFOCUS_EVERY_MS) return false
    this.lastAt = now
    this.blurredSince = null
    return true
  }

  reset() {
    this.blurredSince = null
  }
}

/**
 * How sharp a grey picture is: the average step between neighbouring pixels, over how much the grey
 * varies at all — so a dim or low-contrast card isn't taken for a blurred one. A crisp card reads
 * about 0.2 to 0.5; one out of focus well under 0.1.
 */
export function sharpness(grey: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sq = 0
  const n = width * height
  for (let i = 0; i < n; i++) { sum += grey[i]; sq += grey[i] * grey[i] }
  const mean = sum / n
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean))
  if (sd < 4) return 0
  let steps = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x
      steps += Math.abs(grey[i + 1] - grey[i]) + Math.abs(grey[i + width] - grey[i])
    }
  }
  return steps / ((width - 1) * (height - 1)) / sd
}

/** The card's centre as a point of interest: 0..1 across and down the frame. */
export function focusPoint(card: CardQuad, frameWidth: number, frameHeight: number): Pt {
  const x = (card.topLeft.x + card.topRight.x + card.bottomRight.x + card.bottomLeft.x) / 4 / frameWidth
  const y = (card.topLeft.y + card.topRight.y + card.bottomRight.y + card.bottomLeft.y) / 4 / frameHeight
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) }
}

/** Whether focus should be pointed again: none yet, or the card has moved far enough. */
export function focusPointMoved(was: Pt | null, now: Pt): boolean {
  return !was || Math.hypot(now.x - was.x, now.y - was.y) >= FOCUS_POINT_MOVE
}

/** The setting, as stored: on unless switched off. */
export const AUTO_CAMERA_KEY = 'mtgweb_scan_auto_zoom_focus'
export const autoCameraOn = (text: string | null) => text !== 'false'
