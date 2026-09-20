import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routerPath } from '../../src/components/useLeaveGuard.ts'

// Where a tapped link would take you, as this app's router sees it — the app lives under a base
// path, and anything off-site is the browser's business.

test('a link inside the app becomes a path the router understands', () => {
  ;(globalThis as { window?: unknown }).window = { location: new URL('https://example.test/mtg-companion-web/scan') }
  assert.equal(routerPath('https://example.test/mtg-companion-web/decks', '/mtg-companion-web/'), '/decks')
  assert.equal(routerPath('https://example.test/mtg-companion-web/collections?tab=binders', '/mtg-companion-web/'), '/collections?tab=binders')
  assert.equal(routerPath('https://example.test/mtg-companion-web/', '/mtg-companion-web/'), '/')
  // Served from the root, there's no base path to take off.
  assert.equal(routerPath('https://example.test/decks', '/'), '/decks')
  // Somewhere else entirely: not ours to route.
  assert.equal(routerPath('https://tcgplayer.test/search', '/mtg-companion-web/'), null)
})
