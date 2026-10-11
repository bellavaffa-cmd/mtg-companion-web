// Card tags reach every card (tag-fixes): fallback tags from the text and type line, lookups by
// printing id first, retries that carry on where they stopped, a new Tagger file re-tagging what's
// known, the one-off keyword fill-in, the Cards filter's tag chips and a cache that outgrows
// localStorage. The Android app has the same cases — app/src/test/.../data/TagFixesTest.kt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_TAGS, combine, isDue, key, lookUp, readCards, retagged, textTags, withRetries, type TagRef, type TagRecord,
} from '../../src/tags/roleTags.ts'
import { decksWithFilledTags, idsNeedingTags, refsOf, tagsById, withFilledTags } from '../../src/tags/tagPass.ts'
import { loadText, movedKey, saveText, type BigStore, type TextStore } from '../../src/tags/tagStore.ts'
import { filterActive, filterCount, filterMatches, filterMatchesTags, NO_COLLECTION_FILTER } from '../../src/collection/cardFilter.ts'
import type { ScryfallCard } from '../../src/types/scryfall.ts'
import type { Collection, Deck, DeckCardEntry } from '../../src/types/models.ts'

const SOL = '11111111-aaaa-bbbb-cccc-000000000001'
const RING_ORACLE = 'aaaaaaaa-0000-0000-0000-000000000001'
const sets = new Map([['ramp', new Set([RING_ORACLE.slice(0, 13)])], ['mana-rock', new Set([RING_ORACLE.slice(0, 13)])]])
const noSleep = async () => {}

// ---- Fallback tags: the same vectors as the Android app's ----

test('lands, fixing and vanilla come from the type line and text', () => {
  assert.deepEqual(textTags('({T}: Add {G}.)', 'Basic Land — Forest').always, ['land'])
  assert.deepEqual(textTags('({T}: Add {G} or {W}.)\nAs Breeding Pool enters, you may pay 2 life.', 'Land — Forest Plains').always, ['land', 'fixing'])
  assert.deepEqual(textTags('{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', 'Land').always, ['land', 'fixing'])
  assert.deepEqual(textTags("{T}: Add {C}.\n{T}: Add one mana of any color in your commander's color identity.", 'Land', ['B', 'G', 'R', 'U', 'W']).always, ['land', 'fixing'])
  assert.deepEqual(textTags('{T}: Add one mana of any color.', 'Artifact').always, ['fixing'])
  assert.deepEqual(textTags('', 'Creature — Bear').always, ['vanilla'])
  // A creature that taps for any colour is ramp, not fixing (lands and artifacts only).
  assert.deepEqual(textTags('{T}: Add one mana of any color.', 'Creature — Bird').always, [])
  // A modal double-faced spell with a land back is the spell.
  assert.ok(!textTags('Destroy target creature.', 'Instant // Land').always.includes('land'))
})

test('ramp, draw and removal come from the text only when Tagger has nothing', () => {
  assert.deepEqual(textTags('{1}, {T}: Add {B}{R}.', 'Artifact').fallback, ['ramp'])
  assert.deepEqual(textTags('Draw two cards.', 'Sorcery').fallback, ['draw'])
  assert.deepEqual(textTags("Destroy target creature. It can't be regenerated.", 'Instant').fallback, ['removal'])
  assert.deepEqual(textTags('Lightning Bolt deals 3 damage to any target.', 'Instant').fallback, ['removal'])
  assert.deepEqual(textTags('({T}: Add {G}.)', 'Basic Land — Forest').fallback, [])
  const text = { always: [], fallback: ['draw'] }
  assert.deepEqual(combine(RING_ORACLE, text, sets), ['ramp', 'mana-rock'])
  assert.deepEqual(combine('bbbbbbbb-0000-0000-0000-000000000002', text, sets), ['draw'])
  assert.deepEqual(combine(undefined, text, new Map()), ['draw'])
  assert.deepEqual(combine(RING_ORACLE, { always: ['fixing'], fallback: [] }, sets), ['ramp', 'mana-rock', 'fixing'])
})

