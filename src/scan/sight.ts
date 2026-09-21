/**
 * What the card index (cardIndex.ts) says about a scanned card, turned into decisions: which printing
 * of a name the card in hand is, and — when its title couldn't be read — which card it is at all.
 * The thresholds were set on photos of real cards against the full index of 101,312 pictures
 * (tools/card-index): real cards cleared the nearest other name by 0.07 or more (95% by 0.115), the
 * nearest other picture of their own name by 0.1 or more; crops of bare table and half-cards
 * mostly by about 0.01, but by as much as 0.15. Mirrors the Android app's data/Sight.kt.
 */

import type { IndexEntry, IndexMatch } from './cardIndex'

/** Among a name's printings, the winner must beat the nearest *other picture* by this much. */
export const PICTURE_MARGIN = 0.05

/** A card known by sight alone must look at least this much like its picture... */
export const SIGHT_SCORE = 0.72

/** ...and stand this far clear of every other card's name. */
export const SIGHT_NAME_MARGIN = 0.12

export interface SightPick {
  entry: IndexEntry
  /**
   * Whether this is certainly the printing: false when other printings share its very picture (the
   * same art in the same frame, reprinted), which only the small print can tell apart.
   */
  certain: boolean
}

/**
 * Which of a name's printings the card is, from [matches] — the nearest of that name's printings,
 * best first. Null when two different pictures are too close to call.
 */
export function printingBySight(matches: IndexMatch[]): SightPick | null {
  const best = matches[0]
  if (!best) return null
  const rival = matches.find((m) => m.group !== best.group)
  if (rival && best.score - rival.score < PICTURE_MARGIN) return null
  return { entry: best, certain: !matches.slice(1).some((m) => m.group === best.group) }
}

/** The same card's name: either face of a double-faced card counts. */
export function sameCard(a: string, b: string): boolean {
  const faces = (n: string) => n.toLowerCase().split(' // ')
  const fa = faces(a)
  return a.toLowerCase() === b.toLowerCase() || faces(b).some((f) => fa.includes(f))
}

/**
 * The card [anywhere] (the nearest pictures over the whole index, best first) says this is, when it
 * says so clearly enough to act on without the title — or null.
 */
export function cardBySight(anywhere: IndexMatch[]): IndexEntry | null {
  const best = anywhere[0]
  if (!best || best.score < SIGHT_SCORE) return null
  const otherName = anywhere.find((m) => !sameCard(m.name, best.name))
  // Every one of the nearest being this card is as clear as it gets.
  if (otherName && best.score - otherName.score < SIGHT_NAME_MARGIN) return null
  return best
}

/**
 * Whether the card's look plainly says it's some other card than the title was read as: the
 * card's own name's best picture is far behind a clear match to another name. A title read from a
 * blurred or half-covered strip is fuzzily matched to a real card, and this is how a wrong one shows.
 */
export function looksLikeAnotherCard(readName: string, named: IndexMatch[], anywhere: IndexMatch[]): IndexEntry | null {
  const sight = cardBySight(anywhere)
  if (!sight || sameCard(sight.name, readName)) return null
  const own = named[0]?.score ?? -1
  return sight.score - own >= SIGHT_NAME_MARGIN ? sight : null
}
