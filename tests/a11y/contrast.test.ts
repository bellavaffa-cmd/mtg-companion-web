// WCAG AA contrast for the theme's colour tokens: reads the dark (:root) and light
// (:root[data-theme='light']) sets from src/theme.css, lays each accent's --gold family over them
// (src/settings/appearance.ts), and checks every pair the app draws text or icons with. The Android
// colours (ui/theme/Color.kt) carry the same values; ColorContrastTest.kt checks them there.
//
// A failure names the pair and its ratio: fix the token, not the one place it shows.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ACCENT_THEMES, accentVars, contrast } from '../../src/settings/appearance.ts'

const css = readFileSync(new URL('../../src/theme.css', import.meta.url), 'utf8')

/** The hex custom properties declared in the first block opened by [selector]. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `no ${selector} block in theme.css`)
  const body = css.slice(start, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s*;/g)) {
    const hex = m[2].length === 4 ? `#${[...m[2].slice(1)].map((c) => c + c).join('')}` : m[2]
    out[m[1]] = hex.toLowerCase()
  }
  return out
}

const DARK = tokens(':root')
const LIGHT = { ...DARK, ...tokens(":root[data-theme='light']") }

const GROUNDS = ['--g0', '--g1', '--g2']
/** Raised controls and chips: the main text must still read on it, quieter marks need 3:1. */
const RAISED = '--g3'

interface Pair { fg: string; bg: string; min: number; what: string }

const PAIRS: Pair[] = [
  // Body text on the ground, cards and raised grey.
  ...['--t0', '--t1', '--t2', '--gold', '--ok', '--warn', '--error', '--cut'].flatMap((fg) =>
    GROUNDS.map((bg) => ({ fg, bg, min: 4.5, what: 'text' }))),
  { fg: '--t0', bg: RAISED, min: 4.5, what: 'text' },
  { fg: '--t1', bg: RAISED, min: 4.5, what: 'text' },
  // Icons, borders of controls and large figures on raised grey.
  ...['--t2', '--gold', '--ok', '--warn', '--error', '--cut'].map((fg) => ({ fg, bg: RAISED, min: 3, what: 'icon' })),
  // Text on filled buttons, badges and the selected chip.
  { fg: '--gold-ink', bg: '--gold', min: 4.5, what: 'text on fill' },
  { fg: '--cut-ink', bg: '--cut', min: 4.5, what: 'text on fill' },
  { fg: '--g0', bg: '--t0', min: 4.5, what: 'selected chip' },
  // The focus ring, against what it sits on.
  ...GROUNDS.map((bg) => ({ fg: '--gold', bg, min: 3, what: 'focus ring' })),
]

function check(theme: 'dark' | 'light') {
  const failures: string[] = []
  for (const { id } of ACCENT_THEMES) {
    const t: Record<string, string> = { ...(theme === 'dark' ? DARK : LIGHT), ...accentVars(id, theme === 'dark') }
    for (const p of PAIRS) {
      const fg = t[p.fg]
      const bg = t[p.bg]
      assert.ok(fg && bg, `${theme}: ${p.fg} or ${p.bg} is not a plain colour`)
      const ratio = contrast(fg, bg)
      if (ratio < p.min) failures.push(`${theme} ${id}: ${p.fg} ${fg} on ${p.bg} ${bg} (${p.what}) is ${ratio.toFixed(2)}:1, needs ${p.min}:1`)
    }
  }
  assert.deepEqual(failures, [])
}

test('dark theme: every text and icon pair meets WCAG AA, for every accent', () => check('dark'))
test('light theme: every text and icon pair meets WCAG AA, for every accent', () => check('light'))

test('the token sets are read from theme.css', () => {
  for (const name of ['--g0', '--g1', '--g2', '--g3', '--t0', '--t1', '--t2', '--ok', '--warn', '--error', '--cut', '--cut-ink', '--gold-ink']) {
    assert.match(DARK[name] ?? '', /^#[0-9a-f]{6}$/, `dark ${name}`)
    assert.match(LIGHT[name] ?? '', /^#[0-9a-f]{6}$/, `light ${name}`)
  }
})
