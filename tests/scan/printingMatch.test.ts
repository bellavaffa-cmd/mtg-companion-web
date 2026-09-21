import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_ASPECT,
  GRID_H,
  GRID_W,
  MATCH_MAX,
  SAME_LOOK,
  artDistance,
  bestPrinting,
  cardShaped,
  decideInSet,
  levelled,
  lookBoxes,
  LOOK_SCALES,
  LOOK_SHIFTS,
  trimmedDistance,
  signatureFromPixels,
} from '../../src/scan/printingMatch'

/** RGBA pixels [width] × [height], coloured by [at]. */
function picture(width: number, height: number, at: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y)
      const i = (y * width + x) * 4
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  }
  return px
}

const SIZE = 64

/** A made-up card picture: the same one every time for a given [seed]. */
function art(seed: number) {
  return signatureFromPixels(
    picture(SIZE, SIZE, (x, y) => [
      (Math.sin(x / 5 + seed) * 90 + 128) | 0,
      (Math.cos(y / 4 + seed * 2) * 90 + 128) | 0,
      (Math.sin((x + y) / 6 + seed * 3) * 90 + 128) | 0,
    ]),
    SIZE,
    SIZE,
  )
}

/** The same picture seen through a camera: dimmer, lower contrast, with a little noise. */
function throughACamera(seed: number) {
  return signatureFromPixels(
    picture(SIZE, SIZE, (x, y) => {
      const noise = ((x * 7 + y * 13) % 11) - 5
      return [
        ((Math.sin(x / 5 + seed) * 90 + 128) * 0.55 + 20 + noise) | 0,
        ((Math.cos(y / 4 + seed * 2) * 90 + 128) * 0.55 + 20 + noise) | 0,
        ((Math.sin((x + y) / 6 + seed * 3) * 90 + 128) * 0.55 + 20 + noise) | 0,
      ]
    }),
    SIZE,
    SIZE,
  )
}

test('a signature has a cell of colour per grid square', () => {
  assert.equal(art(1).length, GRID_W * GRID_H * 3)
})

test('levelling leaves a flat picture flat instead of dividing by nothing', () => {
  const flat = signatureFromPixels(picture(SIZE, SIZE, () => [40, 40, 40]), SIZE, SIZE)
  assert.ok([...flat].every((v) => v === 0))
})

test('a dim, low-contrast photo still looks like the card it is of', () => {
  // Lighting is levelled out, so the same picture through a camera stays far closer than a
  // different card — which is what makes matching from a photo work at all.
  const same = artDistance(art(3), throughACamera(3))
  const different = artDistance(art(3), throughACamera(8))
  assert.ok(same < 0.2, `same card through a camera scored ${same}`)
  assert.ok(different > same * 4, `a different card scored ${different} against ${same}`)
})

test('an unrelated card is nowhere near a match', () => {
  assert.ok(artDistance(art(1), art(9)) > MATCH_MAX)
})

/** A printing to match against. */
const printing = (name: string, signature: Float32Array) => ({ item: name, signature })

test('the closest printing wins', () => {
  const found = bestPrinting(throughACamera(4), [
    printing('borderless', art(4)),
    printing('usual', art(7)),
    printing('showcase', art(11)),
  ])
  assert.equal(found?.pick, 'borderless')
  assert.equal(found?.only, true)
})

test('nothing is picked when the card in the frame matches none of the printings', () => {
  assert.equal(bestPrinting(throughACamera(20), [printing('usual', art(2)), printing('alt', art(5))]), null)
})

test('nothing is picked when two printings that look different are too close to call', () => {
  // Halfway between two unrelated printings: whichever is nearer, it is nearer by too little to act
  // on, so the scan asks instead of guessing.
  const a = art(2)
  const b = art(5)
  const between = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) between[i] = (a[i] + b[i]) / 2
  assert.equal(bestPrinting(between, [printing('one', a), printing('two', b)]), null)
})

