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

// The small print at the bottom left of cards since 2015: the set code before a bullet and a
// two-letter language ("MSC • EN"), and the collector number after the rarity letter ("U 0211") or
// as "number/total" ("0211/0280"). The reader sees the bullet as all sorts of marks ("«", "*", "."),
// and sometimes doubles the rarity letter ("Cc 0172").
//
// It also drops the bullet altogether as often as not — "FRC • EN ▸ Titus Lunter" came back as
// "FRC ENTTUS LUNTER", the artist run on — so the bullet is optional, and what keeps the match
// honest is that the language has to be one actually printed on cards. A printing read wrong can't
// slip through anyway: it's only kept if it names the card the title read (sameCardName). Mirrors
// the Android app's data/SmallPrintParse.kt.
const SET_AND_LANGUAGE = /\b([A-Z0-9]{3,5})(?:\s*[^\sA-Za-z0-9]\s*|\s+)(?:EN|DE|ES|FR|IT|JA|JP|KO|KR|PT|RU|CS|CT|ZH|PH)(?![a-z])/
// The rarity letter can come out lowercase ("u"), and the number's zeros as the letter o ("oo21"),
// so o counts as a zero — but only in a number with a real digit in it.
const RARITY_NUMBER = /\b(?:[CURMSPLT][a-z]?|[curmsplt])\s+((?=[0-9Oo]*\d)[0-9Oo]{1,4})\b/
const NUMBER_OF_TOTAL = /\b(\d{1,4})\s*\/\s*\d{1,4}\b/

/**
 * The exact printing from the small print at the bottom of a card: its set code and collector number
 * (leading zeros dropped), or null when either can't be read with confidence — the card is then
 * found by name. Ported from the Android app's extractSetAndNumber.
 */
export function parseSetAndNumber(text: string): { set: string; number: string } | null {
  const lines = text.split('\n')
  const set = lines.map((l) => SET_AND_LANGUAGE.exec(l)?.[1]).find(Boolean)
  if (!set) return null
  const number = lines.map((l) => RARITY_NUMBER.exec(l)?.[1]).find(Boolean) ?? lines.map((l) => NUMBER_OF_TOTAL.exec(l)?.[1]).find(Boolean)
  if (!number) return null
  return { set: set.toLowerCase(), number: number.replace(/[Oo]/g, '0').replace(/^0+(?=\d)/, '') }
}

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * Whether two exact card names are the same card: equal once case and punctuation are dropped, and
 * a double-faced card's front face is enough ("Delver of Secrets" is "Delver of Secrets // Insectile
 * Aberration"). Strict on purpose — "Lightning Bolt" and "Lightning Helix" are different cards.
 */
export function sameCardName(a: string, b: string): boolean {
  const front = (s: string) => letters(s.split(' // ')[0])
  return front(a) !== '' && front(a) === front(b)
}

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

/**
 * Reads of the same title in a row before the card is looked up. A card halfway into the frame, or
 * caught mid-motion, rarely reads the same three times running.
 */
export const STEADY_READS = 3

/**
 * How careful the scanner is, chosen on the scan page. Accurate is how it has always been: a name
 * has to read the same on STEADY_READS frames running, and the small print is read up close for the
 * exact printing. Fast takes a name after two, and skips that close read — the printing comes from
 * matching the art — so more rows say "best guess", and a card caught halfway into the frame is a
 * little likelier to be read. Mirrors the Android app's ScanMode in data/ScanConfirm.kt.
 */
export type ScanMode = 'accurate' | 'fast'

export const SCAN_MODES: Record<ScanMode, { label: string; steadyReads: number; readsSmallPrint: boolean }> = {
  accurate: { label: 'Accurate', steadyReads: STEADY_READS, readsSmallPrint: true },
  fast: { label: 'Fast', steadyReads: 2, readsSmallPrint: false },
}

