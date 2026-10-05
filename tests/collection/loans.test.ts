import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  copiesOut, daysBetween, keepLoansFromOlderApp, lend, lendSources, loanDue, loanPeople, loansFromTags, mergeLoans, reminderText, returnCards,
  serverCards, shortDay, tagBorrower, type LendSource,
} from '../../src/collection/loans.ts'
import { deletePlace, lentCopies, loansOf, storageSummary, whereItIs } from '../../src/collection/storagePlaces.ts'
import type { Collection, CollectionEntry, CopyPlace, Deck, Loan, StoragePlace } from '../../src/types/models.ts'

// Loans: lending cards with where each came from, getting them back, and merging two devices' loans —
// the same on both apps. The Android app has the same checks — see LoansTest.kt.

const at = (placeId: string, qty: number, over: Partial<CopyPlace> = {}): CopyPlace => ({ placeId, qty, ...over })
const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[], userTags?: string[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}), ...(userTags ? { userTags } : {}) })
const red: StoragePlace = { id: 'red', name: 'Red box', kind: 'BOX', sections: ['Red'], createdAt: 1 }
const rares: StoragePlace = { id: 'rares', name: 'Rares binder', kind: 'BINDER', createdAt: 2 }
const pile = (entries: CollectionEntry[], loans?: Loan[]): Collection =>
  ({ id: 'unsorted', name: 'Unsorted', entries, createdAt: 0, type: 'OWNED', storagePlaces: [red, rares], ...(loans ? { loans } : {}) })
const atraxa = {
  id: 'atraxa', name: 'Atraxa', commander: null, partnerCommander: null, gameMode: 'COMMANDER', createdAt: 1, tags: [], gameResults: [], ownership: 'PHYSICAL',
  cards: [{ scryfallId: 'sol', name: 'Sol Ring', imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null }],
} as unknown as Deck
const DECKS = [atraxa]
const COLS = [pile([
  entry('ring', 'The One Ring', 1, 0, [at('rares', 1, { page: 1, slot: 1 })]),
  entry('bolt', 'Lightning Bolt', 3, 0, [at('red', 2, { section: 'Red' })]),
])]
const LENT_AT = 1_790_000_000_000
const source = (sources: LendSource[], from: string) => sources.find((s) => s.from === from)!
const sam = { id: 'L1', to: 'Sam', friendId: 'f-sam', lentAt: LENT_AT, gameNight: true, note: 'for Saturday' }

function lentToSam(): Collection[] {
  const picks = [
    { source: lendSources(COLS, DECKS, { placeId: 'rares' })[0], qty: 1 },
    { source: lendSources(COLS, DECKS, { name: 'Sol Ring' })[0], qty: 1 },
    { source: source(lendSources(COLS, DECKS, { name: 'Lightning Bolt' }), 'Red box › Red'), qty: 1 },
  ]
  return lend(COLS, picks, sam)
}

test('what can be lent: a card from its places, decks and copies with no place — or everything in a place', () => {
  assert.deepEqual(lendSources(COLS, DECKS, { name: 'Lightning Bolt' }).map((s) => `${s.from} ×${s.qty}`), ['Red box › Red ×2', 'Unsorted ×1'])
  assert.deepEqual(lendSources(COLS, DECKS, { name: 'Sol Ring' }).map((s) => `${s.from} ×${s.qty}`), ['Atraxa deck ×1'])
  assert.deepEqual(lendSources(COLS, DECKS, { placeId: 'rares' }).map((s) => `${s.name} · ${s.from} ×${s.qty}`), ['The One Ring · Rares binder ×1'])
})

