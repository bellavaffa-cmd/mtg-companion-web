/**
 * Finding the card itself in the camera's picture — its four edges, wherever it sits in the guide
 * and however it's tilted — and flattening it into a straight-on, card-shaped picture. Everything
 * that looks at the card afterwards (its look, its small print) then sees exactly the card: no
 * table round the edges, no guessing where inside the guide it was held.
 *
 * A card is held roughly in the guide, roughly upright, so each edge is looked for as a straight
 * line near where the guide says it should be: every nearly-upright line across a band either side
 * of the guide's left edge, scored by how sharp a step it runs along, and the same for the other
 * three. The strongest few candidates per side are then tried together, and the most card-shaped
 * four win — the outermost when there's a choice, since a card's frame draws a second rectangle
 * just inside its edge. When nothing card-shaped stands out (a black card on a black mat), there's
 * no answer and the guide is used as before.
 *
 * Plain arithmetic on a small grey picture, the same as the Android app's data/CardEdges.kt.
 */

import type { Box } from './ocr'

export interface Pt {
  x: number
  y: number
}

/** A card's four corners, clockwise from the top left, in the picture's pixels. */
export interface CardQuad {
  topLeft: Pt
  topRight: Pt
  bottomRight: Pt
  bottomLeft: Pt
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

export const quadWidth = (q: CardQuad) => (dist(q.topLeft, q.topRight) + dist(q.bottomLeft, q.bottomRight)) / 2
export const quadHeight = (q: CardQuad) => (dist(q.topLeft, q.bottomLeft) + dist(q.topRight, q.bottomRight)) / 2

/** [q] in a picture [by] times the size, shifted by ([dx], [dy]) after scaling. */
export function scaledQuad(q: CardQuad, by: number, dx = 0, dy = 0): CardQuad {
  const s = (p: Pt) => ({ x: p.x * by + dx, y: p.y * by + dy })
  return { topLeft: s(q.topLeft), topRight: s(q.topRight), bottomRight: s(q.bottomRight), bottomLeft: s(q.bottomLeft) }
}

/**
 * How much of the guide's size either side of each of its edges the card's edge is looked for in.
 *
 * Wide enough to reach the smallest card the outline check will accept. That check keeps outlines
 * down to half the expected size, and a card at half size — even centred — has its edges a quarter
 * of the expected size in from where the guide puts them, so a narrower band than that can never
 * find what the check would have allowed.
 *
 * It was 0.2, and a card filling two thirds of the guide (which is how people actually hold one)
 * had its top edge just out of reach: three sides found, the fourth missed, no card. On a bench of
 * 79 rendered scenes, 0.2 missed 16 of 72 cards, all of them small in the frame; 0.3 misses 1.
 * Wrong outlines stayed at 3 and no empty scene grew a card at any band from 0.2 to 0.4.
 */
export const EDGE_BAND = 0.3

/** The steepest lean an edge is looked for at, as sideways pixels per pixel along it (~11°). */
const MAX_LEAN = 0.2
const LEAN_STEPS = 21

/** How many of the strongest lines per side are tried against the other sides. */
const PER_SIDE = 4

/**
 * How sharp a step counts in full towards a line's score, in grey levels (of 255). Past this, a
 * sharper step counts no more: a line printed inside the card (the title bar, the text box) is often
 * far crisper than the card's own edge against the table, and it mustn't win on that alone. What
 * then counts is how much of its length a line is an edge at all — a straight edge all along, not a
 * few sharp spots where it happens to cross something.
 */
export const EDGE_CAP = 20

/**
 * How sharp an edge has to be, on average along its length, to count — with steps capped at
 * [EDGE_CAP], an edge along about 70% of its length. Below this it's texture, a shadow, or nothing.
 */
export const MIN_EDGE = 14

/** A tilted card is still near this shape (63 × 88 mm), but not outside these. */
const MIN_ASPECT = 0.62
const MAX_ASPECT = 0.82

/** Of the four-edge sets scoring within this share of the best, the biggest is the card. */
const NEAR_BEST = 0.85

/** A card's border is about 2.5 mm of its 63 mm width: between these shares of the card, with give. */
const BORDER_MIN = 0.02
const BORDER_MAX = 0.08

/** The edge outside a frame line only needs to be this much as sharp to be taken as the card's. */
const PARTNER_SHARE = 0.4

/** Grey levels (0-255) of RGBA pixels. */
export function greyOf(px: ArrayLike<number>): Float32Array {
  const out = new Float32Array(px.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
  return out
}

/** One side's candidate: `across = at + lean * (along - mid)`, and how sharp an edge runs along it. */
interface Line {
  at: number
  lean: number
  score: number
}

/**
 * The card's corners in a grey picture [width] × [height], held roughly where [expected] says, or
 * null when no four edges make a card of it. Corners are in the picture's continuous coordinates:
 * pixel (0, 0) covers 0 to 1 each way.
 */
export function findCard(grey: Float32Array, width: number, height: number, expected: Box): CardQuad | null {
  return findCards(grey, width, height, expected, 1)[0] ?? null
}

/**
 * The likeliest few outlines of the card, best first — for whatever reads the card next to try each
 * and keep the one that makes sense. The edges alone can't always tell a card's edge from a crisp
 * line printed just inside it (the title bar, the text box); what the card turns out to look like can.
 */
export function findCards(grey: Float32Array, width: number, height: number, expected: Box, most: number): CardQuad[] {
  if (width < 16 || height < 16) return []
  const [gx, gy] = gradients(grey, width, height)
  const ew = expected.width
  const eh = expected.height
  if (ew < 8 || eh < 8) return []
  const midX = expected.x + ew / 2
  const midY = expected.y + eh / 2
  const right = expected.x + ew
  const bottom = expected.y + eh

  // Upright sides run down the picture: x depends on y. Level sides run across it: y on x.
  // Only the middle of each side is sampled — a card's corners are rounded.
  const lefts = outermost(sideLines(gx, width, height, true, expected.x, ew * EDGE_BAND, expected.y + eh * 0.15, bottom - eh * 0.15, midY), -1, ew)
  const rights = outermost(sideLines(gx, width, height, true, right, ew * EDGE_BAND, expected.y + eh * 0.15, bottom - eh * 0.15, midY), 1, ew)
  const tops = outermost(sideLines(gy, width, height, false, expected.y, eh * EDGE_BAND, expected.x + ew * 0.15, right - ew * 0.15, midX), -1, eh)
  const bottoms = outermost(sideLines(gy, width, height, false, bottom, eh * EDGE_BAND, expected.x + ew * 0.15, right - ew * 0.15, midX), 1, eh)
  if (!lefts.length || !rights.length || !tops.length || !bottoms.length) return []

  const options: { quad: CardQuad; score: number; area: number }[] = []
  for (const l of lefts) for (const r of rights) for (const t of tops) for (const b of bottoms) {
    const quad = {
      topLeft: corner(l, t, midX, midY),
      topRight: corner(r, t, midX, midY),
      bottomRight: corner(r, b, midX, midY),
      bottomLeft: corner(l, b, midX, midY),
    }
    const w = quadWidth(quad)
    const h = quadHeight(quad)
    if (h <= 0 || w < ew * 0.5 || h < eh * 0.5) continue
    const aspect = w / h
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue
    options.push({ quad, score: l.score + r.score + t.score + b.score, area: w * h })
  }
  if (!options.length) return []
  const best = Math.max(...options.map((o) => o.score))
  // First the biggest of those scoring near the best; then the rest by score, leaving out any
  // that's all but the same outline as one already listed.
  const ranked = [...options].sort((a, b) => b.score - a.score)
  let first = ranked[0]
  for (const o of options) if (o.score >= best * NEAR_BEST && o.area > first.area) first = o
  const picked = [first]
  const same = (a: CardQuad, b: CardQuad) => corners(a).every((p, i) => dist(p, corners(b)[i]) <= ew * 0.015)
  for (const o of ranked) {
    if (picked.length >= most) break
    if (!picked.some((p) => same(p.quad, o.quad))) picked.push(o)
  }
  // Lines were placed by pixel; a pixel's middle is half a pixel in from its corner.
  return picked.map((o) => scaledQuad(o.quad, 1, 0.5, 0.5))
}

const corners = (q: CardQuad) => [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]

/**
 * A card's border draws two lines along each side: the card's edge, and just inside it the frame
 * or art, often the sharper of the two. So a line with a fainter parallel partner a border's width
 * further out ([outward] is which way out is) gives its place to that partner — the card is the
 * outer one. [size] is the card's size across the side, which the border's width is a share of.
 */
function outermost(lines: Line[], outward: number, size: number): Line[] {
  const out: Line[] = []
  for (const line of lines) {
    let partner: Line | null = null
    for (const other of lines) {
      const away = (other.at - line.at) * outward
      if (away >= size * BORDER_MIN && away <= size * BORDER_MAX && Math.abs(other.lean - line.lean) <= 0.03 && other.score >= line.score * PARTNER_SHARE) {
        if (!partner || (other.at - line.at) * outward > (partner.at - line.at) * outward) partner = other
      }
    }
    const chosen = partner ? { ...partner, score: Math.max(partner.score, line.score) } : line
    if (!out.some((o) => o.at === chosen.at && o.lean === chosen.lean && o.score === chosen.score)) out.push(chosen)
  }
  return out
}

/** Where a side's line and a level line cross. */
function corner(upright: Line, level: Line, midX: number, midY: number): Pt {
  // x = u.at + u.lean (y - midY);  y = l.at + l.lean (x - midX)
  const x = (upright.at + upright.lean * (level.at - level.lean * midX - midY)) / (1 - upright.lean * level.lean)
  return { x, y: level.at + level.lean * (x - midX) }
}

/** Sobel gradients, each roughly "grey levels of step" across the pixel. */
function gradients(g: Float32Array, w: number, h: number): [Float32Array, Float32Array] {
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1]
      const d = g[i - 1], f = g[i + 1]
      const p = g[i + w - 1], q = g[i + w], r = g[i + w + 1]
      gx[i] = (c + 2 * f + r - (a + 2 * d + p)) / 4
      gy[i] = (p + 2 * q + r - (a + 2 * b + c)) / 4
    }
  }
  return [gx, gy]
}

