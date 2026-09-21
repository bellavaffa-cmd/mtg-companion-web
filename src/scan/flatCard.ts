/**
 * The card found in the camera's picture (see findCards in cardEdges.ts), ready to be looked at
 * straight on: its look for matching the printing, and its small print flattened out for reading.
 * Mirrors the Android app's ui/scan/FlatCard.kt.
 */

import { findCards, flatten, greyOf, scaledQuad, type CardQuad } from './cardEdges'
import type { Box } from './ocr'
import { cardShaped, GRID_H, GRID_W, PRINTING_INSET, signatureFromPixels, type ArtSignature } from './printingMatch'

/** How wide the picture is shrunk to for finding the edges: plenty to place them, and quick. */
const SEARCH_W = 240

/** How far past the guide the edges are looked for, as a share of its size each way. */
const SEARCH_SLACK = 0.25

/** How many of the likeliest outlines the card's look is measured through. */
const OUTLINES = 3

/**
 * Where a card's printed frame sits inside it: its black (or white) border is about this share of
 * the card on each side — thicker at the bottom, where the small print is. On a mat the same colour
 * as the border, the frame is the rectangle the edges find, and the card is this much bigger.
 */
const BORDER_SIDE = 0.039
const BORDER_TOP = 0.028
const BORDER_BOTTOM = 0.065

/** The flattened card's height for the small-print reader: its letters come out about 16 px tall. */
const FLAT_H = 1040
const FLAT_W = Math.round((FLAT_H * 63) / 88)

const LOOK_W = GRID_W * 16
const LOOK_H = GRID_H * 16

/** A hair either way of the printing's own trim: an edge found a pixel out on the small copy is more on the full one. */
const LOOK_JITTER = [-0.012, 0, 0.012]

export interface FlatCard {
  /** The searched area of the picture, RGBA, and its size. */
  px: Uint8ClampedArray
  width: number
  height: number
  /** The likeliest outlines of the card in that area, best first. */
  quads: CardQuad[]
  /** Where the area sits in the source picture. */
  x: number
  y: number
}

const sizeOf = (source: CanvasImageSource) =>
  source instanceof HTMLVideoElement ? { w: source.videoWidth, h: source.videoHeight } : { w: (source as HTMLCanvasElement).width, h: (source as HTMLCanvasElement).height }

/**
 * The card in [source], held near [guide] (in the source's pixels) — or null when its edges can't
 * be made out, and the guide is used instead.
 */
export function flattenCard(source: CanvasImageSource, guide: Box): FlatCard | null {
  const { w, h } = sizeOf(source)
  if (!w || !h) return null
  const expected = cardShaped(guide)
  const ax = Math.max(0, Math.floor(expected.x - expected.width * SEARCH_SLACK))
  const ay = Math.max(0, Math.floor(expected.y - expected.height * SEARCH_SLACK))
  const aw = Math.min(w, Math.ceil(expected.x + expected.width * (1 + SEARCH_SLACK))) - ax
  const ah = Math.min(h, Math.ceil(expected.y + expected.height * (1 + SEARCH_SLACK))) - ay
  if (aw < 40 || ah < 40) return null
  // The area at full size, and a small copy of it to find the edges in.
  const full = document.createElement('canvas')
  full.width = aw
  full.height = ah
  const fctx = full.getContext('2d', { willReadFrequently: true })
  if (!fctx) return null
  fctx.drawImage(source, ax, ay, aw, ah, 0, 0, aw, ah)
  const scale = SEARCH_W / aw
  const sw = SEARCH_W
  const sh = Math.max(1, Math.round(ah * scale))
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d', { willReadFrequently: true })
  if (!sctx) return null
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(full, 0, 0, sw, sh)
  const found = findCards(greyOf(sctx.getImageData(0, 0, sw, sh).data), sw, sh, {
    x: (expected.x - ax) * scale, y: (expected.y - ay) * scale, width: expected.width * scale, height: expected.height * scale,
  }, OUTLINES)
  if (!found.length) return null
  return { px: fctx.getImageData(0, 0, aw, ah).data, width: aw, height: ah, quads: found.map((q) => scaledQuad(q, 1 / scale)), x: ax, y: ay }
}

/**
 * The likeliest outline flattened into a canvas of its own, for the small-print reader — which takes
 * the whole of it as the card (see [wholeCard]).
 */
export function flatCanvas(flat: FlatCard): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = FLAT_W
  canvas.height = FLAT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(flatten(flat.px, flat.width, flat.height, flat.quads[0], FLAT_W, FLAT_H), FLAT_W, FLAT_H), 0, 0)
  return canvas
}

/** A whole canvas as a box, for the readers that take one. */
export const wholeCard = (canvas: HTMLCanvasElement): Box => ({ x: 0, y: 0, width: canvas.width, height: canvas.height })

/**
 * What the card looks like, for bestPrinting: through each of the likeliest outlines, taken as the
 * card's edge and as its printed frame, with the same trim as a printing's picture and a hair either
 * way of it. Whichever of them is really the card is the one that will match.
 */
export function flatSignatures(flat: FlatCard): ArtSignature[] {
  const out: ArtSignature[] = []
  for (const quad of flat.quads) {
    for (const frame of [false, true]) {
      // The card's own 0-1 across and down, in the outline's: the same, or reaching past the frame.
      const u = (c: number) => (frame ? (c - BORDER_SIDE) / (1 - 2 * BORDER_SIDE) : c)
      const v = (c: number) => (frame ? (c - BORDER_TOP) / (1 - BORDER_TOP - BORDER_BOTTOM) : c)
      for (const du of LOOK_JITTER) {
        for (const dv of LOOK_JITTER) {
          const px = flatten(
            flat.px, flat.width, flat.height, quad, LOOK_W, LOOK_H,
            u(PRINTING_INSET + du), v(PRINTING_INSET + dv), u(1 - PRINTING_INSET + du), v(1 - PRINTING_INSET + dv),
          )
          out.push(signatureFromPixels(px, LOOK_W, LOOK_H))
        }
      }
    }
  }
  return out
}
