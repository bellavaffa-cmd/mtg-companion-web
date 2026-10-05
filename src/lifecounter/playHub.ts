// The Play tab's short status lines: the start card's table, and one line under each of Game night,
// Playgroup and Events. Pure, so the wording is tested. The Android app's twin is
// ui/lifecounter/PlayHub.kt (tests: PlayHubTest.kt / tests/lifecounter/playHub.test.ts).

/** How many recent games the Play tab lists before "All games". */
export const RECENT_SHOWN = 5

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "4 players · 40 life" — the table a new game starts with. */
export const startGameLine = (players: number, life: number) => `${plural(players, 'player')} · ${life} life`

/** "Last game: Sam, Alex and Jo", "Last game: Sam, Alex and 2 more"; null with nobody to name. */
export function lastPlayersLine(names: string[]): string | null {
  const shown = names.map((n) => n.trim()).filter(Boolean)
  if (shown.length === 0) return null
  if (shown.length === 1) return `Last game: ${shown[0]}`
  if (shown.length <= 3) return `Last game: ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  return `Last game: ${shown.slice(0, 2).join(', ')} and ${shown.length - 2} more`
}

/**
 * Game night's line: tonight's players and pods, the last night's players once it's gone stale
 * ([stale]: older than a night), or what it does when nobody's been added.
 */
export function gameNightStatus(players: number, pods: number, stale: boolean): string {
  if (players === 0) return 'Fair pods by power'
  if (stale) return `Last time: ${plural(players, 'player')}`
  return `Tonight: ${plural(players, 'player')}${pods > 0 ? ` · ${plural(pods, 'pod')}` : ''}`
}

/** Playgroup's line: "12 games · nemesis Sam", "3 games", or "No games yet". */
export function playgroupStatus(games: number, nemesis: string | null): string {
  if (games === 0) return 'No games yet'
  return `${plural(games, 'game')}${nemesis ? ` · nemesis ${nemesis}` : ''}`
}

/** Events' line: "1 event running", "3 events", or what it does when there are none. */
export function eventsStatus(running: number, total: number): string {
  if (running > 0) return `${plural(running, 'event')} running`
  if (total > 0) return plural(total, 'event')
  return 'Swiss or Commander pods'
}
