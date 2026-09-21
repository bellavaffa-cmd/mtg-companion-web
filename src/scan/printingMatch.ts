/**
 * Which printing is in your hand, from what the card looks like.
 *
 * The camera reads a card's name easily. The tiny line that says *which* printing it is — the
 * alternate art, the borderless one, the full-art basic — is a few pixels tall and often can't be
 * read at all, and then the card comes in as whatever printing Scryfall considers the usual one.
 * So the card in the frame is boiled down to a small grid of colour and held up against every
 * printing of that name; the closest one wins.
 *
 * The comparison is deliberately coarse. A photo taken under a lamp at a slight angle will never
 * match a clean scan pixel for pixel, but what makes printings tell apart — where the picture is
 * light and dark, what colours it leans on, whether there's a border around it at all — survives
 * the lamp, the angle and a camera's guesswork. Mirrors the Android app's data/ArtMatch.kt.
 */

import type { Box } from './ocr'
import type { ScryfallCard } from '../types/scryfall'

/** The grid a card is boiled down to. A card is taller than it is wide, and so is this. */
export const GRID_W = 8
export const GRID_H = 11
const CELLS = GRID_W * GRID_H

/** A Magic card is 63 × 88 mm. */
export const CARD_ASPECT = 63 / 88

/**
 * How much is trimmed off each edge before comparing. A card held to fill the guide never fills it
 * exactly, so the outermost sliver is as likely to be the table behind it as the card.
 */
const INSET = 0.04

/** A card's look: an average colour per cell, levelled so the lighting doesn't count. */
export type ArtSignature = Float32Array

/**
 * The biggest card-shaped box that fits inside [box], centred. The framing guide isn't quite a
 * card's shape, and a card squeezed into the wrong shape doesn't look like itself any more.
 */
export function cardShaped(box: Box): Box {
  const width = Math.min(box.width, box.height * CARD_ASPECT)
  const height = width / CARD_ASPECT
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

/** [box] with [INSET] of it taken off each edge. */
function inset(box: Box): Box {
  return {
    x: box.x + box.width * INSET,
    y: box.y + box.height * INSET,
    width: box.width * (1 - INSET * 2),
    height: box.height * (1 - INSET * 2),
  }
}

/**
 * Takes the lighting out of a grid of raw colour: each channel is re-centred on its own average and
 * scaled by how much it varies across the card. A dim photo and a bright scan of the same card come
 * out of this the same, which is the whole point.
 */
export function levelled(raw: ArrayLike<number>): ArtSignature {
  const out = new Float32Array(raw.length)
  const cells = raw.length / 3
  for (let channel = 0; channel < 3; channel++) {
    let sum = 0
    for (let i = channel; i < raw.length; i += 3) sum += raw[i]
    const mean = sum / cells
    let spread = 0
    for (let i = channel; i < raw.length; i += 3) spread += (raw[i] - mean) ** 2
    // A blank card — every cell the same — has nothing to scale by, so it's left flat rather than
    // divided by zero into noise.
    const deviation = Math.sqrt(spread / cells) || 1
    for (let i = channel; i < raw.length; i += 3) out[i] = (raw[i] - mean) / deviation
  }
  return out
}

/** Boils RGBA pixels [width] × [height] down to the grid, averaging each cell, then levels it. */
export function signatureFromPixels(px: ArrayLike<number>, width: number, height: number): ArtSignature {
  const raw = new Float32Array(CELLS * 3)
  for (let gy = 0; gy < GRID_H; gy++) {
    const y0 = Math.floor((gy * height) / GRID_H)
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / GRID_H))
    for (let gx = 0; gx < GRID_W; gx++) {
      const x0 = Math.floor((gx * width) / GRID_W)
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / GRID_W))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          r += px[i]
          g += px[i + 1]
          b += px[i + 2]
          n++
        }
      }
      const cell = (gy * GRID_W + gx) * 3
      raw[cell] = r / n
      raw[cell + 1] = g / n
      raw[cell + 2] = b / n
    }
  }
  return levelled(raw)
}

/** How unlike two cards look. 0 is the same picture; two unrelated cards land somewhere near 2. */
export function artDistance(a: ArtSignature, b: ArtSignature): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return sum / a.length
}

