// Settings › Data and speed: how big the collection is, how much of its card data is kept for offline,
// how long All cards took to open the last time and when it last synced — and the backup. The words
// for each, kept apart from the page so both apps say the same (the Android app's DataAndSpeed.kt).

import { timeAgo } from '../social/moreLogic'
import { secondsLabel, type OpenTiming } from './perfStats'

const n = (x: number) => x.toLocaleString('en-GB')

/** "18,402 of 18,402" — printings with their card data kept, of the printings owned. */
export const offlineLabel = (saved: number, total: number): string => `${n(saved)} of ${n(total)}`

/** "0.4 s", or "Not opened yet". */
export const openLabel = (timing: OpenTiming | null): string => (timing ? secondsLabel(timing.ms) : 'Not opened yet')

/** "2 min ago", "Just now", "Not yet", or "Not signed in". */
export function lastSyncedLabel(signedIn: boolean, lastSyncedAt: number, now: number): string {
  if (!signedIn) return 'Not signed in'
  if (lastSyncedAt <= 0) return 'Not yet'
  const ago = timeAgo(lastSyncedAt, now)
  return ago.charAt(0).toUpperCase() + ago.slice(1)
}

/** Opening All cards counts as quick under this: the time shows green. */
export const QUICK_OPEN_MS = 1000

export const BACKUP_NOTE = 'Everything, including places, loans, history and photos, in one file you keep.'

/**
 * This browser's settings worth keeping in a backup (as they're stored, under these keys): appearance,
 * card display, prices, saved filters, deck page choices, the life counter's, the value over time,
 * bags being packed, events and table games, and the scanner's sounds. Sign-in, sync bookkeeping and caches are left out — they
 * belong to this browser, or come back by themselves.
 */
export const BACKUP_SETTINGS_KEYS = [
  'mtgweb_currency', 'mtgweb_app_brightness', 'mtgweb_accent_theme', 'mtgweb_grid_columns',
  'mtgweb_binder_cards_view', 'mtgweb_deck_cards_view', 'mtgweb_all_cards_view', 'mtgweb_search_cards_view',
  'mtgweb_saved_filters', 'mtgweb_deck_grouping', 'mtgweb_deck_folders_folded', 'mtgweb_stats_panels',
  'mtgweb_role_tag_sets', 'mtgweb_life_settings', 'mtgweb_usage_off', 'mtgweb_value_history', 'mtgweb_deck_value_history',
  'mtgweb_packing_bags', 'mtgweb_last_import', 'mtgweb_tournaments', 'mtgweb_table_games',
  'mtgweb_scan_sound_on', 'mtgweb_scan_sound_volume', 'mtgweb_scan_sound_mode', 'mtgweb_scan_sound_threshold',
  'mtgweb_scan_vibrate', 'mtgweb_scan_sound_silent',
] as const
