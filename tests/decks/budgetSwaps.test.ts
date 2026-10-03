import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budgetCandidates, budgetRoleOf, budgetSwapQuery, freshAlternatives, swapIdentity } from '../../src/decks/budgetSwaps.ts'
import type { DeckCardEntry } from '../../src/types/models.ts'

// Budget swaps, searched the way the phone searches them (DeckDetailViewModel.findBudgetSwaps).

const e = (name: string, typeLine = 'Artifact') => ({ scryfallId: name, name, imageUrl: null, quantity: 1, canBeCommander: false, typeLine, partnerAbility: null }) as DeckCardEntry

test('the priciest non-land, non-commander cards over the threshold, at most eight', () => {
  const prices: Record<string, number> = { A: 3, B: 50, Land: 80, Cmd: 99, C: 1.99 }
  const cards = [e('A'), e('B'), e('Land', 'Land'), e('Cmd', 'Legendary Creature'), e('C')]
  const picked = budgetCandidates(cards, (id) => prices[id] ?? null, new Set(['Cmd']), 2)
  assert.deepEqual(picked.map((p) => [p.entry.name, p.price]), [['B', 50], ['A', 3]])
  const many = Array.from({ length: 12 }, (_, i) => e(`X${i}`))
  assert.equal(budgetCandidates(many, () => 10, new Set(), 2).length, 8)
})

test('a role searches its otag; no role searches the type around its mana value', () => {
  assert.equal(
    budgetSwapQuery({ name: 'Mana Crypt', price: 150, role: budgetRoleOf(['mana-rock', 'ramp']), typeLine: 'Artifact', cmc: 0, identity: 'wub', format: 'COMMANDER' }),
    'otag:ramp id<=wub usd<60.00 f:commander -!"Mana Crypt"',
  )
  assert.equal(
    budgetSwapQuery({ name: 'Doubling "Season"', price: 0.5, role: null, typeLine: 'Legendary Enchantment Creature', cmc: 5, identity: '', format: 'BRAWL' }),
    't:creature mv>=4 mv<=6 id<=c usd<0.25 f:brawl -!"Doubling Season"',
  )
  // Ramp is matched before removal, as on the phone.
  assert.equal(budgetRoleOf(['removal', 'ramp'])?.otag, 'ramp')
  assert.equal(budgetRoleOf(['tutor']), null)
})

test('the colours searched within, and the alternatives offered', () => {
  assert.equal(swapIdentity([['U', 'W'], ['B']], [['G']]), 'wub')
  assert.equal(swapIdentity([], [['G'], ['R']]), 'rg')
  assert.equal(swapIdentity([], []), 'c')
  const found = ['Arcane Signet', 'Fellwar Stone', 'Mind Stone', 'Thought Vessel', 'Talisman of Dominance', 'Wayfarer’s Bauble'].map((name) => ({ name }))
  assert.deepEqual(freshAlternatives(found, ['Mind Stone']).map((c) => c.name), ['Arcane Signet', 'Fellwar Stone', 'Thought Vessel', 'Talisman of Dominance'])
})
