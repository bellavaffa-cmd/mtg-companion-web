import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CardIndex } from '../../src/scan/cardIndex.ts'

// Reading the card index and finding the nearest printings. The Android app has the same checks —
// see CardIndexTest.kt. The file layout is documented in tools/card-index/build_index.py.

interface Row { id: string; face: number; name: string; set: string; number: string; group: number; print: number[] }

/** A card index file, written the way build_index.py writes one. */
function indexFile(rows: Row[], dim: number, featDim: number, mean: number[], comps: number[][], scale: number): ArrayBuffer {
  const names = [...new Set(rows.map((r) => r.name))].sort()
  const sets = [...new Set(rows.map((r) => r.set))].sort()
  const numbers = [...new Set(rows.map((r) => r.number))].sort()
  const meta = new TextEncoder().encode(JSON.stringify({ names, sets, numbers }))
  const n = rows.length
  const size = 28 + 4 * featDim + 4 * dim * featDim + n * dim + 16 * n + n + 4 * n + 2 * n + 2 * n + 4 * n + 4 + meta.length
  const buf = new ArrayBuffer(size)
  const v = new DataView(buf)
  const u8 = new Uint8Array(buf)
  u8.set([0x4d, 0x42, 0x49, 0x58], 0) // MBIX
  v.setUint32(4, 1, true); v.setUint32(8, n, true); v.setUint32(12, dim, true); v.setUint32(16, featDim, true)
  v.setFloat32(20, scale, true); v.setUint32(24, 224, true)
  let at = 28
  for (const m of mean) { v.setFloat32(at, m, true); at += 4 }
  for (const row of comps) for (const c of row) { v.setFloat32(at, c, true); at += 4 }
  for (const r of rows) for (const p of r.print) { v.setInt8(at, p); at += 1 }
  for (const r of rows) { u8.set(r.id.replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16)), at); at += 16 }
  for (const r of rows) { v.setUint8(at, r.face); at += 1 }
  for (const r of rows) { v.setUint32(at, names.indexOf(r.name), true); at += 4 }
  for (const r of rows) { v.setUint16(at, sets.indexOf(r.set), true); at += 2 }
  for (const r of rows) { v.setUint16(at, numbers.indexOf(r.number), true); at += 2 }
  for (const r of rows) { v.setUint32(at, r.group, true); at += 4 }
  v.setUint32(at, meta.length, true); at += 4
  u8.set(meta, at)
  return buf
}

const ID = (k: number) => `0000000${k}-aaaa-bbbb-cccc-0123456789ab`
// Three features, fingerprinted to two numbers: the first two features, as they are.
const COMPS = [[1, 0, 0], [0, 1, 0]]
const index = new CardIndex(indexFile([
  { id: ID(1), face: 0, name: 'Sol Ring', set: 'msc', number: '213', group: 0, print: [127, 0] },
  { id: ID(2), face: 0, name: 'Sol Ring', set: 'sld', number: '2330', group: 1, print: [0, 127] },
  { id: ID(3), face: 0, name: 'Lightning Bolt', set: '2xm', number: '129', group: 2, print: [90, 90] },
  { id: ID(4), face: 1, name: 'Delver of Secrets // Insectile Aberration', set: 'isd', number: '51', group: 3, print: [-127, 0] },
], 2, 3, [0, 0, 0], COMPS, 127))

test('a card index reads back what was written', () => {
  assert.equal(index.count, 4)
  assert.equal(index.dim, 2)
  assert.deepEqual(index.entry(1), { row: 1, id: ID(2), face: 0, name: 'Sol Ring', set: 'sld', number: '2330', group: 1 })
  assert.equal(index.entry(3).face, 1)
})

test("a picture's features are fingerprinted like the index's own", () => {
  // Along the first direction only: a fingerprint of (127, 0), whatever the length.
  assert.deepEqual([...index.fingerprint([5, 0, 3])], [127, 0])
  // Halfway between the two: equal parts of each, at unit length.
  assert.deepEqual([...index.fingerprint([2, 2, 0])], [90, 90])
})

test('the nearest pictures come first, and the best of several looks counts', () => {
  const near = index.nearest([index.fingerprint([1, 0.1, 0])], 2)
  assert.deepEqual(near.map((m) => m.id), [ID(1), ID(3)])
  assert.ok(near[0].score > 0.99 && near[0].score <= 1.01)
  // A second look at the card that happens to match the other Sol Ring better wins it.
  const two = index.nearest([index.fingerprint([1, 0.1, 0]), index.fingerprint([0, 1, 0])], 1)
  assert.ok(two[0].score > 0.99)
})

test('a search can be kept to the printings of one name, either face of a double-faced card', () => {
  assert.deepEqual(index.rowsNamed('sol ring'), [0, 1])
  assert.deepEqual(index.rowsNamed('Insectile Aberration'), [3])
  assert.deepEqual(index.rowsNamed('Delver of Secrets // Insectile Aberration'), [3])
  assert.deepEqual(index.rowsNamed('Nope'), [])
  const within = index.nearest([index.fingerprint([1, 1, 0])], 1, index.rowsNamed('Sol Ring'))
  assert.equal(within[0].name, 'Sol Ring')
})

test('something that is not a card index is refused', () => {
  assert.throws(() => new CardIndex(new ArrayBuffer(40)))
})
