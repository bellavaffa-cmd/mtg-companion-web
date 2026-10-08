// The scanner's Last scanned panel (src/scan/scanCardPanel.ts). The Android app has the same checks —
// see ScanCardPanelTest.kt.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cameraReadsLine, copiesInScan, HeldPrintingWatch, ownedLine, ownedSummary, panelPrice, printedLanguage, printingMismatch,
  scanDetailsLine, scanHowLabel, scanIsGuess, scanPanelSpoken, cameraButtonLabel,
} from '../../src/scan/scanCardPanel.ts'
import { normalizeDeck, type Collection, type CollectionEntry, type CopyPlace, type DeckCardEntry } from '../../src/types/models.ts'

test("the details line is the card's bottom left", () => {
  assert.equal(scanDetailsLine('fin', '0306', 'common', 'Basic Land — Forest', null, false), 'FIN · 0306 · L · EN')
  assert.equal(scanDetailsLine('dsk', '123', 'mythic', 'Creature — Horror', 'ja', true), 'DSK · 123 · M · JP · Foil')
  assert.equal(scanDetailsLine('sld', '1502', 'special', 'Artifact', 'en', false), 'SLD · 1502 · S · EN')
  assert.equal(scanDetailsLine('tfin', '4', 'common', 'Token Creature — Moogle', 'en', false), 'TFIN · 4 · T · EN')
  assert.equal(scanDetailsLine('m21', '12', 'uncommon', 'Instant', 'ko', false), 'M21 · 12 · U · KR')
  assert.equal(scanDetailsLine(null, null, 'rare', 'Sorcery', 'en', false), 'R · EN')
})

test('languages as printed', () => {
  assert.equal(printedLanguage(null), 'EN')
  assert.equal(printedLanguage('zhs'), 'CS')
  assert.equal(printedLanguage('zht'), 'CT')
  assert.equal(printedLanguage('de'), 'DE')
})

test('how it was identified', () => {
  assert.equal(scanHowLabel('SMALL_PRINT', true), 'From small print')
  assert.equal(scanHowLabel('NAME', true), 'By name')
  assert.equal(scanHowLabel('NAME', false), 'Best guess')
  assert.equal(scanHowLabel('SIGHT', false), 'Best guess')
  assert.equal(scanHowLabel('SIGHT', true), 'By sight')
  assert.equal(scanHowLabel('LEARNED', false), 'Learned')
  assert.equal(scanHowLabel('PICKED', true), 'Picked by you')
  assert.equal(scanHowLabel(null, false), 'Best guess')
  assert.equal(scanHowLabel(null, true), null)
  assert.equal(scanIsGuess('NAME', false), true)
  assert.equal(scanIsGuess('LEARNED', false), false)
  assert.equal(scanIsGuess('SMALL_PRINT', false), false)
})

test('a screen reader hears it in one go', () => {
  assert.equal(scanPanelSpoken('Forest', 'fin', '0306', 'common', 'Basic Land — Forest', 'en', false, '$0.40', false), 'Forest, FIN 306, basic land, English, $0.40')
  assert.equal(
    scanPanelSpoken('Sol Ring', 'c21', '263', 'uncommon', 'Artifact', 'ja', true, null, true),
    'Sol Ring, C21 263, uncommon, Japanese, foil, best guess, check the printing',
  )
  assert.equal(copiesInScan(3), '×3 in this scan')
})

test('the foil price for a foil copy', () => {
  assert.equal(panelPrice('0.40', '2.00', true), '2.00')
  assert.equal(panelPrice('0.40', '2.00', false), '0.40')
  assert.equal(panelPrice('0.40', null, true), '0.40')
  assert.equal(panelPrice(null, '2.00', false), '2.00')
})

