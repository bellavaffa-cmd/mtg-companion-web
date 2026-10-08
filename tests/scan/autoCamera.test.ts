// Auto zoom and focus while scanning (src/scan/autoCamera.ts). The Android app has the same checks.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUTO_ZOOM_EVERY_MS, AUTO_ZOOM_MAX_STEP, AUTO_ZOOM_SEEN_FRAMES, AUTO_ZOOM_TARGET, AutoZoom, autoCameraOn, autoZoomStep, cardFit, focusPoint,
  focusPointMoved, Refocus, REFOCUS_BLUR_MS, REFOCUS_EVERY_MS, sharpness, type CardFit,
} from '../../src/scan/autoCamera.ts'
import { LENS_SWITCH_ZOOM } from '../../src/scan/guide.ts'
import type { ZoomRange } from '../../src/scan/scanZoom.ts'
import type { CardQuad } from '../../src/scan/cardEdges.ts'

const range: ZoomRange = { min: 1, max: 10, step: 0 }
const guide = { x: 100, y: 100, width: 200, height: 280 }
/** A card [share] of the guide's size, centred on it (or moved by dx). */
const card = (share: number, dx = 0): CardQuad => {
  const w = guide.width * share
  const h = guide.height * share
  const cx = guide.x + guide.width / 2 + dx
  const cy = guide.y + guide.height / 2
  return { topLeft: { x: cx - w / 2, y: cy - h / 2 }, topRight: { x: cx + w / 2, y: cy - h / 2 }, bottomRight: { x: cx + w / 2, y: cy + h / 2 }, bottomLeft: { x: cx - w / 2, y: cy + h / 2 } }
}
const centred = (fill: number): CardFit => ({ fill, reach: fill })

test('how a card sits in the guide', () => {
  const fit = cardFit(card(0.6), guide)
  assert.ok(Math.abs(fit.fill - 0.6) < 1e-9)
  assert.ok(Math.abs(fit.reach - 0.6) < 1e-9)
  // Off to one side, it reaches farther out than it fills.
  const aside = cardFit(card(0.6, 50), guide)
  assert.ok(Math.abs(aside.reach - 1.1) < 1e-9)
})

test('a card that fills about the right share of the guide is left alone', () => {
  assert.equal(autoZoomStep(1.8, centred(AUTO_ZOOM_TARGET), range), null)
  assert.equal(autoZoomStep(1.8, centred(AUTO_ZOOM_TARGET + 0.09), range), null)
  assert.equal(autoZoomStep(1.8, centred(AUTO_ZOOM_TARGET - 0.09), range), null)
})

test('a small card is zoomed in on, a step at most at a time', () => {
  const next = autoZoomStep(1.8, centred(0.5), range)!
  assert.ok(next > 1.8)
  assert.ok(next - 1.8 <= AUTO_ZOOM_MAX_STEP + 1e-9)
  // Nearly there: only as far as the target.
  const near = autoZoomStep(1, centred(0.77), range)!
  assert.ok(Math.abs(near - AUTO_ZOOM_TARGET / 0.77) < 0.011, String(near))
})

test('a card too big for the guide is zoomed out from', () => {
  const next = autoZoomStep(2, centred(1.05), range)!
  assert.ok(next < 2)
  assert.ok(2 - next <= AUTO_ZOOM_MAX_STEP + 1e-9)
})

test('never past the lens switch, never below the camera\'s least zoom', () => {
  assert.equal(autoZoomStep(LENS_SWITCH_ZOOM, centred(0.4), range), null)
  const next = autoZoomStep(2.85, centred(0.4), range)!
  assert.ok(next <= LENS_SWITCH_ZOOM)
  assert.equal(autoZoomStep(1, centred(1.2), range), null)
  assert.equal(autoZoomStep(1.05, centred(1.2), range), 1)
  assert.equal(autoZoomStep(1.8, centred(0.4), { min: 1, max: 1.9, step: 0 }), 1.9)
})

test('never so far that the card spills out of the guide', () => {
  // Small, but off to one side: zooming in to fill would push its edge out of the guide.
  const fit: CardFit = { fill: 0.6, reach: 0.95 }
  const next = autoZoomStep(2, fit, range)
  assert.ok(next === null || next * (fit.reach / 2) <= 0.98 + 1e-9, String(next))
  // Already spilling: zoomed out, even though it fills little.
  const out = autoZoomStep(2, { fill: 0.7, reach: 1.1 }, range)!
  assert.ok(out < 2)
})

