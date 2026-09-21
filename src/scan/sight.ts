/**
 * What the card index (cardIndex.ts) says about a scanned card, turned into decisions: which printing
 * of a name the card in hand is, and — when its title couldn't be read — which card it is at all.
 * The thresholds were set on 199 photos of real cards and 120 of things that aren't (bare table,
 * half a card) against the full index of 101,312 pictures (tools/card-index, 8-bit model): real
 * cards always found the right picture of their own name, by as little as 0.03; known by sight alone,
 * the rule below takes 182 of the 199 cards and none of the 120 others. Mirrors the Android app's
 * data/Sight.kt.
 */

import type { IndexEntry, IndexMatch } from './cardIndex'

/** Among a name's printings, the winner must beat the nearest *other picture* by this much. */
export const PICTURE_MARGIN = 0.03

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

/**
 * Which printing, when a set code was read as well: among that set's printings of the name
 * ([inSet]) — unless none of them looks as much like the card as the name's best printing overall
 * ([named]) does, and the set code was misread. Within the set, versions too alike to call still
 * give its best, as a guess.
 */
export function choosePrinting(named: IndexMatch[], inSet: IndexMatch[]): SightPick | null {
  const setBest = inSet[0]
  const nameBest = named[0]
  if (setBest && (!nameBest || setBest.score >= nameBest.score - PICTURE_MARGIN)) {
    return printingBySight(inSet) ?? { entry: setBest, certain: false }
  }
  return printingBySight(named)
}

/**
 * How far the printing the small print named may look less like the card than its name's best
 * printing does, before the small print is taken to be misread: a set code and number misread as
 * another real printing of the same card (ZNR 381 read as TRK 319) passes every other check.
 */
export const SMALL_PRINT_SLACK = 0.06

/**
 * Whether what the card looks like bears out the printing its small print named ([printing], its
 * likeness; null when that printing isn't in the index, and there's nothing to say against it).
 */
export function smallPrintAgrees(printing: IndexMatch | null, named: IndexMatch[]): boolean {
  const best = named[0]
  if (!printing || !best) return true
  return printing.group === best.group || printing.score >= best.score - SMALL_PRINT_SLACK
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
export function cardBySight(anywhere: IndexMatch[]): IndexMatch | null {
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
export function looksLikeAnotherCard(readName: string, named: IndexMatch[], anywhere: IndexMatch[]): IndexMatch | null {
  const sight = cardBySight(anywhere)
  if (!sight || sameCard(sight.name, readName)) return null
  const own = named[0]?.score ?? -1
  return sight.score - own >= SIGHT_NAME_MARGIN ? sight : null
}
