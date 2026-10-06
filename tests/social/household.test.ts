import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  borrowCards, deckNote, householdIntro, householdOfPlace, myShelfCopies, peopleTotals, placeContents, placeLines, pullAsks,
  shelfLoanId, shelfLoanLine, type Household, type HouseholdCards, type ShelfCopy,
} from '../../src/social/householdLogic.ts'
import type { Collection } from '../../src/types/models.ts'

// Sharing storage at home: grouping each person's copies by place, the page's lines, and a pull
// list's "ask Alex" cards. The Android app has the same checks — see HouseholdTest.kt.

const ME = 'me'
const ALEX = 'alex'
const profile = (id: string, name: string) => ({ user_id: id, username: id, display_name: name, avatar_path: null })

const home = (over: Partial<Household> = {}): Household => ({
  id: 'h1',
  name: 'Shared shelf',
  createdAt: 1,
  members: [
    { profile: profile(ALEX, 'Alex'), status: 'member' },
    { profile: profile(ME, 'Me'), status: 'member' },
    { profile: profile('sam', 'Sam'), status: 'invited' },
  ],
  places: [
    { placeId: 'red', name: 'Red box', kind: 'BOX', sharedBy: ME, users: [ME] },
    { placeId: 'blue', name: 'Blue box', kind: 'BOX', sharedBy: ME, users: [ME, ALEX] },
    { placeId: 'abinder', name: "Alex's binder", kind: 'BINDER', sharedBy: ALEX, users: [ALEX] },
  ],
  ...over,
})

const copy = (userId: string, placeId: string, name: string, qty: number, over: Partial<ShelfCopy> = {}): ShelfCopy =>
  ({ userId, placeId, scryfallId: `${name}-id`, name, imageUrl: null, qty, foil: false, ...over })

const binder = (id: string, entries: Collection['entries'], type: Collection['type'] = 'OWNED'): Collection =>
  ({ id, name: id, entries, createdAt: 1, type } as Collection)

test('my copies in the shared places come from my own library, wishlists left out', () => {
  const cols = [
    binder('b1', [
      { scryfallId: 's1', name: 'Sol Ring', imageUrl: null, quantity: 3, foilQuantity: 1, places: [{ placeId: 'red', qty: 2 }, { placeId: 'red', qty: 1, foil: true }, { placeId: 'private', qty: 1 }] },
    ]),
    binder('b2', [{ scryfallId: 's1', name: 'Sol Ring', imageUrl: null, quantity: 1, foilQuantity: 0, places: [{ placeId: 'red', qty: 1 }] }]),
    binder('w', [{ scryfallId: 's9', name: 'Wish', imageUrl: null, quantity: 1, foilQuantity: 0, places: [{ placeId: 'red', qty: 1 }] }], 'WISHLIST'),
  ]
  const mine = myShelfCopies(cols, ['red'], ME)
  assert.deepEqual(mine.map((c) => [c.placeId, c.name, c.qty, c.foil]).sort(), [['red', 'Sol Ring', 1, true], ['red', 'Sol Ring', 3, false]])
  assert.ok(mine.every((c) => c.userId === ME))
})

test('the page: intro, totals per person, and each place per person', () => {
  const h = home()
  const copies = [copy(ME, 'red', 'Sol Ring', 612), copy(ME, 'blue', 'Island', 210), copy(ALEX, 'blue', 'Forest', 188), copy(ALEX, 'abinder', 'Opt', 342)]
  assert.equal(householdIntro(h, ME), 'You and Alex keep cards on the same shelf. Each of you still owns your own cards.')
  assert.equal(deckNote(h, ME), 'Pull lists can include Alex\'s cards, marked "ask Alex", and the borrowed cards show under Loans.')
  const totals = peopleTotals(h, ME, copies, (c) => (c.name === 'Sol Ring' ? 2 : null))
  assert.deepEqual(totals.map((t) => [t.label, t.copies, t.usd]), [['You', 822, 1224], ['Alex', 530, null]])
  const lines = placeLines(h, ME, copies)
  assert.deepEqual(lines.map((l) => l.line), ['Yours 612 · Alex 0', 'Yours 210 · Alex 188', 'Alex 342 · you can see, not change'])
  assert.deepEqual(lines.map((l) => [l.readOnly, l.mine, l.canJoin]), [[false, true, false], [false, true, false], [true, false, false]])
  // Someone else's box, not a binder: the user may keep cards there too.
  const box = placeLines(home({ places: [{ placeId: 'g', name: 'Green box', kind: 'BOX', sharedBy: ALEX, users: [ALEX] }] }), ME, [])
  assert.deepEqual([box[0].line, box[0].canJoin], ['Alex 0 · you can see, not change', true])
  assert.deepEqual(placeContents(h, ME, 'blue', copies).map((g) => [g.name, g.copies.map((c) => c.name)]), [['You', ['Island']], ['Alex', ['Forest']]])
  assert.equal(householdOfPlace([h], 'blue')?.id, 'h1')
  assert.equal(householdOfPlace([h], 'nowhere'), null)
})