/** A stored choice as a mode: Accurate unless it clearly says Fast. */
export const scanModeOf = (value: unknown): ScanMode => (value === 'fast' ? 'fast' : 'accurate')

/**
 * What came back for a read title: the card itself, a piece of a card's name (the card wasn't all
 * in the frame, or its title was cut off), or a different card altogether.
 */
export type Confirmation = 'yes' | 'partial' | 'different'

/**
 * Whether the card a lookup found is really the card that was read. A fuzzy lookup answers a
 * half-read title with a real card — "Lightning B" comes back as Lightning Bolt — so the read has
 * to account for the whole name before the card is added. [flavorName] is the name printed large on
 * a Universes Beyond card ("Kefka's Tower" over "Bolas's Citadel"), which is what the camera reads.
 */
export function confirmRead(title: string, cardName: string, flavorName?: string | null): Confirmation {
  const answers = [cardName, ...(flavorName ? [flavorName] : [])].map((name) => against(title, name))
  if (answers.includes('yes')) return 'yes'
  return answers.includes('partial') ? 'partial' : 'different'
}

function against(title: string, cardName: string): Confirmation {
  const read = letters(title)
  const name = letters(cardName.split(' // ')[0])
  if (!read || !name) return 'different'
  if (read === name) return 'yes'
  // A letter or two misread across a full-length name is still that card.
  if (Math.abs(read.length - name.length) <= 2 && distanceWithin(read, name, Math.max(1, Math.floor(name.length / 8)))) return 'yes'
  // Anything less than the whole name is a card that wasn't all in the frame.
  if (name.includes(read) || read.includes(name)) return 'partial'
  return 'different'
}

export type ScanStep = { kind: 'wait' } | { kind: 'lookup'; name: string }

/**
 * Decides, frame by frame, when to look a card up: the same title on two frames in a row, not the
 * one just looked up, and not the card just added still sitting in view. [forced] (the Scan now
 * button) skips those checks — tapping it is the confirmation, and how to count a second copy.
 */
export class ScanTracker {
  /**
   * [readsNeeded] is how many steady reads make a card — asked afresh every frame, so switching
   * between Fast and Accurate takes effect without restarting the camera.
   */
  private readonly readsNeeded: () => number

  constructor(readsNeeded: () => number = () => STEADY_READS) {
    this.readsNeeded = readsNeeded
  }

  private lastRead: string | null = null
  /** How many reads in a row have said the same thing (see STEADY_READS). */
  private steadyReads = 0
  private lastLookedUp: string | null = null
  private lastAdded: string | null = null
  private blankStreak = 0

  /** One frame's read: the title found, or null when there wasn't one. */
  onRead(title: string | null, forced = false): ScanStep {
    if (title === null) {
      this.blankStreak += 1
      if (this.blankStreak >= BLANK_FRAMES_TO_RESET) {
        // The card has really left: the next one in view is new, even if it's another copy.
        this.steadyReads = 0
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
    this.steadyReads = this.lastRead !== null && sameRead(title, this.lastRead) ? this.steadyReads + 1 : 1
    const steady = forced || this.steadyReads >= this.readsNeeded()
    this.lastRead = title
    if (!steady || (!forced && this.lastLookedUp !== null && sameRead(title, this.lastLookedUp))) return { kind: 'wait' }
    this.lastLookedUp = title
    return { kind: 'lookup', name: title }
  }

  /** The lookup failed (offline, say): the card in view is tried again on its next steady read. */
  failed() {
    this.lastLookedUp = null
    this.steadyReads = 0
  }

  /**
   * The lookup answered with a card that isn't what was read — a piece of a name, or another card.
   * Nothing is added, and the same reading isn't spent on another lookup; more of the card coming
   * into the frame reads differently, and that is looked up.
   */
  unconfirmed() {
    this.steadyReads = 0
  }

  /** The lookup found [cardName]: it's the card in view now, and isn't added again while it stays. */
  added(cardName: string) {
    this.lastAdded = cardName
  }
}
