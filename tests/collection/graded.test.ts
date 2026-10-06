import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  backToRaw, gradedOf, gradedWhere, gradeLabel, keepGradedFromOlderApp, markGraded, mergeGraded, rawSources, removeGraded,
} from '../../src/collection/graded.ts'
import { pullList } from '../../src/collection/pullList.ts'
import { missingCards } from '../../src/decks/missing.ts'
import { spares } from '../../src/collection/spares.ts'
import { ownedCounts } from '../../src/collection/sortPiles.ts'
import { placedCopies } from '../../src/collection/storagePlaces.ts'
import { finishOf, valueGroups, valueRows } from '../../src/collection/valueByPlace.ts'
import { mergeCollection } from '../../src/sync/mergeItems.ts'
import { normalizeDeck, type Collection, type CollectionEntry, type CopyPlace, type Deck, type GradedCard, type SealedProduct, type StoragePlace } from '../../src/types/models.ts'

// Graded cards: marking a copy graded takes it out of the raw copies (so it fills no deck slot and
// isn't a spare), its value is the one entered, and two devices' slabs merge — the same on both apps.
// The Android app has the same checks — see GradedTest.kt.

const safe: StoragePlace = { id: 'safe', name: 'Safe, study', kind: 'BOX', sections: ['Slabs'], createdAt: 1 }
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', createdAt: 2 }
const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}) })
const pile = (entries: CollectionEntry[], graded?: GradedCard[], sealed?: SealedProduct[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', storagePlaces: [safe, red], ...(graded ? { graded } : {}), ...(sealed ? { sealed } : {}) })
const binder = (entries: CollectionEntry[]): Collection => ({ id: 'b1', name: 'Rares', entries, createdAt: 5, type: 'OWNED' })
const slab = (over: Partial<GradedCard> = {}): GradedCard =>
  ({ id: 'g1', scryfallId: 'sheo', name: 'Sheoldred, the Apocalypse', company: 'PSA', grade: '10', cert: '12345678', valueUsd: 450, placeId: 'safe', section: 'Slabs', createdAt: 1, ...over })
const deck = (cards: { id: string; name: string; qty: number }[]): Deck => normalizeDeck({
  id: 'd1', name: 'Mono black', ownership: 'PROTOTYPE', createdAt: 1,
  cards: cards.map((c) => ({ scryfallId: c.id, name: c.name, imageUrl: null, quantity: c.qty, canBeCommander: false, typeLine: null, partnerAbility: null })),
})

const COLS = [pile([]), binder([entry('sheo', 'Sheoldred, the Apocalypse', 1, 0, [at('red', 1)])])]

test("the raw copies that could be graded: a line per place, and the ones with no place", () => {
  const cols = [pile([]), binder([entry('sheo', 'Sheoldred, the Apocalypse', 3, 1, [at('red', 1)])])]
  assert.deepEqual(rawSources(cols, 'Sheoldred, the Apocalypse').map((s) => `${s.label} ×${s.qty}`), [
    'Red box ×1', 'No place yet (Rares) ×2', 'No place yet (Rares) · foil ×1',
  ])
})

test('marking a copy graded takes it out of its binder and off its place', () => {
  const src = rawSources(COLS, 'Sheoldred, the Apocalypse')[0]
  const after = markGraded(COLS, src, slab())
  assert.equal(after.find((c) => c.id === 'b1')!.entries.length, 0)
  assert.deepEqual(gradedOf(after).map((g) => `${gradeLabel(g)} from ${g.collectionId}`), ['PSA 10 from b1'])
  // Two copies, one in a place: the graded one is the placed one picked, and the other keeps its spot.
  const two = [pile([]), binder([entry('sheo', 'Sheoldred, the Apocalypse', 2, 0, [at('red', 1)])])]
  const left = markGraded(two, rawSources(two, 'Sheoldred, the Apocalypse')[0], slab()).find((c) => c.id === 'b1')!.entries[0]
  assert.equal(left.quantity, 1)
  assert.deepEqual(placedCopies(left), [])
})

test("a graded copy doesn't fill a deck slot, count as owned for sorting, or as a spare", () => {
  const decks = [deck([{ id: 'sheo', name: 'Sheoldred, the Apocalypse', qty: 1 }])]
  const before = pullList(decks[0], COLS, decks)
  assert.equal(before.groups.some((g) => g.kind === 'missing'), false)
  const after = markGraded(COLS, rawSources(COLS, 'Sheoldred, the Apocalypse')[0], slab())
  const list = pullList(decks[0], after, decks)
  assert.deepEqual(list.groups.map((g) => g.kind), ['missing'])
  assert.deepEqual(missingCards(decks[0], COLS, decks), [])
  assert.deepEqual(missingCards(decks[0], after, decks).map((e) => `${e.name} ×${e.quantity}`), ['Sheoldred, the Apocalypse ×1'])
  assert.equal(ownedCounts(after, []).get('sheoldred, the apocalypse') ?? 0, 0)
  const extra = [pile([]), binder([entry('sheo', 'Sheoldred, the Apocalypse', 2)])]
  assert.equal(spares(extra, [], 2).length, 1)
  assert.equal(spares(markGraded(extra, rawSources(extra, 'Sheoldred, the Apocalypse')[0], slab()), [], 2).length, 0)
})

test('out of its slab it is a raw copy again, in its binder and its place', () => {
  const graded = markGraded(COLS, rawSources(COLS, 'Sheoldred, the Apocalypse')[0], slab())
  const back = backToRaw(graded, 'g1')
  assert.deepEqual(gradedOf(back), [])
  const e = back.find((c) => c.id === 'b1')!.entries[0]
  assert.equal(e.quantity, 1)
  assert.deepEqual(e.places, [at('safe', 1, { section: 'Slabs' })])
  // A binder entry with places gets the slab's spot.
  const placed = backToRaw([pile([], [slab({ collectionId: 'b1' })]), binder([entry('sheo', 'Sheoldred, the Apocalypse', 1, 0, [at('red', 1)])])], 'g1')
  assert.deepEqual(placedCopies(placed.find((c) => c.id === 'b1')!.entries[0]), [at('red', 1), at('safe', 1, { section: 'Slabs' })])
  // Its binder gone: into the Unsorted pile.
  const loose = backToRaw([pile([], [slab({ collectionId: 'gone', foil: true })])], 'g1')
  assert.deepEqual(loose[0].entries.map((x) => `${x.name} ${x.quantity}+${x.foilQuantity}`), ['Sheoldred, the Apocalypse 0+1'])
  assert.deepEqual(gradedOf(removeGraded(graded, 'g1')), [])
})

test("on the card's Where it is: the slab, where it is and its cert", () => {
  const cols = [pile([], [slab(), slab({ id: 'g2', company: 'OTHER', companyName: 'ACE', grade: '9', cert: undefined, placeId: undefined, valueUsd: undefined })])]
  assert.deepEqual(gradedWhere(cols, 'Sheoldred, the Apocalypse'), [
    { id: 'g1', title: 'PSA 10', detail: 'Safe, study › Slabs · cert 12345678', valueUsd: 450, placeId: 'safe' },
    { id: 'g2', title: 'ACE 9', detail: 'No place yet', valueUsd: null, placeId: null },
  ])
})

test('in Value by place: graded at the value entered, sealed by the box, with their labels', () => {
  const sealed: SealedProduct = { id: 's', name: 'Duskmourn Play Booster Box', kind: 'PLAY_BOX', setCode: 'dsk', count: 2, placeId: 'safe', valueUsd: 238, createdAt: 1 }
  const cols = [pile([entry('sheo', 'Sheoldred, the Apocalypse', 1, 0, [at('safe', 1)])], [slab()], [sealed])]
  const rows = valueRows(cols, [], () => ({ set: 'dmu', number: '107', usd: 80, usdFoil: 95 }))
  assert.deepEqual(rows.map((r) => `${r.name} ×${r.qty} ${finishOf(r)} ${r.unitUsd}`), [
    'Sheoldred, the Apocalypse ×1 Normal 80', 'Sheoldred, the Apocalypse ×1 Graded PSA 10 450', 'Duskmourn Play Booster Box ×2 Sealed 238',
  ])
  const v = valueGroups(rows, cols)
  assert.deepEqual(v.groups.map((g) => `${g.label} ${g.usd} ${g.copies}+${g.sealed}`), ['Safe, study 1006 2+2'])
  assert.equal(v.copies, 2)
  assert.equal(v.sealed, 2)
})

test('merging slabs: added on either side kept, taken off on either stays off, fields to whoever changed them', () => {
  const merged = mergeGraded([slab()], [slab({ valueUsd: 500 }), slab({ id: 'g2' })], [slab({ placeId: 'red', section: undefined })], false)!
  assert.deepEqual(merged.map((g) => `${g.id} ${g.valueUsd} ${g.placeId} ${g.section}`), ['g1 500 red undefined', 'g2 450 safe Slabs'])
  assert.deepEqual(mergeGraded([slab()], [], [slab({ grade: '9' })], true), [])
})

test('a pile saved by an app from before graded cards keeps them', () => {
  const mine = pile([], [slab()])
  const older = pile([])
  assert.deepEqual(keepGradedFromOlderApp(mine, older).graded, [slab()])
  assert.deepEqual(mergeCollection(mine, mine, older, false).graded, [slab()])
})
