// A deck's version history: its list saved each time it changes, one version per sitting, with what
// changed between versions and the games played on each. Same JSON shape, session length and cap as
// the Android app (DeckVersion in data/DeckModels.kt, DeckRepository.withVersion, versionSummaries in
// data/DeckBuilding.kt), so either app can read and add to the other's history.

import type { Deck, DeckVersion } from '../types/models'

/** Edits closer together than this belong to the same sitting, and share one version. */
export const SESSION_MS = 30 * 60 * 1000
/** Versions kept per deck, oldest dropped first (mergeItems.ts caps a sync's merge the same). */
export const MAX_VERSIONS = 40
/** A version holding the list from before versions were kept — never folded into. */
export const BASELINE_PREFIX = 'baseline:'

/** The deck's list as a version: card name -> copies (commanders included), and its commanders. */
export function snapshotOf(deck: Deck): { cards: Record<string, number>; commanders: string[] } {
  const cards: Record<string, number> = {}
  for (const c of deck.cards) cards[c.name] = (cards[c.name] ?? 0) + c.quantity
  return { cards, commanders: [deck.commander?.name, deck.partnerCommander?.name].filter((n): n is string => !!n) }
}

function sameCards(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a)
  return ak.length === Object.keys(b).length && ak.every((k) => a[k] === b[k])
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * [after] with its list recorded as a version when it differs from [before]'s — changes to tags,
 * flags, the Considering list or a card's printing don't count. Edits within one sitting replace
 * that sitting's version rather than piling up one per tap. A deck edited for the first time since
 * versions existed gets its prior list saved first, so there's a "before" to compare against.
 */
export function withVersion(before: Deck | undefined, after: Deck, now = Date.now(), newId: () => string = () => crypto.randomUUID()): Deck {
  const snapshot = snapshotOf(after)
  const previous = before ? snapshotOf(before) : null
  if (previous && sameCards(previous.cards, snapshot.cards) && sameList(previous.commanders, snapshot.commanders)) return after
  const existing = after.versions ?? []
  if (Object.keys(snapshot.cards).length === 0 && existing.length === 0) return after

  let versions = existing
  if (versions.length === 0 && previous && Object.keys(previous.cards).length > 0) {
    versions = [{ id: BASELINE_PREFIX + newId(), savedAt: now - 1, ...previous }]
  }
  // A whole list arriving at once into an empty deck — a precon or decklist import — is the starting
  // list too, or the first tweak minutes later would fold into it and lose it. One card at a time
  // (building from scratch) isn't one.
  const importedFromNothing = (!previous || Object.keys(previous.cards).length === 0) && Object.keys(snapshot.cards).length > 1
  if (versions.length === 0 && importedFromNothing) {
    return { ...after, versions: [{ id: BASELINE_PREFIX + newId(), savedAt: now, ...snapshot }] }
  }
  const last = versions[versions.length - 1]
  // Never fold into a baseline, nor into a version a game was logged on: moving its time past the
  // game would credit the game to the version before.
  const sameSitting = !!last &&
    !last.id.startsWith(BASELINE_PREFIX) &&
    now - last.savedAt < SESSION_MS &&
    !after.gameResults.some((g) => g.playedAt >= last.savedAt)
  versions = sameSitting
    ? [...versions.slice(0, -1), { id: last.id, savedAt: now, ...snapshot }]
    : [...versions, { id: newId(), savedAt: now, ...snapshot }]
  return { ...after, versions: versions.slice(-MAX_VERSIONS) }
}

/** One version, what changed since the one before it, and the games played while it was current. */
export interface VersionSummary {
  version: DeckVersion
  added: [string, number][]
  removed: [string, number][]
  isBaseline: boolean
  wins: number
  losses: number
  draws: number
  games: number
}

/** Newest first. A game counts for the version current when it was played, up to the next one. */
export function versionSummaries(deck: Deck): VersionSummary[] {
  const versions = [...(deck.versions ?? [])].sort((a, b) => a.savedAt - b.savedAt)
  return versions.map((version, i) => {
    const previous = versions[i - 1]
    const next = versions[i + 1]
    const added: [string, number][] = []
    const removed: [string, number][] = []
    if (previous) {
      for (const name of new Set([...Object.keys(version.cards), ...Object.keys(previous.cards)])) {
        const delta = (version.cards[name] ?? 0) - (previous.cards[name] ?? 0)
        if (delta > 0) added.push([name, delta])
        if (delta < 0) removed.push([name, -delta])
      }
    }
    const byName = (a: [string, number], b: [string, number]) => a[0].localeCompare(b[0])
    const games = deck.gameResults.filter((g) => g.playedAt >= version.savedAt && (!next || g.playedAt < next.savedAt))
    const wins = games.filter((g) => g.result === 'WIN').length
    const losses = games.filter((g) => g.result === 'LOSS').length
    const draws = games.filter((g) => g.result === 'DRAW').length
    return { version, added: added.sort(byName), removed: removed.sort(byName), isBaseline: !previous, wins, losses, draws, games: wins + losses + draws }
  }).reverse()
}

/** "+3  −2", or "Commander changed" when only the commander did; the starting list says so. */
export function changeSummary(s: VersionSummary): string {
  if (s.isBaseline || s.version.id.startsWith(BASELINE_PREFIX)) {
    return `Starting list · ${Object.values(s.version.cards).reduce((a, b) => a + b, 0)} cards`
  }
  const added = s.added.reduce((n, [, q]) => n + q, 0)
  const removed = s.removed.reduce((n, [, q]) => n + q, 0)
  if (added === 0 && removed === 0) return 'Commander changed'
  return [added > 0 ? `+${added}` : null, removed > 0 ? `−${removed}` : null].filter(Boolean).join('  ')
}

/** "3-1" or "3-1-1" with draws. */
export const recordText = (s: { wins: number; losses: number; draws: number }) => `${s.wins}-${s.losses}${s.draws > 0 ? `-${s.draws}` : ''}`

/** "3 Oct 2026, 14:05", as the phone writes a version's time. */
export const versionDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