test('lending takes a copy off its place, notes where each came from, and counts it as lent out', () => {
  const cols = lentToSam()
  const loan = loansOf(cols)[0]
  assert.deepEqual(loan, {
    id: 'L1', to: 'Sam', friendId: 'f-sam', lentAt: LENT_AT, gameNight: true, note: 'for Saturday',
    cards: [
      { name: 'The One Ring', scryfallId: 'ring', qty: 1, collectionId: 'unsorted', placeId: 'rares', page: 1, slot: 1 },
      { name: 'Sol Ring', scryfallId: 'sol', qty: 1, deckId: 'atraxa' },
      { name: 'Lightning Bolt', scryfallId: 'bolt', qty: 1, collectionId: 'unsorted', placeId: 'red', section: 'Red' },
    ],
  })
  const entries = cols[0].entries
  assert.deepEqual(entries.find((e) => e.scryfallId === 'ring')!.places, [])
  assert.deepEqual(entries.find((e) => e.scryfallId === 'bolt')!.places, [at('red', 1, { section: 'Red' })])
  const s = storageSummary(cols, DECKS)
  assert.deepEqual([s.total, s.placed, s.unplaced, s.inDecks, s.lent], [5, 4, 1, 0, 3])
  assert.equal(copiesOut(loan), 3)
  // The deck still lists Sol Ring, but it's lent out.
  assert.deepEqual(whereItIs(cols, DECKS, 'Sol Ring').lines.map((l) => `${l.title} · ${l.detail} ×${l.qty}`), ['Lent to Sam · From Atraxa deck ×1'])
  assert.deepEqual(whereItIs(cols, DECKS, 'Lightning Bolt').lines.map((l) => `${l.title} ×${l.qty}`), ['Red box › Red ×1', 'Lent to Sam ×1', 'No place yet ×1'])
  // A lent copy can't be lent again.
  assert.deepEqual(lendSources(cols, DECKS, { name: 'Lightning Bolt' }).map((s) => `${s.from} ×${s.qty}`), ['Red box › Red ×1', 'Unsorted ×1'])
  assert.deepEqual(lendSources(cols, DECKS, { name: 'Sol Ring' }), [])
})

test('getting some back, then the rest, puts each card where it came from', () => {
  const lent = lentToSam()
  const some = returnCards(lent, 'L1', LENT_AT + 10, [0, 0, 1])
  assert.deepEqual(some[0].entries.find((e) => e.scryfallId === 'bolt')!.places, [at('red', 2, { section: 'Red' })])
  assert.equal(loansOf(some)[0].cards[2].back, 1)
  assert.equal(loansOf(some)[0].returnedAt, undefined)
  const all = returnCards(some, 'L1', LENT_AT + 20)
  assert.deepEqual(all[0].entries.find((e) => e.scryfallId === 'ring')!.places, [at('rares', 1, { page: 1, slot: 1 })])
  assert.equal(loansOf(all)[0].returnedAt, LENT_AT + 20)
  assert.deepEqual(loansOf(all)[0].cards.map((c) => c.back), [1, 1, 1])
  const s = storageSummary(all, DECKS)
  assert.deepEqual([s.placed, s.inDecks, s.lent], [4, 1, 0])
  // Nothing left out: nothing changes.
  assert.equal(returnCards(all, 'L1', LENT_AT + 30), all)
})

test("a card whose place has gone comes back with no place", () => {
  const gone = deletePlace(lentToSam(), 'rares')
  const back = returnCards(gone, 'L1', LENT_AT + 10, [1, 0, 0])
  assert.deepEqual(back[0].entries.find((e) => e.scryfallId === 'ring')!.places, [])
  assert.equal(loansOf(back)[0].cards[0].back, 1)
})

test("a loan counts no more copies than are still there", () => {
  const lent = lend(COLS, [{ source: source(lendSources(COLS, DECKS, { name: 'Lightning Bolt' }), 'Unsorted'), qty: 1 }], { id: 'L2', to: 'Priya', lentAt: LENT_AT })
  assert.equal(lentCopies(lent, DECKS).reduce((n, l) => n + l.qty, 0), 1)
  // The copy with no place was removed from the collection.
  const fewer = lent.map((c) => ({ ...c, entries: c.entries.map((e) => (e.scryfallId === 'bolt' ? { ...e, quantity: 2 } : e)) }))
  assert.equal(lentCopies(fewer, DECKS).length, 0)
})