test("the tag list is the Android app's", () => {
  assert.deepEqual(ROLE_TAGS.map((t) => t.id), [
    'ramp', 'mana-rock', 'mana-dork', 'land-ramp', 'mana-engine', 'draw', 'tutor', 'removal', 'board-wipe', 'counterspell',
    'protection', 'recursion', 'reanimate', 'sacrifice-outlet', 'tokens', 'treasure', 'tax', 'lifegain', 'burn',
    'graveyard-hate', 'extra-turn', 'wheel', 'land', 'fixing', 'vanilla',
  ])
})

// ---- When a card is looked up again ----

test('a card is due again after a month, a week with no tags, or under a new file', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 100 * day
  assert.ok(isDue(undefined, now, 'f1'))
  assert.ok(!isDue({ t: ['ramp'], at: now - 20 * day, o: 'x', f: 'f1' }, now, 'f1'))
  assert.ok(isDue({ t: ['ramp'], at: now - 31 * day, o: 'x', f: 'f1' }, now, 'f1'))
  assert.ok(!isDue({ t: [], at: now - 6 * day, o: 'x', f: 'f1' }, now, 'f1'))
  assert.ok(isDue({ t: [], at: now - 8 * day, o: 'x', f: 'f1' }, now, 'f1'))
  assert.ok(isDue({ t: [], at: now - day, f: 'f1' }, now, 'f2'))
  assert.ok(!isDue({ t: [], at: now - day, o: 'x', f: 'f1' }, now, 'f2'))
  assert.ok(isDue({ t: ['ramp'], at: 0, o: 'x', f: 'f1' }, now, 'f1'))
})

test('a new Tagger file re-tags every known card without a lookup', () => {
  const records: Record<string, TagRecord> = {
    'sol ring': { t: [], at: 5, o: RING_ORACLE.slice(0, 13), x: ['draw'], f: 'f1' },
    mystery: { t: [], at: 5, f: 'f1' },
    current: { t: ['draw'], at: 5, o: 'cccccccc-0000', f: 'f2' },
  }
  const again = retagged(records, sets, 'f2')!
  assert.deepEqual(again['sol ring'].t, ['ramp', 'mana-rock'])
  assert.equal(again['sol ring'].f, 'f2')
  assert.equal(again['sol ring'].at, 5)
  assert.equal(again.mystery, records.mystery)
  assert.equal(again.current, records.current)
  assert.equal(retagged({ current: records.current }, sets, 'f2'), null)
})

test('an older cache still shows its tags, but every card in it is due', () => {
  const old = readCards({ v: 4, cards: { 'sol ring': { t: ['ramp'], at: 99, c: '' } } })
  assert.deepEqual(old['sol ring'].t, ['ramp'])
  assert.ok(isDue(old['sol ring'], Date.now(), null))
  assert.deepEqual(readCards({ v: 3, cards: { x: { t: [], at: 1 } } }), {})
})

// ---- Looking up: id first, name as a fallback, retry and resume ----

const card = (id: string, name: string, oracle: string | undefined, text = '', type = 'Artifact'): ScryfallCard =>
  ({ id, oracle_id: oracle, name, oracle_text: text, type_line: type, color_identity: [] }) as unknown as ScryfallCard

test('a card is looked up by its printing first, so proxies and renamed cards resolve', async () => {
  const asked: { id?: string; name?: string }[][] = []
  const ring = card(SOL, 'Sol Ring', RING_ORACLE, '{T}: Add {C}{C}.')
  const elf = card('22222222-aaaa-bbbb-cccc-000000000002', 'Llanowar Elves', 'dddddddd-0000-0000-0000-000000000004', '{T}: Add {G}.', 'Creature — Elf Druid')
  const fetchCards = async (ids: { id?: string; name?: string }[]) => {
    asked.push(ids)
    return { data: ids.map((i) => (i.id === SOL ? ring : i.name === 'Llanowar Elves' ? elf : null)).filter((c): c is ScryfallCard => !!c) }
  }
  const found = new Map<string, TagRecord>()
  const refs: TagRef[] = [
    { name: 'My Sol Ring proxy', scryfallId: SOL },
    { name: 'Llanowar Elves', scryfallId: '99999999-aaaa-bbbb-cccc-000000000009' },
    { name: 'Treasure', scryfallId: 'sample-treasure' },
  ]
  const ok = await lookUp(refs, fetchCards, sets, 'f1', { sleep: noSleep, onFound: (m) => m.forEach((v, k) => found.set(k, v)) })
  assert.ok(ok)
  assert.equal(asked[0][0].id, SOL)
  assert.equal(asked[0][2].name, 'Treasure')
  assert.equal(asked[1][0].name, 'Llanowar Elves')
  assert.deepEqual(found.get('my sol ring proxy')!.t, ['ramp', 'mana-rock'])
  assert.deepEqual(found.get('sol ring')!.t, ['ramp', 'mana-rock'])
  assert.deepEqual(found.get('llanowar elves')!.t, ['ramp'])
  assert.equal(found.get('llanowar elves')!.o, 'dddddddd-0000')
  assert.deepEqual(found.get('treasure'), { t: [], at: found.get('treasure')!.at, f: 'f1' })
})

