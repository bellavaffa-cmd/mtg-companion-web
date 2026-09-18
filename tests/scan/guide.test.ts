// Mapping the on-screen guide box to the camera's own pixels (src/scan/guide.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guideInVideo } from '../../src/scan/guide.ts'

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
