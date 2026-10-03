import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendPage } from '../../src/search/pages.ts'

const card = (id: string) => ({ id })

test('the next page goes under the results already showing', () => {
  assert.deepEqual(appendPage([card('a'), card('b')], [card('c')]).map((c) => c.id), ['a', 'b', 'c'])
})

test("a card that moved across the page boundary isn't shown twice", () => {
  assert.deepEqual(appendPage([card('a'), card('b')], [card('b'), card('c')]).map((c) => c.id), ['a', 'b', 'c'])
})
