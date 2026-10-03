import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comboSearchQuery } from '../../src/search/comboSearch.ts'

// The Search page's Combos mode builds Commander Spellbook's query as the phone does.

test('each filter adds its part; empty filters ask nothing', () => {
  assert.equal(comboSearchQuery('', '  ', []), '')
  assert.equal(comboSearchQuery(' Thassa’s Oracle ', '', []), 'card:"Thassa’s Oracle"')
  assert.equal(comboSearchQuery('', 'infinite mana', []), 'result:"infinite mana"')
  assert.equal(comboSearchQuery('Dramatic "Reversal"', 'infinite mana', new Set(['U', 'B', 'G'])), 'card:"Dramatic Reversal" result:"infinite mana" ci<=BGU')
})
