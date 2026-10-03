import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientCardName, deckExportText } from '../../src/decks/deckExport.ts'
import { parseCardList } from '../../src/collection/cardListText.ts'
import { normalizeDeck, type DeckCardEntry } from '../../src/types/models.ts'

// A deck as text for other apps — Simple, Exact printing, Arena and MTGO. The Android app's
// DeckExportTest has the same cases.

const card = (id: string, name: string, quantity = 1, typeLine: string | null = 'Instant', back: string | null = null): DeckCardEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, canBeCommander: false, typeLine, partnerAbility: null, backImageUrl: back })

const atraxa = card('atraxa', "Atraxa, Praetors' Voice", 1, 'Legendary Creature')
const commanderDeck = normalizeDeck({
  id: 'd', name: 'Atraxa', commander: atraxa,
  cards: [card('sol', 'Sol Ring', 1, 'Artifact'), atraxa, card('forest', 'Forest', 30, 'Basic Land — Forest')],
  considering: [card('x', 'Rhystic Study')],
})
const burn = normalizeDeck({
  id: 'b', name: 'Burn', gameMode: 'MODERN',
  cards: [card('bolt', 'Lightning Bolt', 4), card('delver', 'Delver of Secrets // Insectile Aberration', 2, 'Creature — Human Wizard // Creature — Human Insect', 'back.jpg')],
  sideboard: [card('fire', 'Fire // Ice', 2, 'Instant // Instant'), card('smash', 'Smash to Smithereens', 3)],
})
const printings = new Map<string, [string, string]>([['bolt', ['2xm', '117']], ['delver', ['isd', '51']], ['fire', ['mh2', '290']], ['atraxa', ['cm2', '10']], ['sol', ['cmr', '472']]])

test('simple lists commanders first, then the rest by name, never Considering', () => {
  assert.equal(deckExportText(commanderDeck, 'SIMPLE'), "1 Atraxa, Praetors' Voice\n30 Forest\n1 Sol Ring")
})

test('simple and exact add a Sideboard section that reads back into the sideboard', () => {
  const text = deckExportText(burn, 'EXACT', printings)
  assert.equal(
    text,
    '2 Delver of Secrets // Insectile Aberration (ISD) 51\n4 Lightning Bolt (2XM) 117\n\n' +
      'Sideboard\n2 Fire // Ice (MH2) 290\n3 Smash to Smithereens',
  )
  assert.deepEqual(parseCardList(text).lines.map((l) => l.section ?? 'main'), ['main', 'main', 'sideboard', 'sideboard'])
})

test('arena has Commander, Deck and Sideboard sections and front-face names', () => {
  assert.equal(
    deckExportText(commanderDeck, 'ARENA', printings),
    "Commander\n1 Atraxa, Praetors' Voice (CM2) 10\n\nDeck\n30 Forest\n1 Sol Ring (CMR) 472",
  )
  assert.equal(
    deckExportText(burn, 'ARENA', printings),
    'Deck\n2 Delver of Secrets (ISD) 51\n4 Lightning Bolt (2XM) 117\n\nSideboard\n2 Fire // Ice (MH2) 290\n3 Smash to Smithereens',
  )
})

test('mtgo is plain lines, the sideboard after a blank line, no set codes', () => {
  assert.equal(deckExportText(burn, 'MTGO', printings), '2 Delver of Secrets\n4 Lightning Bolt\n\n2 Fire/Ice\n3 Smash to Smithereens')
  // A Commander deck's commander goes where MTGO looks for it: the sideboard part.
  assert.equal(deckExportText(commanderDeck, 'MTGO'), "30 Forest\n1 Sol Ring\n\n1 Atraxa, Praetors' Voice")
})

test('adventures and omens use the front face, split cards keep both halves', () => {
  const giant = card('g', 'Bonecrusher Giant // Stomp', 1, 'Creature — Giant // Instant — Adventure')
  assert.equal(clientCardName(giant, 'MTGO'), 'Bonecrusher Giant')
  assert.equal(clientCardName(giant, 'ARENA'), 'Bonecrusher Giant')
  const fire = card('f', 'Fire // Ice', 1, 'Instant // Instant')
  assert.equal(clientCardName(fire, 'ARENA'), 'Fire // Ice')
  assert.equal(clientCardName(fire, 'SIMPLE'), 'Fire // Ice')
})