// Kotlin's roundToInt: halves go up.
const round = (v: number) => Math.floor(v + 0.5)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The strongest few lines for one side: across a band [band] either side of [around], at every lean,
 * sampled from [from] to [to] along the side. [vertical] sides are found in x, level ones in y.
 * A line scores the average sharpness of the step it runs along; only a line that beats its
 * neighbours a few pixels either side counts, so one edge doesn't fill every place on the list.
 */
function sideLines(
  grad: Float32Array, w: number, h: number, vertical: boolean,
  around: number, band: number, from: number, to: number, mid: number,
): Line[] {
  const acrossMax = vertical ? w - 2 : h - 2
  const alongMax = vertical ? h - 2 : w - 2
  const lo = clamp(round(around - band), 1, acrossMax)
  const hi = clamp(round(around + band), 1, acrossMax)
  const a0 = clamp(round(from), 1, alongMax)
  const a1 = clamp(round(to), 1, alongMax)
  if (hi <= lo || a1 - a0 < 4) return []
  const step = Math.max(1, Math.floor((a1 - a0) / 80))

  // The best lean at each place across.
  const best = new Float32Array(hi - lo + 1)
  const bestLean = new Float32Array(hi - lo + 1)
  for (let at = lo; at <= hi; at++) {
    for (let k = 0; k < LEAN_STEPS; k++) {
      const lean = Math.fround(-MAX_LEAN + (2 * MAX_LEAN * k) / (LEAN_STEPS - 1))
      let sum = 0
      let n = 0
      for (let along = a0; along <= a1; along += step) {
        const across = round(at + lean * (along - mid))
        if (across >= 1 && across <= acrossMax) {
          sum += Math.min(EDGE_CAP, Math.abs(vertical ? grad[along * w + across] : grad[across * w + along]))
          n++
        }
      }
      // Mostly off the picture isn't a line that was seen.
      const score = n * step * 2 < a1 - a0 ? 0 : sum / n
      if (score > best[at - lo]) {
        best[at - lo] = score
        bestLean[at - lo] = lean
      }
    }
  }
  const lines: Line[] = []
  for (let i = 0; i < best.length; i++) {
    const s = best[i]
    if (s < MIN_EDGE) continue
    let peak = true
    for (let j = Math.max(0, i - 3); j <= Math.min(best.length - 1, i + 3); j++) {
      if (j !== i && (best[j] > s || (best[j] === s && j < i))) {
        peak = false
        break
      }
    }
    if (!peak) continue
    // Where between pixels the edge really is: the top of a parabola through the peak and its
    // neighbours. A step between two pixels scores the same on both, and sits halfway.
    const before = i > 0 ? best[i - 1] : s
    const after = i < best.length - 1 ? best[i + 1] : s
    const bend = before - 2 * s + after
    const shift = bend < 0 ? clamp((0.5 * (before - after)) / bend, -0.5, 0.5) : 0
    lines.push({ at: lo + i + shift, lean: bestLean[i], score: s })
  }
  return lines.sort((a, b) => b.score - a.score).slice(0, PER_SIDE)
}