/**
 * Where the card in the frame might really be, around the guide. Nobody holds a card exactly inside
 * the guide, and a picture cut from the guide alone was card and table and a sliver of the next
 * thing along — tried on Sol Ring's printings photographed a little off centre, it named the
 * printing 25 times in 48, and got it wrong twice. So the camera's card is measured at a small grid
 * of positions and sizes around the guide, and each printing is compared at the one that suits it
 * best: 48 in 48, none wrong.
 */
export const LOOK_SCALES = [0.9, 1, 1.1]
export const LOOK_SHIFTS = [-0.08, -0.04, 0, 0.04, 0.08]

/** The card-shaped boxes, around [guide], that the camera's card is measured at. */
export function lookBoxes(guide: Box): Box[] {
  const card = cardShaped(guide)
  const cx = card.x + card.width / 2
  const cy = card.y + card.height / 2
  const out: Box[] = []
  for (const s of LOOK_SCALES) {
    for (const ox of LOOK_SHIFTS) {
      for (const oy of LOOK_SHIFTS) {
        const width = card.width * s
        const height = card.height * s
        out.push({ x: cx + ox * card.width - width / 2, y: cy + oy * card.height - height / 2, width, height })
      }
    }
  }
  return out
}

/** The share of the card compared: the fifth that agrees worst is left out. */
const TRIM_KEEP = 0.8

/**
 * How unlike a photographed card is to a printing, leaving out the fifth of the card that agrees
 * worst. A reflection, a thumb, a sleeve's edge washes out part of the picture, and on a plain
 * average that one patch decides the answer; left out, the rest of the card does. Photos with a
 * reflection went from 2 in 12 to 6 in 12, and still none wrong.
 */
export function trimmedDistance(camera: ArtSignature, printing: ArtSignature): number {
  const cells = camera.length / 3
  const diffs = new Float32Array(cells)
  for (let i = 0; i < cells; i++) {
    let sum = 0
    for (let k = 0; k < 3; k++) sum += (camera[i * 3 + k] - printing[i * 3 + k]) ** 2
    diffs[i] = sum / 3
  }
  diffs.sort()
  const keep = Math.max(1, Math.floor(cells * TRIM_KEEP))
  let total = 0
  for (let i = 0; i < keep; i++) total += diffs[i]
  return total / keep
}

/** How unlike the camera's card is to a printing: at whichever of its measurings suits it best. */
function lookDistance(looks: ArtSignature[], printing: ArtSignature): number {
  let best = Infinity
  for (const look of looks) {
    const d = trimmedDistance(look, printing)
    if (d < best) best = d
  }
  return best
}

/** Closer than this and two printings are the same picture — the same art in the same frame. */
export const SAME_LOOK = 0.08

/**
 * Further than this from every printing and the camera saw something that can't be placed.
 *
 * Magic cards are far more alike than they look: they share a frame, a border and a layout, so two
 * cards with nothing to do with each other still score around 0.2 — a Lightning Bolt against Sol
 * Ring's printings came out at 0.23. Photographed printings of the *right* card land between 0.02
 * and 0.25. Those two ranges touch, which is why this is a sanity check and not the decision: what
 * actually picks the printing is having to beat the runner-up, below.
 */
export const MATCH_MAX = 0.6

/** The winner has to be at least this much closer than the nearest printing that looks different. */
export const CLEAR_BY = 0.8

export interface PrintingMatch<T> {
  /** The printing the card in the frame looks most like. */
  pick: T
  /** How close it was — smaller is a better likeness. */
  distance: number
  /**
   * Whether that picture belongs to this printing alone. False when several printings share it —
   * the same art in the same frame, reprinted — which no camera can tell apart, and then only the
   * set code can say which one it really is.
   */
  only: boolean
}

/** What one set's printings of a card say about the card in the frame (see decideInSet). */
export type SetDecision<T> =
  /** It's this one; [only] is false when another printing in the set looks just like it. */
  | { kind: 'found'; pick: T; only: boolean }
  /** It's in this set, but its versions look too alike to call: [regular] is the best guess. */
  | { kind: 'unsure'; regular: T }
  /** Nothing in the set looks like it — the set code was most likely misread. */
  | { kind: 'misread' }

