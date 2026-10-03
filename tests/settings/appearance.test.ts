import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCENT_THEMES, accentVars, contrast, isDark, KEYS, parseGridColumns, parseViewMode, readAppearance,
} from '../../src/settings/appearance.ts'

// Settings → Appearance and Card Display, as the Android app's SettingsRepository and Color.kt.

const store = (m: Record<string, string>) => (k: string) => m[k] ?? null

test('nothing chosen yet: dark and gold, as the app starts', () => {
  assert.deepEqual(readAppearance(store({})), { brightness: 'DARK', accent: 'GOLD' })
})

test('an unknown stored value falls back to the default', () => {
  assert.deepEqual(readAppearance(store({ [KEYS.brightness]: 'dim', [KEYS.accent]: 'TEAL' })), { brightness: 'DARK', accent: 'GOLD' })
  assert.deepEqual(readAppearance(store({ [KEYS.brightness]: 'LIGHT', [KEYS.accent]: 'RUBY' })), { brightness: 'LIGHT', accent: 'RUBY' })
})

test('System follows the device', () => {
  assert.equal(isDark('SYSTEM', true), true)
  assert.equal(isDark('SYSTEM', false), false)
  assert.equal(isDark('LIGHT', true), false)
  assert.equal(isDark('DARK', false), true)
})

test('the five accents, in the app\'s order', () => {
  assert.deepEqual(ACCENT_THEMES.map((a) => a.label), ['Gold', 'Sapphire', 'Amethyst', 'Ruby', 'Emerald'])
})

test('gold carries dark ink in the dark; the cooler accents white', () => {
  assert.equal(accentVars('GOLD', true)['--gold-ink'], '#1c1405')
  assert.equal(accentVars('SAPPHIRE', true)['--gold-ink'], '#ffffff')
  assert.equal(accentVars('GOLD', false)['--gold-ink'], '#ffffff')
})

test('in the light every accent keeps 4.5:1 on white, and its ink on it', () => {
  for (const { id } of ACCENT_THEMES) {
    const gold = accentVars(id, false)['--gold']
    assert.ok(contrast(gold, '#ffffff') >= 4.5, `${id} ${gold} on white: ${contrast(gold, '#ffffff').toFixed(2)}`)
  }
})

test('the light palette\'s text reads on its grounds', () => {
  for (const ground of ['#f4f4f7', '#ffffff']) {
    assert.ok(contrast('#15161b', ground) >= 7)
    assert.ok(contrast('#555a66', ground) >= 4.5)
    assert.ok(contrast('#62666f', ground) >= 4.5, `dim on ${ground}: ${contrast('#62666f', ground).toFixed(2)}`)
  }
})

test('grid columns stay between 3 and 10, 3 by default', () => {
  assert.equal(parseGridColumns(null), 3)
  assert.equal(parseGridColumns('nope'), 3)
  assert.equal(parseGridColumns('1'), 3)
  assert.equal(parseGridColumns('6'), 6)
  assert.equal(parseGridColumns('40'), 10)
})

test('list or grid, read from what the toggles always stored', () => {
  assert.equal(parseViewMode(null), 'list')
  assert.equal(parseViewMode('grid'), 'grid')
  assert.equal(parseViewMode('GRID'), 'grid')
  assert.equal(KEYS.view.allCards, 'mtgweb_all_cards_view')
  assert.equal(KEYS.view.deck, 'mtgweb_deck_cards_view')
})
