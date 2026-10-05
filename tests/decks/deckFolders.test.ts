import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeDecks, deckSections, folderNames, folderOf, renamedFolder, tidyFolder, withArchived, withFolder, withoutFolder } from '../../src/decks/deckFolders.ts'
import { normalizeDeck, type Deck } from '../../src/types/models.ts'

// Folders and the Archived section on the decks list. The Android app runs the same cases — see
// DeckFoldersTest.kt.

const deck = (id: string, more: Partial<Deck> = {}) => normalizeDeck({ id, name: id, ...more })

test('putting a deck in a folder and taking it out', () => {
  const d = withFolder(deck('a'), '  Modern   decks ')
  assert.equal(d.folder, 'Modern decks')
  assert.equal(folderOf(d), 'Modern decks')
  const out = withFolder(d, null)
  assert.equal(out.folder, '')
  assert.equal(folderOf(out), null)
  assert.equal(withFolder(deck('b'), '').folder, undefined)
  assert.equal(tidyFolder('x'.repeat(60)).length, 40)
})

test('archiving keeps the flag once set', () => {
  const a = withArchived(deck('a'), true)
  assert.equal(a.archived, true)
  assert.equal(withArchived(a, false).archived, false)
  assert.equal(withArchived(deck('b'), false).archived, undefined)
  assert.deepEqual(activeDecks([a, deck('b')]).map((d) => d.id), ['b'])
})

test('the list: folders A–Z, loose decks, archived apart', () => {
  const decks = [
    deck('a', { folder: 'modern' }), deck('b'), deck('c', { folder: 'Cube' }), deck('d', { folder: 'Modern' }),
    deck('e', { folder: 'Old', archived: true }), deck('f', { folder: '' }),
  ]
  assert.deepEqual(folderNames(decks), ['Cube', 'modern'])
  const s = deckSections(decks)
  assert.deepEqual(s.folders.map((f) => [f.name, f.decks.map((d) => d.id)]), [['Cube', ['c']], ['modern', ['a', 'd']]])
  assert.deepEqual(s.loose.map((d) => d.id), ['b', 'f'])
  assert.deepEqual(s.archived.map((d) => d.id), ['e'])
})

test('renaming and deleting a folder rewrites its decks, archived ones too', () => {
  const decks = [deck('a', { folder: 'Modern' }), deck('b', { folder: 'modern', archived: true }), deck('c', { folder: 'Cube' })]
  assert.deepEqual(renamedFolder(decks, 'MODERN', 'Pioneer').map((d) => d.folder), ['Pioneer', 'Pioneer', 'Cube'])
  assert.deepEqual(withoutFolder(decks, 'Modern').map((d) => d.folder), ['', '', 'Cube'])
})