test('a failed request is retried with backoff, and a stopped lookup resumes where it stopped', async () => {
  const refs: TagRef[] = Array.from({ length: 160 }, (_, i) => ({ name: `Card ${i + 1}` }))
  const answer = async (ids: { name?: string }[]) => ({ data: ids.map((i) => card(`id-${i.name}`, i.name!, undefined)) })
  const cache = new Map<string, TagRecord>()
  const slept: number[] = []
  let n = 0
  const flaky = async (ids: { name?: string }[]) => {
    n++
    if (n === 2 || n === 3) throw new Error('offline')
    return answer(ids)
  }
  assert.ok(await lookUp(refs, flaky, new Map(), null, { retries: [10, 20], sleep: async (ms) => { slept.push(ms) }, onFound: (m) => m.forEach((v, k) => cache.set(k, v)) }))
  assert.deepEqual(slept, [10, 20])
  assert.equal(refs.filter((r) => cache.has(key(r.name))).length, 160)

  cache.clear()
  let m = 0
  const dies = async (ids: { name?: string }[]) => { if (++m > 1) throw new Error('offline'); return answer(ids) }
  assert.ok(!(await lookUp(refs, dies, new Map(), null, { retries: [1], sleep: noSleep, onFound: (r) => r.forEach((v, k) => cache.set(k, v)) })))
  assert.equal(cache.size, 75)
  const now = Date.now()
  const left = refs.filter((r) => isDue(cache.get(key(r.name)), now, null))
  assert.equal(left.length, 85)
  const asked: string[] = []
  assert.ok(await lookUp(left, async (ids) => { asked.push(...ids.map((i) => i.name!)); return answer(ids) }, new Map(), null, { sleep: noSleep, onFound: (r) => r.forEach((v, k) => cache.set(k, v)) }))
  assert.equal(asked[0], 'Card 76')
  assert.equal(cache.size, 160)
})

test('retries give up after the last wait', async () => {
  let calls = 0
  assert.equal(await withRetries([1, 2], noSleep, async () => { calls++; throw new Error('no') }), null)
  assert.equal(calls, 3)
})

// ---- The pass covers every card the user has ----

const entry = (name: string, id = `sample-${name}`, extra: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null, ...extra })
const deck = (d: Partial<Deck>): Deck =>
  ({ id: 'd', name: 'Deck', commander: null, partnerCommander: null, cards: [], gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership: 'PHYSICAL', ...d }) as Deck
const binder = (id: string, entries: { scryfallId: string; name: string; tags?: string[] }[], type = 'OWNED'): Collection =>
  ({ id, name: id, entries: entries.map((e) => ({ imageUrl: null, quantity: 1, foilQuantity: 0, ...e })), createdAt: 0, type }) as unknown as Collection

test('the pass covers binders, the Wishlist and every part of a deck', () => {
  const collections = [binder('a', [{ scryfallId: SOL, name: 'Sol Ring' }]), binder('w', [{ scryfallId: '33333333-aaaa-bbbb-cccc-000000000003', name: 'Mox Opal' }], 'WISHLIST')]
  const decks = [deck({ commander: entry('Omnath'), cards: [entry('Omnath'), entry('sol ring')], considering: [entry('Cultivate')], sideboard: [entry('Duress')] })]
  const refs = refsOf(collections, decks)
  assert.deepEqual(refs.map((r) => r.name), ['Sol Ring', 'Mox Opal', 'Omnath', 'Cultivate', 'Duress'])
  assert.equal(refs[0].scryfallId, SOL)
  assert.equal(refs.find((r) => r.name === 'Omnath')!.scryfallId, undefined)
})

