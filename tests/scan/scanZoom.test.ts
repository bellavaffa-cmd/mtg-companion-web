// Zooming while scanning (src/scan/scanZoom.ts). The Android app has the same checks — see
// ScanZoomTest.kt.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canStepZoom, clampZoom, defaultZoom, pinchZoom, savedZoom, startZoom, stepZoom, wheelZoom, ZOOM_FINE_STEP, zoomHint, zoomLabel, zoomRangeOf, zoomSpoken,
  type ZoomRange,
} from '../../src/scan/scanZoom.ts'
import { LENS_SWITCH_ZOOM, SCAN_ZOOM } from '../../src/scan/guide.ts'
import { ScanTracker } from '../../src/scan/scanLogic.ts'
import { HandsFreeCapture } from '../../src/collection/sortRecipes.ts'

const phone: ZoomRange = { min: 1, max: 10, step: 0.1 }
const smooth: ZoomRange = { min: 1, max: 8, step: 0 }

test('a camera without zoom gets no control', () => {
  assert.equal(zoomRangeOf(undefined), null)
  assert.equal(zoomRangeOf({}), null)
  assert.equal(zoomRangeOf({ torch: true }), null)
  assert.equal(zoomRangeOf({ zoom: { min: 1, max: 1, step: 0.1 } }), null)
  assert.equal(zoomRangeOf({ zoom: { min: 1 } }), null)
})

test('a camera with zoom says its range, and no step reads as any step', () => {
  assert.deepEqual(zoomRangeOf({ zoom: { min: 1, max: 10, step: 0.1 } }), phone)
  assert.deepEqual(zoomRangeOf({ zoom: { min: 1, max: 8 } }), smooth)
})

test('the zoom is held within the range and on the camera\'s step', () => {
  assert.equal(clampZoom(0.5, phone), 1)
  assert.equal(clampZoom(12, phone), 10)
  assert.equal(clampZoom(1.83, phone), 1.8)
  assert.equal(clampZoom(1.83, smooth), 1.83)
  assert.equal(clampZoom(Number.NaN, phone), 1)
  assert.equal(clampZoom(2.7, { min: 1, max: 3, step: 0.5 }), 2.5)
})

test('− and + go a quarter at a time, onto round numbers, and a half from 3×', () => {
  assert.equal(ZOOM_FINE_STEP, 0.25)
  assert.equal(stepZoom(3, 1, smooth), 3.5)
  assert.equal(stepZoom(3, -1, smooth), 2.75)
  assert.equal(stepZoom(3.5, -1, smooth), 3)
  assert.equal(stepZoom(2.75, 1, smooth), 3)
  assert.equal(stepZoom(SCAN_ZOOM, 1, smooth), 2)
  assert.equal(stepZoom(SCAN_ZOOM, -1, smooth), 1.75)
  assert.equal(stepZoom(2, 1, smooth), 2.25)
  assert.equal(stepZoom(2, -1, smooth), 1.75)
  assert.equal(stepZoom(1.1, -1, smooth), 1)
  assert.equal(stepZoom(7.9, 1, smooth), 8)
})

test('the buttons stop at the ends of the range', () => {
  assert.equal(stepZoom(1, -1, smooth), 1)
  assert.equal(canStepZoom(1, -1, smooth), false)
  assert.equal(canStepZoom(1, 1, smooth), true)
  assert.equal(canStepZoom(8, 1, smooth), false)
})

test('a camera with a coarse step still moves one step a press', () => {
  const coarse: ZoomRange = { min: 1, max: 4, step: 1 }
  assert.equal(stepZoom(2, 1, coarse), 3)
  assert.equal(stepZoom(2, -1, coarse), 1)
})

test('a pinch scales from where it started', () => {
  assert.equal(pinchZoom(2, 100, 200, smooth), 4)
  assert.equal(pinchZoom(2, 100, 50, smooth), 1)
  assert.equal(pinchZoom(2, 100, 1000, smooth), 8)
  assert.equal(pinchZoom(2, 0, 100, smooth), 2)
})