test('when a loan is due back', () => {
  const loan = (over: Partial<Loan>): Loan => ({ id: 'x', to: 'Sam', lentAt: LENT_AT, cards: [{ name: 'Opt', scryfallId: 'opt', qty: 1 }], ...over })
  assert.equal(daysBetween('2026-10-01', '2026-10-04'), 3)
  assert.deepEqual(loanDue(loan({ backBy: '2026-10-01' }), '2026-10-04', []), { overdue: 3, label: 'Overdue · 3 days' })
  assert.deepEqual(loanDue(loan({ backBy: '2026-10-03' }), '2026-10-04', []), { overdue: 1, label: 'Overdue · 1 day' })
  assert.equal(loanDue(loan({ backBy: '2026-10-12' }), '2026-10-04', []).label, 'Back by 12 Oct')
  assert.equal(loanDue(loan({ backBy: '2027-01-02' }), '2026-10-04', []).label, 'Back by 2 Jan 2027')
  assert.equal(loanDue(loan({}), '2026-10-04', []).label, 'No date')
  const nights = [{ at: LENT_AT - 1000, day: '2026-09-20' }, { at: LENT_AT + 1000, day: '2026-10-03' }]
  assert.equal(loanDue(loan({ gameNight: true }), '2026-10-01', []).label, 'Back by next game night')
  assert.equal(loanDue(loan({ gameNight: true }), '2026-10-03', nights).label, 'Due back today')
  assert.deepEqual(loanDue(loan({ gameNight: true }), '2026-10-05', nights), { overdue: 2, label: 'Overdue · 2 days' })
  assert.equal(loanDue(loan({ backBy: '2026-10-01', cards: [{ name: 'Opt', scryfallId: 'opt', qty: 1, back: 1 }] }), '2026-10-04', []).label, 'All back')
  assert.equal(shortDay('2026-09-03'), '3 Sep')
})

test('the Loans page: one group per person, the most overdue first', () => {
  const card = { name: 'Opt', scryfallId: 'opt', qty: 2 }
  const loans: Loan[] = [
    { id: 'a', to: 'Sam', friendId: 'f-sam', lentAt: 1, cards: [card], gameNight: true },
    { id: 'b', to: 'Sam', friendId: 'f-sam', lentAt: 2, cards: [{ ...card, back: 1 }], backBy: '2026-10-20' },
    { id: 'c', to: 'priya', lentAt: 3, cards: [card], backBy: '2026-10-01' },
    { id: 'd', to: 'Priya ', lentAt: 4, cards: [card] },
    { id: 'e', to: 'Alex', lentAt: 5, cards: [{ ...card, back: 2 }] },
  ]
  const people = loanPeople(loans, '2026-10-04', [])
  assert.deepEqual(people.map((p) => `${p.name} · ${p.loans.map((l) => l.id).join('')} · ${p.copies} · ${p.label}`), [
    'priya · cd · 4 · Overdue · 3 days',
    'Sam · ab · 3 · Back by next game night',
  ])
  assert.equal(reminderText('Sam', [loans[0], loans[1]]), 'Hi Sam — could I have my cards back when you get a chance? 2× Opt, Opt. Thanks!')
  assert.deepEqual(serverCards({ ...loans[0], cards: [card, { ...card, foil: true, back: 1 }, { name: 'Shock', scryfallId: 'shock', qty: 1, back: 1 }] }), [
    { name: 'Opt', qty: 3, printingId: 'opt' },
  ])
})

