// The camera scanner's modes — one camera screen, four jobs: Add cards, Sort a pile, Put away, Check.
// The switch at the top of the scanner moves between them without stopping the camera. This is the
// logic of it, free of the page: which mode the scanner opens in from where it was opened, what Sort a
// pile starts with, and what happens to the cards already scanned when the mode changes; and the mode
// last picked and the one-time tips, kept in this browser (not synced). The Android app's
// ScannerModes.kt and ScannerModeSetting.kt, rule for rule.

import { BY_RULE } from '../collection/sortPiles'
import type { StoragePlace } from '../types/models'

/** What the camera scanner is doing. */
export type ScannerMode = 'add' | 'sort' | 'putAway' | 'check'

export const SCANNER_MODES: { mode: ScannerMode; label: string }[] = [
  { mode: 'add', label: 'Add cards' },
  { mode: 'sort', label: 'Sort a pile' },
  { mode: 'putAway', label: 'Put away' },
  { mode: 'check', label: 'Check' },
]

export const scannerModeOf = (key: string | null | undefined): ScannerMode | null =>
  SCANNER_MODES.find((m) => m.mode === key)?.mode ?? null

/**
 * Where the scanner was opened from: plain (the nav bar's Scan, Home, an empty state, the welcome
 * flow), Sort a new pile, a place's Put cards away or Check, a deck's list ticked off (a fixed job), or
 * Storage's Walk this list ticked off (the same fixed job).
 */
export type ScannerEntry = 'plain' | 'sort' | 'putAway' | 'check' | 'tick' | 'walk'

/** How the scanner opens: in [mode] (null: a fixed job of its own), and whether the mode switch shows. */
export interface ScannerStart { mode: ScannerMode | null; showSwitch: boolean }

/**
 * The mode the scanner opens in. The plain entry opens in the mode last picked on the switch in this
 * browser ([last]), Add cards the first time; every other entry opens in its own job, and doesn't
 * change what's remembered. Ticking a deck's list, or the walk list, is its own fixed job, with the
 * switch hidden.
 */
export function scannerStart(entry: ScannerEntry, last: ScannerMode | null): ScannerStart {
  switch (entry) {
    case 'plain': return { mode: last ?? 'add', showSwitch: true }
    case 'tick':
    case 'walk': return { mode: null, showSwitch: false }
    default: return { mode: entry, showSwitch: true }
  }
}

/**
 * The scanner's entry from its address: ?walk (unless putting away or checking, as ScanPage reads it),
 * ?pull / ?putBack, ?putAway, ?check, ?sort / ?recipe / ?mode=sort.
 */
export function entryOf(params: URLSearchParams): ScannerEntry {
  if (params.has('walk') && !params.has('putAway') && !params.has('check')) return 'walk'
  if (params.has('pull') || params.has('putBack')) return 'tick'
  if (params.has('putAway')) return 'putAway'
  if (params.has('check')) return 'check'
  if (params.has('sort') || params.has('recipe') || params.get('mode') === 'sort') return 'sort'
  return 'plain'
}

/**
 * What switching mode does with the Add cards list (the cards scanned but not added anywhere yet):
 * 'none' (it's empty), 'keep' (it stays as it is, there again on Add cards) or 'ask' ("Keep the N
 * scanned cards in the list?").
 */
export type CarryOver = 'none' | 'keep' | 'ask'

/**
 * Switching from [from] to [to] with [pending] cards in the Add cards list. The list is never thrown
 * away by a switch: Put away and Check are a quick job on the side, and Add cards is where the list
 * lives, so it simply stays. Sort a pile is different — it starts a new pile that's filed on its own,
 * and the cards in the list are easy to mistake for part of it — so leaving Add cards for Sort a pile
 * asks, once per visit to the scanner ([asked]).
 */
export function carryOver(from: ScannerMode | null, to: ScannerMode, pending: number, asked: boolean): CarryOver {
  if (pending <= 0) return 'none'
  if (from === 'add' && to === 'sort' && !asked) return 'ask'
  return 'keep'
}

/**
 * What Sort a pile shows on being picked: a sort with a recipe under way carries on ('resumeRecipe'),
 * else the classic sort under way ('resumeClassic'), else the recipe used last is offered — "By card
 * type · last used — Start · Change recipe" ('startLast') — else one is picked ('pick'). Only a sort
 * with cards in it counts as under way. [recipeScans] / [classicScans]: null when there's none kept.
 */
export type SortStart = 'resumeRecipe' | 'resumeClassic' | 'startLast' | 'pick'

export function sortStart(recipeScans: number | null, classicScans: number | null, hasLastRecipe: boolean): SortStart {
  if ((recipeScans ?? 0) > 0) return 'resumeRecipe'
  if ((classicScans ?? 0) > 0) return 'resumeClassic'
  return hasLastRecipe ? 'startLast' : 'pick'
}

/** Put away's "Let the app choose": offered once some box or deck box has a rule to go by. */
export const canLetAppChoose = (places: StoragePlace[]): boolean => places.some((p) => !!p.sortRule && p.kind !== 'BINDER')

/** The put-away target that means "the place whose rule fits each card" (bestPlaceByRule). */
export const PUT_AWAY_BY_RULE = BY_RULE

const LAST_KEY = 'mtgweb_scanner_mode'
const SORT_TIP_KEY = 'mtgweb_scanner_sort_tip_seen'

/** The mode last picked on the switch, in this browser. */
export function loadLastMode(): ScannerMode | null {
  try { return scannerModeOf(localStorage.getItem(LAST_KEY)) } catch { return null }
}

export function saveLastMode(mode: ScannerMode) {
  try { localStorage.setItem(LAST_KEY, mode) } catch { /* private mode: it just isn't kept */ }
}

/** Whether "New: sort a pile while you scan" has been seen (and so isn't shown again). */
export function sortTipSeen(): boolean {
  try { return localStorage.getItem(SORT_TIP_KEY) === '1' } catch { return false }
}

export function dismissSortTip() {
  try { localStorage.setItem(SORT_TIP_KEY, '1') } catch { /* this visit only */ }
}

/** Settings › Scanner › Show tips again. */
export function resetScannerTips() {
  try { localStorage.removeItem(SORT_TIP_KEY) } catch { /* nothing kept */ }
}