test('ctrl + wheel: up zooms in, down zooms out, and a mouse notch is held back', () => {
  assert.ok(wheelZoom(2, -10, 0, smooth) > 2)
  assert.ok(wheelZoom(2, 10, 0, smooth) < 2)
  const notch = wheelZoom(2, -100, 0, smooth)
  assert.ok(notch < 2 * 1.3, `${notch}`)
  assert.equal(wheelZoom(2, -3, 1, smooth), wheelZoom(2, -48, 0, smooth))
})

test('the chip reads the zoom', () => {
  assert.equal(zoomLabel(1.8), '1.8×')
  assert.equal(zoomLabel(2), '2×')
  assert.equal(zoomLabel(1.75), '1.75×')
  assert.equal(zoomLabel(2.25), '2.25×')
  assert.equal(zoomLabel(2.0500000001), '2.1×')
  assert.equal(zoomSpoken(1.8), 'Zoom 1.8 times')
})

test('past the lens switch it says to hold the card farther away; the default never does', () => {
  assert.equal(zoomHint(SCAN_ZOOM), null)
  assert.equal(zoomHint(2.75), null)
  assert.equal(zoomHint(LENS_SWITCH_ZOOM), 'Hold the card farther away')
  assert.equal(zoomHint(3), 'Hold the card farther away')
  assert.equal(zoomHint(3, 'page'), 'Hold the page farther away')
  for (const range of [phone, smooth, { min: 1, max: 2, step: 0.5 }, { min: 0.5, max: 10, step: 0.01 }, { min: 2.5, max: 6, step: 0.5 }]) {
    assert.equal(zoomHint(defaultZoom(range)), null, JSON.stringify(range))
  }
})

test('the default is SCAN_ZOOM when the camera can give it', () => {
  assert.equal(defaultZoom(phone), SCAN_ZOOM)
  assert.equal(defaultZoom({ min: 1, max: 1.5, step: 0 }), 1.5)
  // A binder page starts wide.
  assert.equal(defaultZoom(phone, 1), 1)
  assert.equal(defaultZoom({ min: 0.5, max: 10, step: 0.1 }, 1), 1)
})

test('the zoom kept from last time is used, within this camera\'s range', () => {
  assert.equal(savedZoom(null), null)
  assert.equal(savedZoom(''), null)
  assert.equal(savedZoom('nonsense'), null)
  assert.equal(savedZoom('-2'), null)
  assert.equal(savedZoom('2.5'), 2.5)
  assert.equal(startZoom(null, SCAN_ZOOM, phone), SCAN_ZOOM)
  assert.equal(startZoom(2.5, SCAN_ZOOM, phone), 2.5)
  assert.equal(startZoom(20, SCAN_ZOOM, phone), 10)
})

test('a zoom change starts the steady reads again, but a card already added stays added', () => {
  const t = new ScanTracker(() => 2)
  assert.equal(t.onRead('Sol Ring').kind, 'wait')
  t.settle()
  assert.equal(t.onRead('Sol Ring').kind, 'wait')
  assert.equal(t.onRead('Sol Ring').kind, 'lookup')
  t.added('Sol Ring')
  t.settle()
  assert.equal(t.onRead('Sol Ring').kind, 'wait')
  assert.equal(t.onRead('Sol Ring').kind, 'wait')
})

test('hands-free: a zoom change starts the still frames again, and the card held is not taken twice', () => {
  const h = new HandsFreeCapture(3, 4)
  assert.equal(h.onRead('Sol Ring'), false)
  assert.equal(h.onRead('Sol Ring'), false)
  h.settle()
  assert.equal(h.onRead('Sol Ring'), false)
  assert.equal(h.onRead('Sol Ring'), false)
  assert.equal(h.onRead('Sol Ring'), true)
  h.captured('Sol Ring')
  h.settle()
  for (let i = 0; i < 5; i++) assert.equal(h.onRead('Sol Ring'), false)
})