/**
 * The card's printings in the set its small print named, held up against what the camera saw. A set
 * rarely holds more than a few versions of a card — regular, full art, borderless, showcase — and
 * they differ in the whole layout, not just the picture, which is far easier to tell apart than one
 * printing among a hundred. Even a set with a single version is checked: a set code misread as
 * another real set mustn't quietly name a printing the card in hand looks nothing like. Mirrors the
 * Android app's decideInSet in data/PrintingMatch.kt.
 */
export function decideInSet<T>(
  looks: ArtSignature[],
  candidates: { item: T; signature: ArtSignature }[],
  regular: T,
): SetDecision<T> {
  if (candidates.length === 0 || looks.length === 0) return { kind: 'misread' }
  const nearest = Math.min(...candidates.map((c) => lookDistance(looks, c.signature)))
  if (nearest > MATCH_MAX) return { kind: 'misread' }
  const found = bestPrinting(looks, candidates)
  return found ? { kind: 'found', pick: found.pick, only: found.only } : { kind: 'unsure', regular }
}

/**
 * The printing [camera] looks most like, or null when nothing is close enough or two printings that
 * genuinely look different are too near to call. Saying nothing is the right answer there: a wrong
 * printing recorded silently is worse than none, and the scan falls back to asking.
 */
export function bestPrinting<T>(
  camera: ArtSignature | ArtSignature[],
  candidates: { item: T; signature: ArtSignature }[],
): PrintingMatch<T> | null {
  if (candidates.length === 0) return null
  const looks = Array.isArray(camera) ? camera : [camera]
  if (looks.length === 0) return null
  const ranked = candidates
    .map((c) => ({ ...c, distance: lookDistance(looks, c.signature) }))
    .sort((a, b) => a.distance - b.distance)
  const best = ranked[0]
  if (best.distance > MATCH_MAX) return null

  const others = ranked.slice(1)
  const sameLook = others.filter((c) => artDistance(best.signature, c.signature) <= SAME_LOOK)
  // The nearest printing that isn't just this one reprinted — the one it could be confused with.
  const rival = others.find((c) => artDistance(best.signature, c.signature) > SAME_LOOK)
  if (rival && best.distance > rival.distance * CLEAR_BY) return null

  return { pick: best.item, distance: best.distance, only: sameLook.length === 0 }
}

// ---------------------------------------------------------------------------------------------
// Pictures. Everything above is arithmetic; everything below needs a browser.
// ---------------------------------------------------------------------------------------------

/** The card at [box] in [source], as a signature — taken straight off the camera, so no waiting. */
export function signatureOfSource(source: CanvasImageSource, box: Box): ArtSignature | null {
  const card = inset(cardShaped(box))
  if (card.width < 1 || card.height < 1) return null
  const canvas = document.createElement('canvas')
  canvas.width = GRID_W * 8
  canvas.height = GRID_H * 8
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, card.x, card.y, card.width, card.height, 0, 0, canvas.width, canvas.height)
  return signatureFromPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
}

/**
 * The camera's card measured at every look box around [guide] (see lookBoxes). The area they cover
 * is copied small once and sampled from, rather than the full camera picture seventy-five times.
 */
export function cameraSignatures(source: CanvasImageSource, guide: Box): ArtSignature[] {
  const boxes = lookBoxes(guide)
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  const scale = 240 / (right - left)
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round((right - left) * scale))
  small.height = Math.max(1, Math.round((bottom - top) * scale))
  // Kept on the CPU: it's read from seventy-five times, and a GPU canvas pays for a round trip on
  // every one of them.
  const ctx = small.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, left, top, right - left, bottom - top, 0, 0, small.width, small.height)
  // One canvas the size of the grid's sampling, reused for every box: making one per box cost more
  // than all the measuring put together (1.3 s a card).
  const sampler = document.createElement('canvas')
  sampler.width = GRID_W * 8
  sampler.height = GRID_H * 8
  const sctx = sampler.getContext('2d', { willReadFrequently: true })
  if (!sctx) return []
  sctx.imageSmoothingQuality = 'high'
  const out: ArtSignature[] = []
  for (const b of boxes) {
    const card = inset(cardShaped({ x: (b.x - left) * scale, y: (b.y - top) * scale, width: b.width * scale, height: b.height * scale }))
    if (card.width < 1 || card.height < 1) continue
    sctx.clearRect(0, 0, sampler.width, sampler.height)
    sctx.drawImage(small, card.x, card.y, card.width, card.height, 0, 0, sampler.width, sampler.height)
    out.push(signatureFromPixels(sctx.getImageData(0, 0, sampler.width, sampler.height).data, sampler.width, sampler.height))
  }
  return out
}

