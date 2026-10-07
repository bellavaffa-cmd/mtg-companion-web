// How long All cards took to open the last time, for Settings › Data and speed: measured from the tab
// starting to draw until its list was on the page, kept in this browser. The Android app keeps the
// same on the phone (data/DataAndSpeed.kt).

const KEY = 'mtgweb_all_cards_open'

export interface OpenTiming {
  /** Milliseconds. */
  ms: number
  /** How many cards (printings) it listed. */
  cards: number
  at: number
}

export function noteAllCardsOpened(ms: number, cards: number) {
  try { localStorage.setItem(KEY, JSON.stringify({ ms: Math.round(ms), cards, at: Date.now() })) } catch { /* not kept */ }
}

export function lastAllCardsOpen(): OpenTiming | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<OpenTiming> | null
    return raw && typeof raw.ms === 'number' && typeof raw.cards === 'number' && typeof raw.at === 'number' ? (raw as OpenTiming) : null
  } catch {
    return null
  }
}

/** "0.4 s", "0.05 s", "1.2 s" — the way Data and speed shows a time. */
export function secondsLabel(ms: number): string {
  if (ms < 10) return '0.01 s'
  if (ms < 1000) return `${(ms / 1000).toFixed(ms < 100 ? 2 : 1).replace(/0$/, '').replace(/\.$/, '')} s`
  return `${(ms / 1000).toFixed(1)} s`
}