test("turning 'lent' tags into loans", () => {
  assert.equal(tagBorrower('lent to sam'), 'Sam')
  assert.equal(tagBorrower('Lent: Priya'), 'Priya')
  assert.equal(tagBorrower('lent out to Alex'), 'Alex')
  assert.equal(tagBorrower('lent'), 'Someone')
  const cols = [pile([
    entry('bolt', 'Lightning Bolt', 3, 0, [at('red', 1, { section: 'Red' })], ['lent to Sam', 'red']),
    entry('shock', 'Shock', 0, 1, undefined, ['lent to sam']),
    entry('opt', 'Opt', 1, 0, undefined, ['lent']),
  ])]
  assert.deepEqual([storageSummary(cols, []).lent], [4])
  let n = 0
  const out = loansFromTags(cols, LENT_AT, () => `T${++n}`)
  assert.deepEqual(out.loans.map((l) => `${l.id} ${l.to}: ${l.cards.map((c) => `${c.name}${c.foil ? ' foil' : ''} ×${c.qty}`).join(', ')}`), [
    'T1 Sam: Lightning Bolt ×2, Shock foil ×1',
    'T2 Someone: Opt ×1',
  ])
  assert.equal(out.loans[0].note, 'From your “lent” tags')
  assert.deepEqual(out.retag, [{ scryfallId: 'bolt', tags: ['red'] }, { scryfallId: 'shock', tags: [] }, { scryfallId: 'opt', tags: [] }])
  // The copies count once: as loans (the tags still on until they're taken off).
  assert.equal(storageSummary(out.collections, []).lent, 4)
  // Run again with the tags still on: nothing new.
  assert.equal(loansFromTags(out.collections, LENT_AT, () => 'again').loans.length, 0)
})

test("two devices' loans merge loan by loan", () => {
  const card = { name: 'Lightning Bolt', scryfallId: 'bolt', qty: 2, collectionId: 'unsorted' }
  const base: Loan[] = [
    { id: 'L1', to: 'Sam', lentAt: 10, cards: [card] },
    { id: 'L2', to: 'Priya', lentAt: 20, cards: [card] },
  ]
  // Mine: one back on L1, a note on it; L2 deleted.
  const mine: Loan[] = [{ ...base[0], note: 'for Saturday', cards: [{ ...card, back: 1 }] }]
  // Theirs: L1 renamed, the other back too, and a new loan.
  const theirs: Loan[] = [
    { ...base[0], to: 'Sam R.', cards: [{ ...card, back: 2 }], returnedAt: 99 },
    base[1],
    { id: 'L3', to: 'Alex', lentAt: 30, cards: [{ ...card, qty: 1 }] },
  ]
  assert.deepEqual(mergeLoans(base, mine, theirs, true), [
    { id: 'L1', to: 'Sam R.', lentAt: 10, note: 'for Saturday', cards: [{ ...card, back: 2 }], returnedAt: 99 },
    { id: 'L3', to: 'Alex', lentAt: 30, cards: [{ ...card, qty: 1 }] },
  ])
  assert.equal(mergeLoans(undefined, undefined, undefined, true), undefined)
  // A card added to a loan on one side is kept; one taken off on the other stays off.
  const plus = [{ ...base[0], cards: [card, { name: 'Opt', scryfallId: 'opt', qty: 1 }] }]
  const minus = [{ ...base[0], cards: [] }]
  assert.deepEqual(mergeLoans([base[0]], plus, minus, false)![0].cards, [{ name: 'Opt', scryfallId: 'opt', qty: 1 }])
})

test("a pile saved by an app from before loans keeps them", () => {
  const loans: Loan[] = [{ id: 'L1', to: 'Sam', lentAt: 10, cards: [{ name: 'Opt', scryfallId: 'opt', qty: 1 }] }]
  const mine = pile([], loans)
  const older = pile([])
  assert.deepEqual(keepLoansFromOlderApp(mine, older).loans, loans)
  const knows = pile([], [])
  assert.equal(keepLoansFromOlderApp(mine, knows), knows)
})