test('a picture shared by several printings is matched, but not claimed as one printing', () => {
  // The same art in the same frame, reprinted: the art says which picture, never which printing.
  const shared = art(6)
  const found = bestPrinting(throughACamera(6), [
    printing('2019 printing', shared),
    printing('2023 reprint', shared),
    printing('alternate art', art(12)),
  ])
  assert.ok(found)
  assert.equal(found.only, false)
  assert.ok(artDistance(shared, shared) <= SAME_LOOK)
})

test('one printing of a card is picked without anything to compare it against', () => {
  const found = bestPrinting(throughACamera(1), [printing('only one', art(1))])
  assert.equal(found?.pick, 'only one')
  assert.equal(found?.only, true)
})

test('a card with no printings at all matches nothing', () => {
  assert.equal(bestPrinting(art(1), []), null)
})

test('the guide is squared off to a card, whatever shape it is', () => {
  // Wider than a card: the height is what the card fills, and the sides are trimmed evenly.
  const wide = cardShaped({ x: 0, y: 0, width: 200, height: 100 })
  assert.ok(Math.abs(wide.width / wide.height - CARD_ASPECT) < 0.001)
  assert.equal(wide.height, 100)
  assert.equal(wide.x, (200 - wide.width) / 2)

  // Taller than a card: the width is what it fills.
  const tall = cardShaped({ x: 10, y: 20, width: 100, height: 400 })
  assert.equal(tall.width, 100)
  assert.ok(Math.abs(tall.width / tall.height - CARD_ASPECT) < 0.001)
  assert.equal(tall.y, 20 + (400 - tall.height) / 2)
})

test('levelling a grid of raw colour centres each channel on its own average', () => {
  const raw = [0, 10, 20, 100, 10, 20, 200, 10, 20]
  const out = levelled(raw)
  let red = 0
  for (let i = 0; i < out.length; i += 3) red += out[i]
  assert.ok(Math.abs(red) < 1e-6)
})

test('the camera card is measured at a grid of places and sizes around the guide', () => {
  const boxes = lookBoxes({ x: 100, y: 100, width: 300, height: 419 })
  assert.equal(boxes.length, LOOK_SCALES.length * LOOK_SHIFTS.length * LOOK_SHIFTS.length)
  // Every one card-shaped, and the guide itself among them.
  for (const b of boxes) assert.ok(Math.abs(b.width / b.height - CARD_ASPECT) < 0.01)
  assert.ok(boxes.some((b) => Math.abs(b.x - 100) < 1 && Math.abs(b.width - 300) < 1))
})

test('a reflection over part of the card no longer decides the match', () => {
  // The same card with a bright patch over a corner: on a plain average the patch alone pushes it
  // past a different card; with the worst fifth of the card left out, the rest of it wins.
  const card = art(3)
  const glared = new Float32Array(card)
  for (let i = 0; i < 12 * 3; i++) glared[i] = 3 // twelve cells of the 88 washed out
  const other = art(9)
  assert.ok(trimmedDistance(glared, card) < trimmedDistance(glared, other))
  assert.ok(trimmedDistance(glared, card) < artDistance(glared, card))
})

test('a printing is matched at whichever measuring of the camera card suits it', () => {
  // Two measurings: one of the table beside the card, one of the card. The card's own printing wins.
  const table = art(40)
  const found = bestPrinting([table, throughACamera(4)], [printing('borderless', art(4)), printing('usual', art(7))])
  assert.equal(found?.pick, 'borderless')
})

test("the set's version that looks like the card is the one", () => {
  // The set code said which set: of its regular and full-art versions, the look says which.
  const decision = decideInSet([throughACamera(4)], [{ item: 'regular', signature: art(7) }, { item: 'full art', signature: art(4) }], 'regular')
  assert.deepEqual(decision, { kind: 'found', pick: 'full art', only: true })
})

test("a set whose versions look nothing like the card means the set code was misread", () => {
  // Even a set holding just one version of the card is checked against the look.
  assert.deepEqual(decideInSet([throughACamera(20)], [{ item: 'regular', signature: art(2) }], 'regular'), { kind: 'misread' })
  assert.deepEqual(decideInSet([throughACamera(1)], [], 'regular'), { kind: 'misread' })
})
