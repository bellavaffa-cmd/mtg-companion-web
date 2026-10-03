import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createListLoader, type CardListState } from '../../src/api/cardLists.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'

// A whole Scryfall search, page by page, kept for the session (src/api/cardLists.ts).

const cards = (...names: string[]) => names.map((name) => ({ id: name, name }) as ScryfallCard)
const settle = () => new Promise((r) => setTimeout(r, 0))

test('every page is fetched in turn and shown as it arrives', async () => {
  const asked: number[] = []
  const pages = [cards('a', 'b'), cards('c'), cards('d')]
  const loader = createListLoader(async (_q, page) => {
    asked.push(page)
    return { cards: pages[page - 1], hasMore: page < pages.length }
  })
  const seen: CardListState[] = []
  loader.watch('q', (s) => seen.push(s))
  await settle(); await settle(); await settle(); await settle()
  assert.deepEqual(asked, [1, 2, 3])
  assert.deepEqual(seen.map((s) => s.cards.length), [0, 2, 3, 4])
  assert.equal(seen.at(-1)!.done, true)
})

test('a second look at the same search fetches nothing', async () => {
  let fetched = 0
  const loader = createListLoader(async () => { fetched++; return { cards: cards('a'), hasMore: false } })
  loader.watch('q', () => {})
  await settle(); await settle()
  let last: CardListState | null = null
  loader.watch('q', (s) => { last = s })
  assert.equal(fetched, 1)
  assert.deepEqual(last!.cards.map((c) => c.name), ['a'])
})

test('a failed page keeps what came before, and looking again carries on from it', async () => {
  let fail = true
  const asked: number[] = []
  const loader = createListLoader(async (_q, page) => {
    asked.push(page)
    if (page === 2 && fail) throw new Error('offline')
    return { cards: cards(`p${page}`), hasMore: page < 3 }
  })
  let last: CardListState | null = null
  loader.watch('q', (s) => { last = s })
  await settle(); await settle(); await settle()
  assert.equal(last!.error, 'offline')
  assert.deepEqual(last!.cards.map((c) => c.name), ['p1'])
  fail = false
  loader.watch('q', (s) => { last = s })
  await settle(); await settle(); await settle()
  assert.deepEqual(asked, [1, 2, 2, 3])
  assert.deepEqual(last!.cards.map((c) => c.name), ['p1', 'p2', 'p3'])
  assert.equal(last!.error, null)
  assert.equal(last!.done, true)
})