test('auto zoom waits for the card to be seen a few frames running, and nudges at most every 400 ms', () => {
  const a = new AutoZoom()
  const fit = centred(0.5)
  for (let i = 1; i < AUTO_ZOOM_SEEN_FRAMES; i++) assert.equal(a.onFrame(fit, 1.8, range, i * 100), null)
  const first = a.onFrame(fit, 1.8, range, AUTO_ZOOM_SEEN_FRAMES * 100)
  assert.ok(first !== null)
  // The card is watched afresh after a nudge, and not before 400 ms has gone by.
  let t = AUTO_ZOOM_SEEN_FRAMES * 100
  const after: (number | null)[] = []
  for (let i = 0; i < AUTO_ZOOM_SEEN_FRAMES; i++) { t += 50; after.push(a.onFrame(fit, first!, range, t)) }
  assert.ok(after.every((x) => x === null))
  assert.ok(a.onFrame(fit, first!, range, AUTO_ZOOM_SEEN_FRAMES * 100 + AUTO_ZOOM_EVERY_MS) !== null)
})

test('a frame without the card starts the count again', () => {
  const a = new AutoZoom()
  const fit = centred(0.5)
  a.onFrame(fit, 1.8, range, 0)
  a.onFrame(fit, 1.8, range, 100)
  a.onFrame(null, 1.8, range, 200)
  assert.equal(a.onFrame(fit, 1.8, range, 300), null)
  assert.equal(a.onFrame(fit, 1.8, range, 400), null)
  assert.ok(a.onFrame(fit, 1.8, range, 500) !== null)
})

test('a card blurred for a while has its focus run again, not more than every 1.5 s', () => {
  const r = new Refocus()
  assert.equal(r.onFrame(false, 0), false)
  assert.equal(r.onFrame(false, REFOCUS_BLUR_MS - 1), false)
  assert.equal(r.onFrame(false, REFOCUS_BLUR_MS), true)
  // Still blurred: not again until 1.5 s after the last.
  assert.equal(r.onFrame(false, REFOCUS_BLUR_MS + 800), false)
  assert.equal(r.onFrame(false, REFOCUS_BLUR_MS + REFOCUS_EVERY_MS - 1), false)
  assert.equal(r.onFrame(false, REFOCUS_BLUR_MS + REFOCUS_EVERY_MS), true)
})

test('a sharp frame, or no card, starts the blur wait again', () => {
  const r = new Refocus()
  r.onFrame(false, 0)
  r.onFrame(true, 400)
  assert.equal(r.onFrame(false, 800), false)
  assert.equal(r.onFrame(false, 800 + REFOCUS_BLUR_MS - 1), false)
  r.onFrame(null, 1600)
  assert.equal(r.onFrame(false, 1700), false)
})

test('sharpness tells a crisp picture from a blurred one, whatever the contrast', () => {
  const w = 64
  const h = 64
  const crisp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crisp[y * w + x] = ((x >> 2) + (y >> 2)) % 2 ? 200 : 40
  const blur = new Float32Array(w * h)
  const r = 4
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0
    let n = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx))
      const yy = Math.min(h - 1, Math.max(0, y + dy))
      s += crisp[yy * w + xx]
      n++
    }
    blur[y * w + x] = s / n
  }
  const dim = crisp.map((v) => 100 + (v - 120) / 8)
  assert.ok(sharpness(crisp, w, h) > 0.2, String(sharpness(crisp, w, h)))
  assert.ok(sharpness(blur, w, h) < 0.12, String(sharpness(blur, w, h)))
  assert.ok(Math.abs(sharpness(dim, w, h) - sharpness(crisp, w, h)) < 0.05)
  assert.equal(sharpness(new Float32Array(w * h).fill(90), w, h), 0)
})

test('focus is pointed at the card\'s centre, and again only once it has moved', () => {
  const p = focusPoint(card(0.5), 400, 480)
  assert.ok(Math.abs(p.x - 0.5) < 1e-9)
  assert.ok(Math.abs(p.y - 240 / 480) < 1e-9)
  assert.equal(focusPointMoved(null, p), true)
  assert.equal(focusPointMoved(p, { x: p.x + 0.01, y: p.y }), false)
  assert.equal(focusPointMoved(p, { x: p.x + 0.1, y: p.y }), true)
})

test('auto zoom and focus are on unless switched off', () => {
  assert.equal(autoCameraOn(null), true)
  assert.equal(autoCameraOn('true'), true)
  assert.equal(autoCameraOn('false'), false)
})