/**
 * Where a point of the flattened card lands in the picture — [u] and [v] from 0 to 1 across and
 * down the card. A perspective map (a plane seen at an angle), so a card tilted away from the
 * camera flattens back to the right shape and not just a straightened one.
 */
export function cardMap(quad: CardQuad): (u: number, v: number) => Pt {
  const { x: x0, y: y0 } = quad.topLeft
  const { x: x1, y: y1 } = quad.topRight
  const { x: x2, y: y2 } = quad.bottomRight
  const { x: x3, y: y3 } = quad.bottomLeft
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  let g = 0
  let h = 0
  if (Math.abs(sx) >= 1e-4 || Math.abs(sy) >= 1e-4) {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2
    const den = dx1 * dy2 - dx2 * dy1
    if (den !== 0) {
      g = (sx * dy2 - dx2 * sy) / den
      h = (dx1 * sy - sx * dy1) / den
    }
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0
  return (u, v) => {
    const z = g * u + h * v + 1
    return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z }
  }
}

/**
 * Part of the card flattened into [outW] × [outH] RGBA pixels: the card from [u0], [v0] to [u1],
 * [v1] (0 to 1 across and down it), picked out of [px] ([width] × [height], RGBA) through [quad].
 * Pixels that fall off the picture come out black.
 */
