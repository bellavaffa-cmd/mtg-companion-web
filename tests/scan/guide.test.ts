// Mapping the on-screen guide box to the camera's own pixels (src/scan/guide.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guideInVideo, SCAN_ZOOM, LENS_SWITCH_ZOOM, zoomFor } from '../../src/scan/guide.ts'

const rect = (left: number, top: number, width: number, height: number) => () => ({ left, top, width, height }) as DOMRect

test('a video shown at its own size maps one to one', () => {
  const box = guideInVideo({ videoWidth: 400, videoHeight: 300, getBoundingClientRect: rect(0, 0, 400, 300) }, { getBoundingClientRect: rect(100, 50, 200, 200) })
  assert.deepEqual(box, { x: 100, y: 50, width: 200, height: 200 })
})

test('a landscape camera shown in a tall frame is cropped at the sides, and the box maps through that', () => {
  // 1920x1080 video filling a 360x480 frame: scaled by 480/1080, 853px wide, 246.7px cut from each side.
  const box = guideInVideo(
    { videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: rect(10, 20, 360, 480) },
    { getBoundingClientRect: rect(10 + 80, 20 + 40, 200, 280) },
  )!
  const scale = 480 / 1080
  const cut = (1920 * scale - 360) / 2
  assert.ok(Math.abs(box.x - (80 + cut) / scale) < 1e-6)
  assert.ok(Math.abs(box.y - 40 / scale) < 1e-6)
  assert.ok(Math.abs(box.width - 200 / scale) < 1e-6)
  assert.ok(Math.abs(box.height - 280 / scale) < 1e-6)
})

test('no picture yet: nothing to read', () => {
  assert.equal(guideInVideo({ videoWidth: 0, videoHeight: 0, getBoundingClientRect: rect(0, 0, 400, 300) }, { getBoundingClientRect: rect(0, 0, 10, 10) }), null)
})

// The zoom that decides whether the small print can be read at all. The Android app has the same
// checks — see ScanCropTest.kt.

test('the zoom stays on the lens that can focus on a card', () => {
  // Past the switch the phone hands over to a telephoto that cannot focus nearer than about 40 cm,
  // and a card held to be scanned would never come into focus — a far worse failure than the one
  // being fixed.
  assert.ok(SCAN_ZOOM < LENS_SWITCH_ZOOM)
  assert.ok(SCAN_ZOOM > 1)
})

test('a camera with plenty of zoom is asked for exactly the scanning zoom', () => {
  assert.equal(zoomFor({ min: 1, max: 10 }), SCAN_ZOOM)
})

test('a camera that zooms past the lens switch is held below it', () => {
  // 8x is offered, but anything at or past the switch risks the telephoto.
  const ratio = zoomFor({ min: 1, max: 8 })
  assert.ok(ratio !== null && ratio < LENS_SWITCH_ZOOM)
})

test('a camera with only a little zoom is asked for what it has', () => {
  assert.equal(zoomFor({ min: 1, max: 1.4 }), 1.4)
})

test('a camera with no zoom is left alone', () => {
  // Most laptops. Asking anyway would either be refused or, worse, quietly accepted as a crop.
  assert.equal(zoomFor(undefined), null)
  assert.equal(zoomFor({}), null)
  assert.equal(zoomFor({ min: 1, max: 1 }), null)
})