/** Signatures worked out this session, so a card scanned twice doesn't fetch its printings twice. */
const known = new Map<string, Promise<ArtSignature | null>>()

/** A printing's small picture from Scryfall, as a signature. Null if it can't be fetched or read. */
function signatureOfUrl(url: string): Promise<ArtSignature | null> {
  let signature = known.get(url)
  if (signature) return signature
  signature = (async () => {
    const image = new Image()
    // Scryfall serves its pictures to any site, which is what lets the pixels be read back out.
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = url
    })
    if (!loaded) return null
    // The picture is shrunk the same way the camera's card is, so the two can be compared at all.
    const trim = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
    return signatureOfSource(image, trim)
  })()
  // A picture that failed to load gets another chance next time rather than being remembered wrong.
  signature.then((got) => { if (!got) known.delete(url) }).catch(() => known.delete(url))
  known.set(url, signature)
  return signature
}

/** The picture used for matching: small (about 10 KB), and it shows the frame as well as the art. */
function pictureOf(card: ScryfallCard): string | null {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small ?? null
}

/** How many printings are worth fetching — enough to cover a basic land, which is the worst case. */
const MOST_PRINTINGS = 1000

/** How many pictures are fetched at once — enough to be quick, few enough to be a good guest. */
const AT_ONCE = 6

/**
 * A likeness this close is the card itself. The same printing photographed lands around 0.05, and
 * the nearest printing that isn't it rarely gets under 0.4, so there is a wide gap to stop in.
 */
const CERTAIN = 0.15

/**
 * ...but only worth stopping for when there's real fetching left to save. Finishing the list is
 * what tells us whether any *other* printing shares that picture, and it's worth a few seconds in
 * the background to know. Only a basic land — hundreds of printings deep — is long enough that
 * walking all of it costs more than the answer is worth.
 */
const WORTH_STOPPING = 150

/**
 * The printing among [printings] that the card the camera saw looks most like. Fetches each
 * printing's picture (small, and cached by the browser after the first time), so this is meant to
 * run behind the scan rather than in front of it.
 */
/** Each of [printings] measured from its picture, for choosing among a short list (see decideInSet). */
export async function measurePrintings(printings: ScryfallCard[]): Promise<{ item: ScryfallCard; signature: ArtSignature }[]> {
  const wanted = printings.filter(pictureOf)
  const measured: { item: ScryfallCard; signature: ArtSignature }[] = []
  for (let i = 0; i < wanted.length; i += AT_ONCE) {
    const batch = await Promise.all(wanted.slice(i, i + AT_ONCE).map(async (card) => {
      const signature = await signatureOfUrl(pictureOf(card)!)
      return signature ? { item: card, signature } : null
    }))
    for (const got of batch) if (got) measured.push(got)
  }
  return measured
}

export async function matchPrinting(camera: ArtSignature | ArtSignature[], printings: ScryfallCard[]): Promise<PrintingMatch<ScryfallCard> | null> {
  const wanted = printings.slice(0, MOST_PRINTINGS).filter(pictureOf)
  const candidates: { item: ScryfallCard; signature: ArtSignature }[] = []
  for (let i = 0; i < wanted.length; i += AT_ONCE) {
    const batch = await Promise.all(wanted.slice(i, i + AT_ONCE).map(async (card) => {
      const signature = await signatureOfUrl(pictureOf(card)!)
      return signature ? { item: card, signature } : null
    }))
    for (const got of batch) if (got) candidates.push(got)

    // A basic land has hundreds of printings and they're nearly all somebody's idea of a field at
    // dawn, so the list is walked newest first and dropped as soon as one of them is plainly the
    // card in hand. Stopping means the rest were never looked at, so the printing can't be claimed
    // as the only one with that picture — the scan says "best guess" and offers the others.
    const left = wanted.length - i - AT_ONCE
    if (left > WORTH_STOPPING) {
      const sure = bestPrinting(camera, candidates)
      if (sure && sure.distance <= CERTAIN) return { ...sure, only: false }
    }
  }
  return bestPrinting(camera, candidates)
}
