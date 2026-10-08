import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyUpgrades, bracketWarning, withThousands, ownedSources, pairKey, shortCommander, upgradeRoleOf, upgradeScore, upgradeSummary, upgradeSwaps, withUpgrade,
  type UpgradeDeckCard, type UpgradeInput, type UpgradeOwnedCard,
} from '../../src/decks/deckUpgrade.ts'
import type { Collection, Deck, DeckCardEntry } from '../../src/types/models.ts'

// "Upgrade with my cards". The cases in deckUpgradeVectors.json are run by the Android app too
// (DeckUpgradeTest.kt), so both apps pair, guard and explain swaps the same way.

type Raw = Record<string, unknown>
const card = (o: Raw) => ({
  name: o.name as string,
  scryfallId: (o.scryfallId as string | undefined) ?? (o.name as string),
  typeLine: (o.typeLine as string | undefined) ?? null,
  cmc: (o.cmc as number | undefined) ?? null,
  roles: (o.roles as string[] | undefined) ?? [],
  usd: (o.usd as number | undefined) ?? null,
  gameChanger: !!o.gameChanger,
  edhrecRank: (o.edhrecRank as number | undefined) ?? null,
  inclusion: (o.inclusion as number | undefined) ?? null,
})
const deckCard = (o: Raw): UpgradeDeckCard => ({ ...card(o), commander: !!o.commander, replaceable: !!o.replaceable, keep: !!o.keep, comboPiece: !!o.comboPiece })
const ownedCard = (o: Raw): UpgradeOwnedCard => ({
  ...card(o),
  identity: (o.identity as string | undefined) ?? null,
  legal: o.legal !== false,
  completesCombo: !!o.completesCombo,
  spare: (o.spare as number | undefined) ?? 0,
  heldBy: (o.heldBy as string | undefined) ?? null,
  where: (o.where as string | undefined) ?? null,
  placeKey: (o.placeKey as string | undefined) ?? null,
})

interface Case { name: string; input: Raw & { deck: Raw[]; owned: Raw[] }; expect: Raw[]; summary: string }
const V = JSON.parse(readFileSync(new URL('./deckUpgradeVectors.json', import.meta.url), 'utf8')) as { cases: Case[] }

const inputOf = (c: Case): UpgradeInput => ({
  commander: c.input.commander as string | null,
  identity: c.input.identity as string | null,
  edhrec: c.input.edhrec as boolean,
  bracket: c.input.bracket as UpgradeInput['bracket'],
  dismissed: c.input.dismissed as string[],
  deck: c.input.deck.map(deckCard),
  owned: c.input.owned.map(ownedCard),
})

test('the shared cases: which swaps, in what order, why, from where, and the bracket they would move to', () => {
  for (const c of V.cases) {
    const got = upgradeSwaps(inputOf(c)).map((s) => ({
      key: s.key, role: s.role, reason: s.reason, where: s.where, gain: s.gain, priceDelta: s.priceDelta, raisesBracketTo: s.raisesBracketTo,
    }))
    assert.deepEqual(got, c.expect, c.name)
  }
})

test('the shared cases: the summary of the swaps that keep the bracket', () => {
  for (const c of V.cases) {
    const keeping = upgradeSwaps(inputOf(c)).filter((s) => s.raisesBracketTo == null)
    assert.equal(upgradeSummary(keeping, (n) => `$${n}`), c.summary, c.name)
  }
})

test('words and numbers', () => {
  assert.equal(withThousands(9000), '9,000')
  assert.equal(withThousands(1234567), '1,234,567')
  assert.equal(withThousands(12), '12')
  assert.equal(shortCommander('Krenko, Mob Boss'), 'Krenko')
  assert.equal(shortCommander('Esika, God of the Tree // The Prismatic Bridge'), 'Esika')
  assert.equal(pairKey(' Mind Stone', "Jeska's Will "), "mind stone>jeska's will")
  assert.equal(bracketWarning(4), 'Would move the deck to bracket 4')
  assert.equal(upgradeRoleOf(['treasure', 'draw', 'ramp']), 'ramp')
  assert.equal(upgradeRoleOf(['treasure']), null)
  assert.equal(upgradeScore(card({ name: 'X', inclusion: 33 }), true), 33)
  assert.equal(upgradeScore(card({ name: 'X' }), true), 0)
  assert.equal(upgradeScore(card({ name: 'X', edhrecRank: 1000, cmc: 2 }), false), 44)
  assert.equal(upgradeSummary([], (n) => `$${n}`), '0 upgrades from your cards')
})

// ---- Where the owned cards are ----

const entry = (name: string, quantity: number, extra: Raw = {}) => ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, foilQuantity: 0, ...extra })
const dcard = (name: string, quantity = 1, extra: Partial<DeckCardEntry> = {}): DeckCardEntry =>
  ({ scryfallId: `id-${name}`, name, imageUrl: null, quantity, canBeCommander: false, typeLine: 'Artifact', partnerAbility: null, ...extra })
const deckOf = (id: string, name: string, ownership: Deck['ownership'], cards: DeckCardEntry[]): Deck =>
  ({ id, name, commander: null, partnerCommander: null, cards, gameMode: 'COMMANDER', createdAt: 0, tags: [], gameResults: [], ownership })

