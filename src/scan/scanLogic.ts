// Reading a card from camera frames: which text is its name, when a read is steady enough to look
// up, and when the card in view is still the one just added. Ported from the Android app's
// ScanViewModel (extractCardName, looksLikeSameCard and its frame guards); tested in tests/scan.

/**
 * Title-less frames in a row before the card counts as gone (rather than one blurry or glared frame
 * while it's still there). Until then, the card in view isn't added again.
 */
export const BLANK_FRAMES_TO_RESET = 4

/**
 * The card's name from what the reader made of its title bar: the first line with at least three
 * letters, without the mana cost and the stray marks around it.
 */
export function cleanTitle(text: string): string | null {
  for (const raw of text.split('\n')) {
    // The mana cost sits apart from the name, after a wide gap.
    let line = raw.split('{')[0].split(/\s{3,}/)[0]
    // Keep what a card name is made of; everything else (mana symbols, frame edges) becomes a gap.
    line = line.replace(/[^\p{L}',\- ]+/gu, ' ').replace(/\s+/g, ' ').trim()
    // A lone letter at either end is usually a mana symbol or the frame read as one ("A" can start a name).
    line = line.replace(/^(?:[B-Zb-z] )+/, '').replace(/(?: \p{L})+$/u, '').replace(/^[-',]+|[-',]+$/g, '').trim()
    if ((line.match(/\p{L}/gu) ?? []).length >= 3) return line
  }
  return null
}

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Whether a read title and a card's name are the same card, allowing for a misread character or a cut-off end. */
export function looksLikeSameCard(title: string, cardName: string): boolean {
  const a = letters(title)
  const b = letters(cardName)
  if (!a || !b) return false
  if (a.includes(b) || b.includes(a)) return true
  let common = 0
  while (common < a.length && common < b.length && a[common] === b[common]) common++
  return common >= 4
}

/** Edit distance, stopping early once it passes [limit]. */
function distanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > limit) return false
    previous = row
  }
  return previous[b.length] <= limit
}

/**
 * Whether two frames read the same title. The browser's reader varies a little from frame to frame,
 * so a letter or so of difference still counts (the phone app, with a steadier reader, needs an
 * exact match).
 */
export function sameRead(a: string, b: string): boolean {
  const x = letters(a)
  const y = letters(b)
  return x === y || distanceWithin(x, y, Math.max(1, Math.floor(Math.min(x.length, y.length) / 10)))
}

export type ScanStep = { kind: 'wait' } | { kind: 'lookup'; name: string }

/**
 * Decides, frame by frame, when to look a card up: the same title on two frames in a row, not the
 * one just looked up, and not the card just added still sitting in view. [forced] (the Scan now
 * button) skips those checks — tapping it is the confirmation, and how to count a second copy.
 */
export class ScanTracker {
  private lastRead: string | null = null
  private lastLookedUp: string | null = null
  private lastAdded: string | null = null
  private blankStreak = 0

  /** One frame's read: the title found, or null when there wasn't one. */
  onRead(title: string | null, forced = false): ScanStep {
    if (title === null) {
      this.blankStreak += 1
      if (this.blankStreak >= BLANK_FRAMES_TO_RESET) {
        // The card has really left: the next one in view is new, even if it's another copy.
        this.lastRead = null
        this.lastLookedUp = null
        this.lastAdded = null
      }
      return { kind: 'wait' }
    }
    this.blankStreak = 0
    if (!forced && this.lastAdded !== null && looksLikeSameCard(title, this.lastAdded)) {
      this.lastRead = title
      return { kind: 'wait' }
    }
    const steady = forced || (this.lastRead !== null && sameRead(title, this.lastRead))
    this.lastRead = title
    if (!steady || (!forced && this.lastLookedUp !== null && sameRead(title, this.lastLookedUp))) return { kind: 'wait' }
    this.lastLookedUp = title
    return { kind: 'lookup', name: title }
  }

  /** The lookup found [cardName]: it's the card in view now, and isn't added again while it stays. */
  added(cardName: string) {
    this.lastAdded = cardName
  }
}
