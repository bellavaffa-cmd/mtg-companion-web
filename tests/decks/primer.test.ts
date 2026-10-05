import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_DESCRIPTION, parsePrimer, parseSpans, primerCardNames, primerComments, tidyDescription } from '../../src/decks/primer.ts'

// A deck's primer: its blocks, its spans and links, and what an export makes of it. The Android app
// runs the same cases — see PrimerTest.kt.

const t = (text: string, more: Partial<{ bold: boolean; italic: boolean; card: string; url: string }> = {}) =>
  ({ text, bold: false, italic: false, card: null, url: null, ...more })

test('headings, lists and paragraphs', () => {
  const blocks = parsePrimer('# Plan\nRamp early.\nThen win.\n\n- [[Sol Ring]]\n- Arcane Signet\n1. Mulligan\n2) Keep\n\n### Notes\nDone')
  assert.deepEqual(blocks, [
    { kind: 'heading', level: 1, spans: [t('Plan')] },
    { kind: 'paragraph', spans: [t('Ramp early.\nThen win.')] },
    { kind: 'list', ordered: false, items: [[t('Sol Ring', { card: 'Sol Ring' })], [t('Arcane Signet')]] },
    { kind: 'list', ordered: true, items: [[t('Mulligan')], [t('Keep')]] },
    { kind: 'heading', level: 3, spans: [t('Notes')] },
    { kind: 'paragraph', spans: [t('Done')] },
  ])
})

test('bold, italic, card links and web links', () => {
  assert.deepEqual(parseSpans('Cast **[[Craterhoof Behemoth]] last** and *win*'), [
    t('Cast '),
    t('Craterhoof Behemoth', { bold: true, card: 'Craterhoof Behemoth' }),
    t(' last', { bold: true }),
    t(' and '),
    t('win', { italic: true }),
  ])
  assert.deepEqual(parseSpans('See [the guide](https://example.com/a) or https://edhrec.com/x.'), [
    t('See '),
    t('the guide', { url: 'https://example.com/a' }),
    t(' or '),
    t('https://edhrec.com/x', { url: 'https://edhrec.com/x' }),
    t('.'),
  ])
})

test('markers without a partner, and anything that is not a web address, stay text', () => {
  assert.deepEqual(parseSpans('2 * 3 = 6, snake_case_name, **open'), [t('2 * 3 = 6, snake_case_name, **open')])
  assert.deepEqual(parseSpans('[click](javascript:alert(1)) <b>hi</b>'), [t('[click](javascript:alert(1)) <b>hi</b>')])
  assert.deepEqual(parseSpans('[[ ]] and [[unclosed'), [t('[[ ]] and [[unclosed')])
  assert.deepEqual(parseSpans('_quiet_ words'), [t('quiet', { italic: true }), t(' words')])
})

test('the cards a primer names, each once', () => {
  assert.deepEqual(primerCardNames('[[Sol Ring]] then [[sol ring]]\n- [[Mana Crypt]]'), ['Sol Ring', 'Mana Crypt'])
})

test('kept tidy and capped', () => {
  assert.equal(tidyDescription('  a\r\nb \r\n'), 'a\nb')
  assert.equal(tidyDescription('x'.repeat(MAX_DESCRIPTION + 10)).length, MAX_DESCRIPTION)
})

test('as comments for an export', () => {
  assert.deepEqual(primerComments('# Plan\n\nGo wide'), ['// # Plan', '//', '// Go wide'])
  assert.deepEqual(primerComments(undefined), [])
  assert.deepEqual(primerComments('  '), [])
})
