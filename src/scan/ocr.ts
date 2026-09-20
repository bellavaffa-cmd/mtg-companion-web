// Reading a card's name from a camera frame with Tesseract (tesseract.js), in a Web Worker so the camera
// view stays smooth. The reader — its engine and English data, about 4.5 MB — is fetched from jsDelivr
// the first time the scanner opens, then kept by the browser.
//
// A frame is read one thin strip at a time, where the title is: first where the image says it is
// (locateTitle), then, if that reads as no card at all, at the usual title heights. Every read is
// matched against the list of real card names (cardNames.ts), which forgives a misread letter and
// ignores the noise a card's frame produces.

import type { Worker } from 'tesseract.js'
import { MIN_MATCH, type NameIndex, type NameMatch } from './cardNames'
import { cleanTitle } from './scanLogic'

/** Title strips are scaled to this height before reading: Tesseract reads best at around 30px letters. */
const STRIP_HEIGHT = 64
/** A strip's height, as a fraction of the card's: a title line with room for a slightly tilted card. */
const STRIP_SPAN = 0.07
/** Where a title's middle usually is, top to bottom (fractions of the card's height), tried after the located one. */
const USUAL_TITLE_ROWS = [0.06, 0.085]
/**
 * A match this close ends the search at once. A weaker one might be part of the title matching a
 * shorter card ("Angel" for Serra Angel), so the other heights get read too and the best one wins.
 */
const SURE_MATCH = 0.8

let reader: Promise<Worker> | null = null

/**
 * The title reader, started on first use. [onProgress] hears 0..1 while it downloads (first time
 * only). A failure (offline, say) lets the next call try again.
 */
export function titleReader(onProgress?: (fraction: number) => void): Promise<Worker> {
  reader ??= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js')
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status.startsWith('loading')) onProgress?.(m.progress)
      },
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' })
    return worker
  })()
  reader.catch(() => { reader = null })
  return reader
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the title line is on the card at [card] in [source], as a fraction of the card's height: the
 * band near the top with the most sharp light/dark changes along its rows (letters have many; the
 * plain title bar and the frame's lines have few).
 */
export function locateTitle(source: CanvasImageSource, card: Box): number {
  const x0 = card.x + card.width * 0.08
  const x1 = card.x + card.width * 0.7
  const y0 = card.y - card.height * 0.02
  const y1 = card.y + card.height * 0.17
  const w = 400
  const h = Math.max(8, Math.round((w * (y1 - y0)) / (x1 - x0)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const rows = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let changes = 0
    let previous = 0.299 * px[y * w * 4] + 0.587 * px[y * w * 4 + 1] + 0.114 * px[y * w * 4 + 2]
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4
      const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      if (Math.abs(grey - previous) > 28) changes++
      previous = grey
    }
    rows[y] = changes
  }
  const band = Math.max(2, Math.round((h * 0.04) / 0.19))
  let best = -1
  let bestAt = 0
  let sum = 0
  for (let y = 0; y < h; y++) {
    sum += rows[y]
    if (y >= band) sum -= rows[y - band]
    if (y >= band - 1 && sum > best) { best = sum; bestAt = y - band + 1 }
  }
  const middle = y0 + ((bestAt + band / 2) * (y1 - y0)) / h
  return (middle - card.y) / card.height
}

/**
 * A strip across the card at [card] in [source], centred [row] (a fraction of the card's height) down
 * it, left of the mana cost: turned grey, stretched to full contrast and scaled up for reading.
 */
export function titleStrip(source: CanvasImageSource, card: Box, row: number): HTMLCanvasElement {
  const sx = card.x + card.width * 0.05
  const sw = card.width * 0.77
  const sy = card.y + card.height * (row - STRIP_SPAN / 2)
  const sh = card.height * STRIP_SPAN
  const scale = STRIP_HEIGHT / sh
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = STRIP_HEIGHT
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = image.data
  let min = 255
  let max = 0
  for (let i = 0; i < px.length; i += 4) {
    const grey = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])
    px[i] = grey
    if (grey < min) min = grey
    if (grey > max) max = grey
  }
  const range = Math.max(1, max - min)
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = ((px[i] - min) * 255) / range
  ctx.putImageData(image, 0, 0)
  return canvas
}