test('the camera reading another printing is only taken on two reads running', () => {
  const watch = new HeldPrintingWatch()
  assert.equal(watch.see({ set: 'FIN', number: '307' }), null)
  assert.deepEqual(watch.see({ set: 'fin', number: '0307' }), { set: 'FIN', number: '307' })
  // A frame with nothing read doesn't break it; another printing starts again.
  assert.deepEqual(watch.see(null), { set: 'FIN', number: '307' })
  assert.equal(watch.see({ set: 'FIN', number: '308' }), null)
  assert.deepEqual(watch.see({ set: 'FIN', number: '308' }), { set: 'FIN', number: '308' })
  watch.reset()
  assert.equal(watch.see(null), null)
})

test('a mismatch is another printing, not leading zeros or case', () => {
  assert.equal(printingMismatch({ set: 'fin', number: '0306' }, { set: 'FIN', number: '306' }), null)
  assert.equal(printingMismatch({ set: 'fin', number: '306' }, null), null)
  assert.deepEqual(printingMismatch({ set: 'fin', number: '0306' }, { set: 'FIN', number: '307' }), { set: 'FIN', number: '307' })
  assert.deepEqual(printingMismatch({ set: 'fin', number: '306' }, { set: 'FIC', number: '306' }), { set: 'FIC', number: '306' })
  assert.deepEqual(printingMismatch(null, { set: 'FIN', number: '307' }), { set: 'FIN', number: '307' })
  assert.equal(cameraReadsLine({ set: 'FIN', number: '307' }), 'Camera reads FIN · 307')
  assert.equal(cameraButtonLabel({ set: 'fin', number: '307' }), 'Use FIN 307')
})

const entry = (id: string, name: string, quantity: number, foilQuantity = 0, places?: CopyPlace[]): CollectionEntry =>
  ({ scryfallId: id, name, imageUrl: null, quantity, foilQuantity, ...(places ? { places } : {}) })
const card = (scryfallId: string, name: string, quantity: number): DeckCardEntry =>
  ({ scryfallId, name, imageUrl: null, quantity, canBeCommander: false, typeLine: null, partnerAbility: null })

test('what you own: this printing first, then the others', () => {
  const collections: Collection[] = [
    {
      id: 'unsorted', name: 'Unsorted', createdAt: 0, type: 'OWNED', storagePlaces: [{ id: 'red', name: 'Red box', kind: 'BOX', createdAt: 1 }],
      entries: [entry('fin-306', 'Forest', 2, 0, [{ placeId: 'red', qty: 2 }]), entry('fin-307', 'Forest', 3), entry('bolt', 'Lightning Bolt', 4)],
    },
    { id: 'trade', name: 'Trade binder', createdAt: 1, type: 'OWNED', entries: [entry('fin-306', 'Forest', 0, 1)] },
    { id: 'wish', name: 'Wishlist', createdAt: 2, type: 'WISHLIST', entries: [entry('fin-306', 'Forest', 9)] },
  ]
  const decks = [
    normalizeDeck({ id: 'k', name: 'Krenko', ownership: 'PHYSICAL', cards: [card('fin-306', 'Forest', 1), card('m21-1', 'Forest', 1)] }),
    normalizeDeck({ id: 'v', name: 'Online', ownership: 'VIRTUAL', cards: [card('fin-306', 'Forest', 4)] }),
  ]
  const s = ownedSummary(collections, decks, 'fin-306', 'Forest')
  assert.deepEqual(s, { samePrinting: 4, otherPrintings: 4, places: [['Red box', 2], ['Trade binder', 1], ['Krenko deck', 1]] })
  assert.equal(ownedLine(s), 'You own 4 · 2 in Red box, 1 in Trade binder, … · +4 in other printings')
  assert.equal(ownedLine({ samePrinting: 1, otherPrintings: 0, places: [['Krenko deck', 1]] }), 'You own 1 · 1 in Krenko deck')
  assert.equal(ownedLine({ samePrinting: 0, otherPrintings: 3, places: [] }), 'None of this printing · +3 in other printings')
  assert.equal(ownedLine(ownedSummary(collections, decks, 'x', 'Sol Ring')), "You don't own this card yet")
})