test('three people read as a list', () => {
  const h = home({ members: [...home().members.slice(0, 2), { profile: profile('sam', 'Sam'), status: 'member' }] })
  assert.equal(householdIntro(h, ME), 'You, Alex and Sam keep cards on the same shelf. Each of you still owns your own cards.')
  assert.equal(deckNote(h, ME), 'Pull lists can include Alex\'s and Sam\'s cards, marked "ask Alex" or "ask Sam", and the borrowed cards show under Loans.')
})

test('a pull list asks the people at home for what the deck is short of', () => {
  const h = home()
  const cards: HouseholdCards = {
    copies: [copy(ALEX, 'blue', 'Sol Ring', 1), copy(ALEX, 'abinder', 'Opt', 4), copy(ALEX, 'unshared', 'Brainstorm', 1), copy(ME, 'blue', 'Ponder', 1)],
    loans: [],
  }
  const r = pullAsks([{ name: 'Sol Ring', scryfallId: 'x', qty: 2 }, { name: 'opt', scryfallId: 'y', qty: 1 }, { name: 'Brainstorm', scryfallId: 'z', qty: 1 }], [{ household: h, cards }], ME)
  assert.equal(r.groups.length, 1)
  assert.equal(r.groups[0].title, 'Ask Alex')
  assert.deepEqual(r.groups[0].rows.map((x) => [x.name, x.qty, x.hint, x.printingId]), [['opt', 1, "ask Alex · Alex's binder", 'Opt-id'], ['Sol Ring', 1, 'ask Alex · Blue box', 'Sol Ring-id']])
  // Not on a shared shelf, or more than Alex has: still to buy.
  assert.deepEqual(r.stillMissing, [{ name: 'Sol Ring', scryfallId: 'x', qty: 1 }, { name: 'Brainstorm', scryfallId: 'z', qty: 1 }])
  assert.deepEqual(borrowCards(r.groups[0]), [{ name: 'opt', qty: 1, printingId: 'Opt-id' }, { name: 'Sol Ring', qty: 1, printingId: 'Sol Ring-id' }])
})

test('cards borrowed already show as borrowed, and copies lent from the shelf are not asked for again', () => {
  const h = home()
  const cards: HouseholdCards = {
    copies: [copy(ALEX, 'blue', 'Sol Ring', 2), copy(ALEX, 'blue', 'Opt', 1)],
    loans: [
      { id: 'l1', clientId: 'hh-1', lender: ALEX, borrower: ME, cards: [{ name: 'Sol Ring', qty: 1, printingId: 'p' }], note: null, lentAt: 1 },
      { id: 'l2', clientId: 'hh-2', lender: ALEX, borrower: 'sam', cards: [{ name: 'Opt', qty: 1, printingId: null }], note: null, lentAt: 1 },
    ],
  }
  const r = pullAsks([{ name: 'Sol Ring', scryfallId: 'x', qty: 2 }, { name: 'Opt', scryfallId: 'y', qty: 1 }], [{ household: h, cards }], ME)
  assert.deepEqual(r.groups[0].rows.map((x) => [x.name, x.qty, x.borrowed, x.hint]), [['Sol Ring', 1, false, 'ask Alex · Blue box'], ['Sol Ring', 1, true, 'borrowed from Alex']])
  assert.deepEqual(r.stillMissing, [{ name: 'Opt', scryfallId: 'y', qty: 1 }])
  assert.deepEqual(borrowCards(r.groups[0]), [{ name: 'Sol Ring', qty: 1, printingId: 'Sol Ring-id' }])
  assert.equal(shelfLoanLine(h, ME, cards.loans[0]), "You have 1 card of Alex's")
  assert.equal(shelfLoanLine(h, ALEX, cards.loans[0]), 'Me has 1 of your cards')
})

test('without households (or before the server has them) nothing is asked and everything stays missing', () => {
  const missing = [{ name: 'Sol Ring', scryfallId: 'x', qty: 2 }, { name: 'Opt', scryfallId: 'y', qty: 0 }]
  assert.deepEqual(pullAsks(missing, null, ME), { groups: [], stillMissing: [missing[0]] })
  assert.deepEqual(pullAsks(missing, [], ME), { groups: [], stillMissing: [missing[0]] })
})

test('a shelf loan id is hh- and 20 letters or digits', () => {
  assert.match(shelfLoanId(), /^hh-[A-Za-z0-9]{20}$/)
  assert.equal(shelfLoanId(() => 0), 'hh-AAAAAAAAAAAAAAAAAAAA')
})
