import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeDeck } from '../../src/sync/mergeItems.ts'
import { keepBindersFromOlderApp } from '../../src/decks/binderRefs.ts'
import { backupJson, buildBackup, parseBackup, restoreLibrary } from '../../src/sync/backupFile.ts'
import { withBackupAdded } from '../../src/sync/libraryBackup.ts'
import { withDeckPrinting } from '../../src/collection/printings.ts'
import { withSwapIn } from '../../src/decks/proxies.ts'
import { moveToConsidering, swapConsidered } from '../../src/decks/considering.ts'
import type { Library } from '../../src/sync/cloudSync.ts'
import type { Collection, Deck, DeckCardEntry } from '../../src/types/models.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// Which binders a deck card's copies are in (DeckCardEntry.binders, decks/binderRefs.ts). The phone
// writes it; this app only has to keep it: through the sync's merge, an older app's save, backups and
// every edit that rebuilds a deck card. The merge cases are shared with the Android app.

type Refs = { id: string; qty: number }[] | null
type VCard = { id: string; qty: number; binders?: Refs }
interface Vectors {
  merge: { name: string; minePreferred: boolean; base: VCard[]; mine: VCard[]; theirs: VCard[]; expect: VCard[] }[]
  keep: { name: string; source: VCard[]; theirs: VCard[]; sameObject: boolean; expect: VCard[] }[]
}
const V = JSON.parse(readFileSync(new URL('./binderRefMergeVectors.json', import.meta.url), 'utf8')) as Vectors

const card = (id: string, quantity = 1, binders?: Refs): DeckCardEntry =>
  ({ scryfallId: id, name: id, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null, ...(binders !== undefined ? { binders } : {}) })
