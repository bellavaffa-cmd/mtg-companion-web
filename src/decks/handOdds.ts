// The odds of an opening hand, worked out exactly from the deck list (hypergeometric: drawing
// without putting back). Mirrors the Android app's data/HandOdds.kt.

/** A keepable seven: this many lands. */
export const KEEPABLE_LANDS: [number, number] = [2, 4]
export const OPENING_HAND = 7

export interface HandOdds {
  /** The cards shuffled into the library (a deck less its commanders), its lands and its ramp. */
  library: number
  lands: number
  ramp: number
  /** Whether the first turn has a draw: multiplayer Commander, yes; a two-player game on the play, no. */
  drawsOnTurnOne: boolean
  /** Chance of exactly 0, 1, … 7 lands in the opening seven. */
  landSpread: number[]
  keepable: number
  /** A keepable seven by the second hand (a London mulligan draws a fresh seven). */
  keepableWithMulligan: number
  /** At least one ramp card in the opening seven. */
  rampInHand: number
  /** A land for every turn up to it: 3 lands by turn 3, 4 by turn 4. */
  landDrops: { turn: number; chance: number }[]
  /** 2+ lands and a ramp card among the cards seen by turn 2. */
  landsAndRampByTurn2: number
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0
  const m = Math.min(k, n - k)
  let r = 1
  for (let i = 1; i <= m; i++) r = (r * (n - m + i)) / i
  return r
}

/** Chance of at least [atLeast] lands among [n] cards. */
function landsAtLeast(library: number, lands: number, n: number, atLeast: number): number {
  let sum = 0
  for (let l = atLeast; l <= n; l++) sum += choose(lands, l) * choose(library - lands, n - l)
  return sum / choose(library, n)
}

/** Cards seen by [turn]: the seven, plus a draw each turn (less the first, on the play in a two-player game). */
export const cardsSeenBy = (turn: number, drawsOnTurnOne: boolean) => OPENING_HAND + turn - (drawsOnTurnOne ? 0 : 1)

/**
 * The opening-hand odds for a library of [library] cards holding [lands] lands and [ramp] non-land
 * ramp cards. Null for a library too small to draw a hand from.
 */
export function handOdds(library: number, lands: number, ramp: number, drawsOnTurnOne: boolean): HandOdds | null {
  if (library < OPENING_HAND + 4 || lands > library || lands + ramp > library) return null
  const all = choose(library, OPENING_HAND)
  const landSpread = Array.from({ length: OPENING_HAND + 1 }, (_, l) => (choose(lands, l) * choose(library - lands, OPENING_HAND - l)) / all)
  let keepable = 0
  for (let l = KEEPABLE_LANDS[0]; l <= KEEPABLE_LANDS[1]; l++) keepable += landSpread[l]
  const byTurn2 = cardsSeenBy(2, drawsOnTurnOne)
  const others = library - lands - ramp
  let landsAndRamp = 0
  for (let l = 2; l <= byTurn2; l++) {
    for (let r = 1; r <= byTurn2 - l; r++) landsAndRamp += choose(lands, l) * choose(ramp, r) * choose(others, byTurn2 - l - r)
  }
  return {
    library,
    lands,
    ramp,
    drawsOnTurnOne,
    landSpread,
    keepable,
    keepableWithMulligan: 1 - (1 - keepable) * (1 - keepable),
    rampInHand: 1 - choose(library - ramp, OPENING_HAND) / all,
    landDrops: [3, 4].map((turn) => ({ turn, chance: landsAtLeast(library, lands, cardsSeenBy(turn, drawsOnTurnOne), turn) })),
    landsAndRampByTurn2: landsAndRamp / choose(library, byTurn2),
  }
}

/** A chance as a whole percent, never claiming a certainty it isn't: ">99%" not "100%", "<1%" not "0%". */
export function oddsPercent(p: number): string {
  if (p <= 0) return '0%'
  if (p < 0.005) return '<1%'
  if (p >= 1) return '100%'
  if (p > 0.995) return '>99%'
  return `${Math.round(p * 100)}%`
}