test('owned cards: spare copies with their place, copies other decks wait on, cards only another deck has', () => {
  const collections = [
    {
      id: 'unsorted', name: 'Unsorted', type: 'OWNED', createdAt: 0,
      storagePlaces: [{ id: 'red', name: 'Red box', kind: 'BOX', createdAt: 0 }, { id: 'dsk', name: 'Duskmourn binder', kind: 'BINDER', createdAt: 0 }],
      entries: [entry('Sol Ring', 1), entry('Arcane Signet', 1, { places: [{ placeId: 'red', qty: 1, section: 'Artifacts' }] })],
    },
    { id: 'b1', name: 'Trade binder', type: 'OWNED', createdAt: 0, entries: [entry('Fellwar Stone', 2, { places: [{ placeId: 'dsk', qty: 1, page: 3, slot: 5 }] }), entry('Mind Stone', 1)] },
    { id: 'w', name: 'Wishlist', type: 'WISHLIST', createdAt: 0, entries: [entry('Mana Crypt', 1)] },
  ] as Collection[]
  const decks = [
    deckOf('me', 'Krenko', 'PHYSICAL', [dcard('Sol Ring')]),
    deckOf('v', 'Brew', 'VIRTUAL', [dcard('Mind Stone'), dcard('Fellwar Stone')]),
    deckOf('a', 'Atraxa', 'PHYSICAL', [dcard('Big Score'), dcard('Proxy Thing', 1, { proxyQuantity: 1 })]),
  ]
  const got = ownedSources(collections, decks, 'me')
  assert.deepEqual(got.get('arcane signet'), { name: 'Arcane Signet', scryfallId: 'id-Arcane Signet', spare: 1, heldBy: null, where: 'Red box › Artifacts', placeKey: 'place:red' })
  assert.deepEqual(got.get('fellwar stone'), { name: 'Fellwar Stone', scryfallId: 'id-Fellwar Stone', spare: 1, heldBy: null, where: 'Duskmourn binder p3 s5', placeKey: 'place:dsk' })
  assert.deepEqual(got.get('sol ring'), { name: 'Sol Ring', scryfallId: 'id-Sol Ring', spare: 1, heldBy: null, where: 'Unsorted', placeKey: 'binder:unsorted' })
  assert.deepEqual(got.get('mind stone'), { name: 'Mind Stone', scryfallId: 'id-Mind Stone', spare: 0, heldBy: 'Brew', where: null, placeKey: null })
  assert.deepEqual(got.get('big score'), { name: 'Big Score', scryfallId: 'id-Big Score', spare: 0, heldBy: 'Atraxa', where: null, placeKey: null })
  assert.equal(got.has('mana crypt'), false)
  assert.equal(got.has('proxy thing'), false)
})

// ---- Swapping ----

test('a swap: the cut onto Considering, the new card into the deck and onto its pull list', () => {
  const physical = deckOf('me', 'Krenko', 'PHYSICAL', [dcard('Mind Stone', 1, { replaceable: true }), dcard('Shock')])
  const after = withUpgrade(physical, 'id-Mind Stone', dcard('Arcane Signet'))
  assert.deepEqual(after.cards.map((c) => [c.name, c.quantity, c.proxyQuantity]), [['Shock', 1, undefined], ['Arcane Signet', 1, 1]])
  assert.deepEqual(after.considering?.map((c) => [c.name, c.replaceable]), [['Mind Stone', false]])
  // A deck that doesn't hold its cards asks for every copy anyway.
  const virtual = withUpgrade({ ...physical, ownership: 'VIRTUAL' }, 'id-Mind Stone', dcard('Arcane Signet', 1, { proxyQuantity: 0 }))
  assert.equal(virtual.cards.find((c) => c.name === 'Arcane Signet')?.proxyQuantity, undefined)
  // Already in the deck, or the cut gone: nothing changes.
  assert.equal(withUpgrade(physical, 'id-Mind Stone', dcard('Shock')), physical)
  assert.equal(withUpgrade(physical, 'id-Nope', dcard('Arcane Signet')), physical)
})

test('swaps applied together: the real copies cut go back to the Unsorted pile', () => {
  const deck = deckOf('me', 'Krenko', 'PHYSICAL', [dcard('Mind Stone'), dcard('Shock', 1, { proxyQuantity: 1 }), dcard('Opt')])
  const cols = [{ id: 'unsorted', name: 'Unsorted', type: 'OWNED', createdAt: 0, entries: [] }] as unknown as Collection[]
  const out = applyUpgrades(cols, [deck], 'me', [
    { cutId: 'id-Mind Stone', add: dcard('Arcane Signet') },
    { cutId: 'id-Shock', add: dcard('Chaos Warp') },
  ])
  assert.deepEqual(out.decks[0].cards.map((c) => c.name), ['Opt', 'Arcane Signet', 'Chaos Warp'])
  assert.deepEqual(out.decks[0].considering?.map((c) => c.name), ['Mind Stone', 'Shock'])
  assert.deepEqual(out.collections[0].entries.map((e) => [e.name, e.quantity]), [['Mind Stone', 1]])
  const none = applyUpgrades(cols, [deck], 'me', [{ cutId: 'id-Gone', add: dcard('Arcane Signet') }])
  assert.equal(none.decks[0], deck)
  assert.equal(none.collections, cols)
})