export function flatten(
  px: ArrayLike<number>, width: number, height: number, quad: CardQuad, outW: number, outH: number,
  u0 = 0, v0 = 0, u1 = 1, v1 = 1,
): Uint8ClampedArray<ArrayBuffer> {
  const map = cardMap(quad)
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let oy = 0; oy < outH; oy++) {
    const v = v0 + ((v1 - v0) * (oy + 0.5)) / outH
    for (let ox = 0; ox < outW; ox++) {
      const u = u0 + ((u1 - u0) * (ox + 0.5)) / outW
      const p = map(u, v)
      const o = (oy * outW + ox) * 4
      const x = p.x - 0.5
      const y = p.y - 0.5
      out[o + 3] = 255
      if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) continue
      const xi = clamp(Math.trunc(x), 0, width - 1)
      const yi = clamp(Math.trunc(y), 0, height - 1)
      const xn = Math.min(xi + 1, width - 1)
      const yn = Math.min(yi + 1, height - 1)
      const fx = clamp(x - xi, 0, 1)
      const fy = clamp(y - yi, 0, 1)
      for (let ch = 0; ch < 3; ch++) {
        const top = px[(yi * width + xi) * 4 + ch] * (1 - fx) + px[(yi * width + xn) * 4 + ch] * fx
        const bot = px[(yn * width + xi) * 4 + ch] * (1 - fx) + px[(yn * width + xn) * 4 + ch] * fx
        out[o + ch] = Math.round(top * (1 - fy) + bot * fy)
      }
    }
  }
  return out
}
