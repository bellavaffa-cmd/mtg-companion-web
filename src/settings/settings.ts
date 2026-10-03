// The settings as the page uses them: read from and written to this browser's storage, applied to
// the document (light or dark tokens, the accent's --gold family), and watched by the screens that
// use them. The rules themselves are in ./appearance.

import { useSyncExternalStore } from 'react'
import {
  accentVars, isDark, KEYS, parseAccent, parseBrightness, parseGridColumns, parseViewMode, THEME_COLOR,
  type AccentTheme, type AppBrightness, type CardViewMode, type CardViewSurface,
} from './appearance'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* this visit only */ }
  memory.set(key, value)
  version++
  for (const l of listeners) l()
}

// What was set this visit, for a browser that won't store it.
const memory = new Map<string, string>()
const get = (key: string) => read(key) ?? memory.get(key) ?? null

const listeners = new Set<() => void>()
let version = 0
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

/** Puts the chosen brightness and accent on the page. Called before the first render, and on change. */
export function applyAppearance() {
  const root = document.documentElement
  const dark = isDark(parseBrightness(get(KEYS.brightness)), darkQuery?.matches ?? true)
  root.dataset.theme = dark ? 'dark' : 'light'
  for (const [name, value] of Object.entries(accentVars(parseAccent(get(KEYS.accent)), dark))) root.style.setProperty(name, value)
  root.style.setProperty('--grid-columns', String(parseGridColumns(get(KEYS.gridColumns))))
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light)
}

/** Follow the device's dark mode while the setting is System. */
export function watchSystemTheme() {
  darkQuery?.addEventListener?.('change', () => {
    applyAppearance()
    version++
    for (const l of listeners) l()
  })
  // Another tab changed a setting.
  window.addEventListener('storage', () => {
    applyAppearance()
    version++
    for (const l of listeners) l()
  })
}

function useVersion() {
  return useSyncExternalStore(subscribe, () => version)
}

export function useAppearance() {
  useVersion()
  return {
    brightness: parseBrightness(get(KEYS.brightness)),
    accent: parseAccent(get(KEYS.accent)),
    gridColumns: parseGridColumns(get(KEYS.gridColumns)),
    setBrightness: (b: AppBrightness) => { write(KEYS.brightness, b); applyAppearance() },
    setAccent: (a: AccentTheme) => { write(KEYS.accent, a); applyAppearance() },
    setGridColumns: (n: number) => { write(KEYS.gridColumns, String(parseGridColumns(String(n)))); applyAppearance() },
  }
}

export function cardViewMode(surface: CardViewSurface): CardViewMode {
  return parseViewMode(get(KEYS.view[surface]))
}

export function setCardViewMode(surface: CardViewSurface, mode: CardViewMode) {
  write(KEYS.view[surface], mode)
}

/**
 * A screen's list/grid choice: the Settings default, which the screen's own toggle also changes —
 * as before, the toggle's last choice is what the screen opens with next time.
 */
export function useCardViewMode(surface: CardViewSurface): [CardViewMode, (m: CardViewMode) => void] {
  useVersion()
  return [cardViewMode(surface), (m) => setCardViewMode(surface, m)]
}