// ---- Untagged and the user's own tags in the Cards filter ----

test('the Cards filter finds untagged cards and the user\'s own tags', () => {
  const untagged = { ...NO_COLLECTION_FILTER, untagged: true }
  assert.ok(filterActive(untagged))
  assert.ok(filterMatches(untagged, null))
  assert.ok(filterMatchesTags(untagged, [], []))
  assert.ok(!filterMatchesTags(untagged, ['ramp'], []))
  assert.ok(!filterMatchesTags(untagged, undefined, []))
  const mine = { ...NO_COLLECTION_FILTER, userTags: ['signed'] }
  assert.ok(filterMatchesTags(mine, undefined, ['Signed', 'proxy']))
  assert.ok(!filterMatchesTags(mine, ['ramp'], ['proxy']))
  assert.equal(filterCount({ ...NO_COLLECTION_FILTER, untagged: true, userTags: ['signed'] }), 2)
})

// ---- The one-off keyword fill-in ----

test('old entries get their keyword tags in one change', async () => {
  const bird = '44444444-aaaa-bbbb-cccc-000000000004'
  const collections = [binder('a', [{ scryfallId: bird, name: 'Birds of Paradise' }, { scryfallId: SOL, name: 'Sol Ring', tags: ['Ramp'] }])]
  const decks = [deck({ cards: [entry('Birds of Paradise', bird)] })]
  assert.deepEqual(idsNeedingTags(collections, decks), [bird])
  const fetchCards = async (ids: { id?: string }[]) => ({
    data: ids.map((i) => ({ id: i.id!, name: 'Birds of Paradise', keywords: ['Flying'], oracle_text: 'Flying\n{T}: Add one mana of any color.' }) as unknown as ScryfallCard),
  })
  const tags = (await tagsById([bird], fetchCards))!
  assert.deepEqual(tags.get(bird)!.slice(0, 1), ['Flying'])
  const filled = withFilledTags(collections, tags)
  assert.deepEqual(filled[0].entries[0].tags, tags.get(bird))
  assert.deepEqual(filled[0].entries[1].tags, ['Ramp'])
  assert.deepEqual(decksWithFilledTags(decks, tags)[0].cards[0].tags, tags.get(bird))
  assert.equal(withFilledTags(filled, tags), filled)
  assert.equal(decksWithFilledTags(decks, new Map()), decks)
  assert.equal(await tagsById([bird], async () => { throw new Error('offline') }), null)
})

// ---- A cache too big for localStorage moves to IndexedDB, never silently lost ----

function memoryLocal(limit: number): TextStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      const used = [...data].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0)
      if (used + v.length > limit) throw new DOMException('full', 'QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k) => { data.delete(k) },
  }
}
const memoryBig = (): BigStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v) } }
}

test('a tag cache that outgrows localStorage moves to IndexedDB and is read back from there', async () => {
  const local = memoryLocal(100)
  const big = memoryBig()
  assert.equal(await saveText('tags', 'small', local, big), 'local')
  assert.equal(await loadText('tags', local, big), 'small')
  const huge = 'x'.repeat(500)
  assert.equal(await saveText('tags', huge, local, big), 'idb')
  assert.equal(local.getItem(movedKey('tags')), 'idb')
  // The old copy is cleared to make room; the cache is read from IndexedDB from then on.
  assert.equal(local.getItem('tags'), null)
  assert.equal(await loadText('tags', local, big), huge)
  // A later save that would fit goes to IndexedDB too, so the two never disagree.
  assert.equal(await saveText('tags', 'small again', local, big), 'idb')
  assert.equal(await loadText('tags', local, big), 'small again')
  // Nowhere to put it: said so, not silently dropped.
  const warn = console.warn
  let warned = false
  console.warn = () => { warned = true }
  try {
    assert.equal(await saveText('other', huge, memoryLocal(10), null), 'lost')
  } finally {
    console.warn = warn
  }
  assert.ok(warned)
})
