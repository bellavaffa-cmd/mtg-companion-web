import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardMap, findCard, flatten, greyOf, quadHeight, quadWidth, type CardQuad, type Pt } from '../../src/scan/cardEdges.ts'

// Finding a card's edges in a picture and flattening it. The Android app has the same checks — see
// CardEdgesTest.kt.

const W = 200
const H = 260

/** The guide the card is expected in: card-shaped, in the middle of the picture. */
const GUIDE = { x: 35, y: 32, width: 130, height: 182 }

interface Card {
  cx?: number
  cy?: number
  cw?: number
  ch?: number
  degrees?: number
}

/** A card centred at ([cx], [cy]), turned [degrees], on a [background]: RGBA pixels. */
function scene(
  { cx = 100, cy = 123, cw = 130, ch = 182, degrees = 0 }: Card = {},
  background: (x: number, y: number) => number = (x, y) => 205 + ((x * 7 + y * 13) % 9) - 4,
): Uint8ClampedArray {
  const rad = (degrees * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const px = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const x = (i % W) + 0.5
    const y = Math.floor(i / W) + 0.5
    const lx = (x - cx) * c + (y - cy) * s
    const ly = -(x - cx) * s + (y - cy) * c
    let grey: number
    if (Math.abs(lx) > cw / 2 || Math.abs(ly) > ch / 2) grey = background(i % W, Math.floor(i / W))
    // The black border, then the frame and art inside it: a second rectangle, just in.
    else if (Math.abs(lx) > (cw / 2) * 0.9 || Math.abs(ly) > (ch / 2) * 0.93) grey = 22
    else grey = 150 + ((Math.trunc(Math.trunc(lx) / 6) + Math.trunc(Math.trunc(ly) / 9)) % 3) * 30
    px.set([grey, grey, grey, 255], i * 4)
  }
  return px
}

function corners({ cx = 100, cy = 123, cw = 130, ch = 182, degrees = 0 }: Card = {}): Pt[] {
  const rad = (degrees * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = (sx * cw) / 2
    const ly = (sy * ch) / 2
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c }
  })
}

function assertCorners(expected: Pt[], quad: CardQuad | null, within: number) {
  assert.ok(quad, 'no card found')
  const found = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  expected.forEach((e, i) => {
    const f = found[i]
    assert.ok(Math.hypot(e.x - f.x, e.y - f.y) <= within, `expected ${JSON.stringify(e)}, found ${JSON.stringify(f)}`)
  })
}

const find = (px: Uint8ClampedArray) => findCard(greyOf(px), W, H, GUIDE)

test('a card held straight in the guide is found to the pixel', () => {
  assertCorners(corners(), find(scene()), 0.75)
})

test('a card held off centre and smaller than the guide is found', () => {
  const card = { cx: 108, cy: 116, cw: 116, ch: 162 }
  assertCorners(corners(card), find(scene(card)), 1.5)
})

test('a tilted card is found at its tilt', () => {
  assertCorners(corners({ degrees: 7 }), find(scene({ degrees: 7 })), 2.5)
  assertCorners(corners({ degrees: -5 }), find(scene({ degrees: -5 })), 2.5)
})

test("the card's edge is found, not the frame just inside it", () => {
  const quad = find(scene())
  assert.ok(quad)
  assert.ok(Math.abs(quadWidth(quad) - 130) <= 2)
  assert.ok(Math.abs(quadHeight(quad) - 182) <= 2)
})

test('a dark card on a busy table is still found', () => {
  assertCorners(corners(), find(scene({}, (x, y) => 90 + ((Math.trunc(x / 3) + Math.trunc(y / 5)) % 4) * 18)), 2)
})

test('nothing is found where there is no card', () => {
  assert.equal(find(new Uint8ClampedArray(W * H * 4).fill(127)), null)
  assert.equal(find(scene({}, () => 22).map(() => 22)), null)
})

test("the flattening map puts the card's corners on the quad's corners", () => {
  const map = cardMap({ topLeft: { x: 10, y: 20 }, topRight: { x: 110, y: 25 }, bottomRight: { x: 115, y: 160 }, bottomLeft: { x: 5, y: 150 } })
  const near = (p: Pt, x: number, y: number) => assert.ok(Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01, JSON.stringify(p))
  near(map(0, 0), 10, 20)
  near(map(1, 0), 110, 25)
  near(map(1, 1), 115, 160)
  near(map(0, 1), 5, 150)
})

test('a tilted card flattens back to the straight card', () => {
  const straight = scene()
  const tilted = scene({ degrees: 7 })
  const a = flatten(straight, W, H, find(straight)!, 63, 88)
  const b = flatten(tilted, W, H, find(tilted)!, 63, 88)
  let off = 0
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 40) off++
  assert.ok(off < (63 * 88) / 20, `${off} pixels differ`)
})