const deck = (cards: DeckCardEntry[], over: Partial<Deck> = {}): Deck =>
  ({ id: 'd', name: 'Deck', commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL', ...over })
const fromVector = (cards: VCard[]) => deck(cards.map((c) => card(c.id, c.qty, c.binders)))
/** A merged deck's cards as the vectors list them: no binders key when there are none. */
const shown = (d: Deck): VCard[] => d.cards.map((c) => ({ id: c.scryfallId, qty: c.quantity, ...(c.binders != null ? { binders: c.binders } : {}) }))

for (const v of V.merge) {
  test(`binders merge: ${v.name}`, () => {
    const [base, mine, theirs] = [fromVector(v.base), fromVector(v.mine), fromVector(v.theirs)]
    assert.deepEqual(shown(mergeDeck(base, mine, theirs, v.minePreferred)), v.expect)
    // The other device runs the same merge from its side and lands on the same cards.
    assert.deepEqual(shown(mergeDeck(base, theirs, mine, !v.minePreferred)), v.expect)
  })
}

for (const v of V.keep) {
  test(`binders kept from an older app's save: ${v.name}`, () => {
    const theirs = fromVector(v.theirs)
    const out = keepBindersFromOlderApp(fromVector(v.source), theirs)
    assert.equal(out === theirs, v.sameObject)
    assert.deepEqual(shown(out), v.expect)
  })
}

test('the binders never land on Considering or the sideboard by the merge', () => {
  const side = [card('sol', 1)]
  const out = mergeDeck(deck([], { sideboard: side }), deck([], { sideboard: side }), deck([], { sideboard: side }), true)
  assert.equal(out.sideboard![0].binders, undefined)
})

const refs = [{ id: 'b1', qty: 1 }, { id: 'b2', qty: 2 }]
const binder = (id: string): Collection => ({ id, name: id, entries: [{ scryfallId: 'x', name: 'x', imageUrl: null, quantity: 1, foilQuantity: 0 }], createdAt: 1, type: 'OWNED' })

test('a backup keeps the binders: read back, merged back and put back', () => {
  const then: Library = { decks: [deck([card('sol', 3, refs), card('ring', 1, [])])], collections: [binder('b1'), binder('b2')] }
  const b = buildBackup({ library: then, from: 'android', createdAt: 1, copyHistory: [], photos: [], photoFiles: {}, settings: {} })
  const parsed = parseBackup(backupJson(b))
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.backup.decks[0].cards.map((c) => c.binders), [refs, []])
  // Put back over a deck here: as it was.
  const now: Library = { decks: [deck([card('sol', 3)])], collections: [binder('b1'), binder('b2')] }
  assert.deepEqual(restoreLibrary(now, parsed.backup, 'replace').decks[0].cards.map((c) => c.binders), [refs, []])
  // Merged with a deck here that has none (an older app's): the backup's.
  assert.deepEqual(restoreLibrary(now, parsed.backup, 'merge').decks[0].cards.map((c) => c.binders), [refs, []])
  // Merged with a deck here that has its own: here's, as for any other field.
  const mineHere = [{ id: 'b2', qty: 3 }]
  const here: Library = { decks: [deck([card('sol', 3, mineHere)])], collections: [] }
  assert.deepEqual(restoreLibrary(here, parsed.backup, 'merge').decks[0].cards[0].binders, mineHere)
})

test('a backup added as new decks and binders points the cards at the new binder ids', () => {
  let n = 0
  const backup: Library = { decks: [deck([card('sol', 3, refs), card('ring', 1)])], collections: [binder('b1'), binder('unsorted')] }
  const out = withBackupAdded({ decks: [], collections: [] }, backup, () => `new-${++n}`)
  assert.deepEqual(out.decks.map((d) => d.id), ['new-1'])
  assert.deepEqual(out.collections.map((c) => c.id), ['new-2', 'unsorted'])
  // b1 came back as new-2; b2 isn't in the backup, so its id is left as it was.
  assert.deepEqual(out.decks[0].cards[0].binders, [{ id: 'new-2', qty: 1 }, { id: 'b2', qty: 2 }])
  assert.equal(out.decks[0].cards[1].binders, undefined)
})

const printing = (id: string): ScryfallCard =>
  ({ id, name: 'Sol Ring', type_line: 'Artifact', image_uris: { normal: `https://img/${id}.jpg` } }) as unknown as ScryfallCard

test('a printing change keeps the binders, and two entries joined add theirs up', () => {
  const moved = withDeckPrinting(deck([card('frc', 2, refs)]), 'frc', printing('msc'))
  assert.equal(moved.cards[0].scryfallId, 'msc')
  assert.deepEqual(moved.cards[0].binders, refs)
  const joined = withDeckPrinting(deck([card('frc', 2, refs), card('msc', 1, [{ id: 'b1', qty: 1 }])]), 'frc', printing('msc'))
  assert.deepEqual(joined.cards.map((c) => [c.scryfallId, c.quantity, c.binders]), [['msc', 3, [{ id: 'b1', qty: 2 }, { id: 'b2', qty: 2 }]]])
  // Neither had any: still none.
  const plain = withDeckPrinting(deck([card('frc', 2), card('msc', 1)]), 'frc', printing('msc'))
  assert.equal('binders' in plain.cards[0], false)
})

test('swapping a proxy for the real card, and moving cards to and from Considering, keep the binders', () => {
  const pile = { ...deck([{ ...card('sol', 2, refs), name: 'Sol Ring' }], { id: 'p', ownership: 'PROXY' }) }
  const binderWithSol: Collection = { ...binder('b9'), entries: [{ scryfallId: 'sol2', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0 }] }
  const swapped = withSwapIn([binderWithSol], [pile], 'p', 'sol')
  assert.notEqual(swapped.decks[0], pile)
  assert.deepEqual(swapped.decks[0].cards[0].binders, refs)

  const d = deck([card('sol', 1, refs), card('ring', 1)], { considering: [card('opt', 1)] })
  const back = swapConsidered(moveToConsidering(d, 'sol'), 'ring', 'sol')
  assert.deepEqual(back.cards.find((c) => c.scryfallId === 'sol')!.binders, refs)
})