// One read at a time on the shared reader: the small print switches its mode for a moment, and a
// title read slipping in then (a second scan page's loop, say) would run in the wrong mode.
let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

/**
 * Reads the small print at the bottom left of the card at [card] in [source] (set code, language,
 * collector number) and returns it as text; [parseSetAndNumber] makes the printing of it. Read once
 * per new card, not every frame: it's two short lines of tiny text.
 */
/**
 * How to cut the strip at the bottom of the card. The set line sits bottom-left, but a card held at
 * an angle, or one with a pale border, reads better from a taller strip or without the flip — so
 * there are a few ways to try before giving up on the printing.
 */
export interface StripStyle {
  /** Where the strip starts and ends, as a share of the card's height. */
  from: number
  to: number
  /** How much of the card's width it covers. */
  width: number
  /** Light text on a dark border is flipped; a pale border reads better as it is. */
  flip: boolean
}

export const STRIP_STYLES: StripStyle[] = [
  { from: 0.91, to: 0.99, width: 0.55, flip: true },
  // Taller and wider: a card held at an angle, or one whose line sits a little higher.
  { from: 0.86, to: 1.0, width: 0.75, flip: true },
  // A pale border — a full-art or borderless card — has dark text already.
  { from: 0.88, to: 1.0, width: 0.75, flip: false },
]

export function readSmallPrint(source: CanvasImageSource, card: Box, style: StripStyle = STRIP_STYLES[0]): Promise<string> {
  return oneAtATime(() => readSmallPrintAlone(source, card, style))
}

async function readSmallPrintAlone(source: CanvasImageSource, card: Box, style: StripStyle): Promise<string> {
  const worker = await titleReader()
  const sx = card.x + card.width * 0.03
  const sw = card.width * style.width
  const sy = card.y + card.height * style.from
  const sh = card.height * (style.to - style.from)
  const height = 160
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((sw * height) / sh))
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = image.data
  let min = 255
  let max = 0
  for (let i = 0; i < px.length; i += 4) {
    const grey = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])
    px[i] = grey
    if (grey < min) min = grey
    if (grey > max) max = grey
  }
  const range = Math.max(1, max - min)
  // Small print is usually light on a dark border: flipped, it's the dark-on-light the reader likes.
  for (let i = 0; i < px.length; i += 4) {
    const stretched = ((px[i] - min) * 255) / range
    px[i] = px[i + 1] = px[i + 2] = style.flip ? 255 - stretched : stretched
  }
  ctx.putImageData(image, 0, 0)
  const { PSM } = await import('tesseract.js')
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
  try {
    return (await worker.recognize(canvas)).data.text
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
  }
}

export interface CardRead {
  /** The card it matched, or null when nothing read as a card. */
  match: NameMatch | null
  /** What the reader saw, for showing while scanning. */
  seen: string
}

/** The best card name among the lines of [text]. */
function bestMatch(text: string, names: NameIndex): NameMatch | null {
  let best: NameMatch | null = null
  for (const line of text.split('\n')) {
    const title = cleanTitle(line)
    const match = title ? names.match(title) : null
    if (match && (!best || match.score > best.score)) best = match
  }
  return best
}

/** Reads the name of the card at [card] (the guide box, in [source]'s own pixels). */
export function readCardName(source: CanvasImageSource, card: Box, names: NameIndex): Promise<CardRead> {
  return oneAtATime(() => readCardNameAlone(source, card, names))
}

async function readCardNameAlone(source: CanvasImageSource, card: Box, names: NameIndex): Promise<CardRead> {
  const worker = await titleReader()
  const rows = [locateTitle(source, card), ...USUAL_TITLE_ROWS]
  let best: NameMatch | null = null
  let seen = ''
  for (const row of rows) {
    const text = (await worker.recognize(titleStrip(source, card, row))).data.text
    const match = bestMatch(text, names)
    if (!seen && text.trim()) seen = text.trim()
    if (match && (!best || match.score > best.score)) {
      best = match
      seen = text.trim()
    }
    if (best && best.score >= SURE_MATCH) break
  }
  return { match: best && best.score >= MIN_MATCH ? best : null, seen }
}
