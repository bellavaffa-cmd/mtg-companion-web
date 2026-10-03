/**
 * Which panels on a deck's Stats are open — the Android app's StatsPanels. Each panel has a short id
 * ("curve", "roles"…); only the ones the user has opened or closed are stored, so a panel added
 * later starts in its default state. Remembered in this browser, for every deck.
 */
export const STATS_PANELS_KEY = 'mtgweb_stats_panels'

/** Open until the user closes them: the summary strip, the mana curve and the deck's roles. */
export const DEFAULT_OPEN: ReadonlySet<string> = new Set(['summary', 'curve', 'roles'])

export type PanelState = Record<string, boolean>

export const isPanelOpen = (id: string, stored: PanelState): boolean => stored[id] ?? DEFAULT_OPEN.has(id)

/** The stored state, from its JSON; anything unreadable is dropped. */
export function decodePanels(raw: string | null): PanelState {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
  } catch {
    return {}
  }
}

export function loadPanels(): PanelState {
  try { return decodePanels(localStorage.getItem(STATS_PANELS_KEY)) } catch { return {} }
}

export function savePanels(state: PanelState) {
  try { localStorage.setItem(STATS_PANELS_KEY, JSON.stringify(state)) } catch { /* this visit only */ }
}
