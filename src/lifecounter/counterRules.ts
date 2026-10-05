// The counters with rules of their own: rad (no limit), speed (0 to 4) and the Ring tempting you
// (levels 1 to 4, each adding an ability to your Ring-bearer, who has a name). Pure. Mirrors the
// Android app's ui/lifecounter/CounterRules.kt.
//
// Speed (Aetherdrift): it starts at 0 and goes up by 1 at most once each turn, when an opponent loses
// life during your turn; it never goes above 4, and 4 is "max speed". The app keeps it as a counter
// that stops at 4 — the once-a-turn rule is the players' to keep.

/** The highest a counter can go, for those that stop somewhere. */
export const COUNTER_MAX: Record<string, number> = { speed: 4, ring: 4 }

/** [value] kept within what counter [kind] allows: never below 0, and at most its maximum. */
export function clampCounter(kind: string, value: number): number {
  const max = COUNTER_MAX[kind]
  return Math.max(0, max === undefined ? value : Math.min(max, value))
}

export const MAX_SPEED = 4
export const isMaxSpeed = (speed: number) => speed >= MAX_SPEED

/** What the Ring gives its bearer at each level, in order: level n has the first n. */
export const RING_ABILITIES = [
  "Legendary, and can't be blocked by creatures with greater power.",
  'Whenever it attacks, draw a card, then discard a card.',
  "Whenever it becomes blocked by a creature, that creature's controller sacrifices it at end of combat.",
  'Whenever it deals combat damage to a player, each opponent loses 3 life.',
]

/** The Ring's abilities a player has after it has tempted them [level] times. */
export const ringAbilities = (level: number) => RING_ABILITIES.slice(0, Math.max(0, Math.min(RING_ABILITIES.length, level)))

/** A Ring-bearer's name as typed: trimmed and at most 60 characters; blank is nobody. */
export function cleanRingBearer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().slice(0, 60)
  return name === '' ? null : name
}
