// The scanner learns from your corrections. When a scanned card is changed to another printing (the
// scan list's "pick art", Sort a pile's "Wrong card?"), what the scanner read is remembered with what
// it should have been, so the same misread comes out right next time. Kept on the Unsorted pile as
// "scanCorrections" and synced like the sorting recipes. The Android app's data/ScanCorrections.kt,
// rule for rule; both run tests/scan/scanCorrectionVectors.json.
//
// Two kinds:
//  - MISREAD: the read itself — the title as read, the set code and collector number as read (or, when
//    those weren't both read, the card the scanner came up with) — keyed exactly, and put right from
//    the first correction on.
//  - PRINTING: the name read right but the set unreadable (a basic land, a reprint), and the user picks
//    one printing of it. Only once they've picked the same printing twice in a row is it preferred, and
//    only when the set couldn't be read.

import { isUnsorted, type Collection } from '../types/models'
import { withUnsortedPile } from '../collection/unsorted'

export type CorrectionKind = 'MISREAD' | 'PRINTING'

/** One thing the scanner has learned. Optional fields are left out rather than null, as on Android. */
export interface ScanCorrection {
  /** See misreadKey and printingKey. */
  key: string
  kind: CorrectionKind
  /** The title as read ("Lightnin Bolt"). */
  read: string
  /** The set code as read, lowercase, when it was. */
  readSet?: string
  /** The collector number as read, when it was. */
  readNumber?: string
  /** What the scanner came up with. */
  wrongId: string
  wrongName: string
  /** What it should have been. */
  scryfallId: string
  name: string
  set: string
  collectorNumber: string
  /** How many times the user has made this correction (a PRINTING one counts from 2). */
  count: number
  /** How many times it has put a scan right. */
  used: number
  /** When it was last made or used, ms. */
  lastUsed: number
}

/** What the scanner read off a card, and what it made of it — before any correction. */
export interface ScanReading {
  read: string
  set: string | null
  number: string | null
  recognizedId: string
  recognizedName: string
}

/** A card a scan was corrected to. */
export interface CardRef {
  id: string
  name: string
  set: string
  collectorNumber: string
}

/** A correction put to use on a scan. */
export interface Applied {
  key: string
  kind: CorrectionKind
  scryfallId: string
}

/** At most this many are kept; past it, the ones used longest ago go. */
export const MAX_CORRECTIONS = 500

/** A printing has to be picked this many times in a row before it's preferred. */
export const PRINTING_PICKS = 2

/** Letters and digits only, lowercase: how a read and a name are compared. */
export function normalizeRead(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** A double-faced card's front: "Delver of Secrets // Insectile Aberration" is Delver of Secrets. */
const front = (name: string) => name.split(' // ')[0]

export const sameCardName = (a: string, b: string) => normalizeRead(front(a)) === normalizeRead(front(b))

const setOf = (r: ScanReading) => r.set?.trim().toLowerCase() || null
const numberOf = (r: ScanReading) => r.number?.trim().toLowerCase() || null

/**
 * The key of a misread: the title as read with the set code and number when both were read — they
 * name the printing exactly — otherwise with whatever of the set was read and the card the scanner
 * came up with, so only that same wrong answer to that same read is put right.
 */
export function misreadKey(r: ScanReading): string {
  const title = normalizeRead(r.read)
  const set = setOf(r)
  const number = numberOf(r)
  return set && number ? `${title}|${set}:${number}` : `${title}|${set ?? ''}|=${r.recognizedId}`
}

/** The key of a preferred printing: the card's name. */
export const printingKey = (name: string) => `~${normalizeRead(front(name))}`

/** The correction for [r], if one has been learned: a misread first, then a preferred printing (set unread only). */
export function lookupCorrection(list: ScanCorrection[] | undefined, r: ScanReading): Applied | null {
  const all = list ?? []
  const key = misreadKey(r)
  const misread = all.find((c) => c.key === key)
  if (misread && misread.scryfallId !== r.recognizedId) return { key, kind: 'MISREAD', scryfallId: misread.scryfallId }
  if (setOf(r) !== null) return null
  const pkey = printingKey(r.recognizedName)
  const pref = all.find((c) => c.key === pkey)
  if (pref && pref.count >= PRINTING_PICKS && pref.scryfallId !== r.recognizedId) return { key: pkey, kind: 'PRINTING', scryfallId: pref.scryfallId }
  return null
}

/** Newest first; the key settles a tie. Capped at MAX_CORRECTIONS. */
export function capCorrections(list: ScanCorrection[]): ScanCorrection[] {
  return [...list]
    .sort((a, b) => (b.lastUsed - a.lastUsed) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, MAX_CORRECTIONS)
}

function entry(kind: CorrectionKind, key: string, r: ScanReading, card: CardRef, count: number, used: number, now: number): ScanCorrection {
  const set = setOf(r)
  const number = numberOf(r)
  return {
    key, kind, read: r.read.trim(),
    ...(set ? { readSet: set } : {}),
    ...(number ? { readNumber: number } : {}),
    wrongId: r.recognizedId, wrongName: r.recognizedName,
    scryfallId: card.id, name: card.name, set: card.set, collectorNumber: card.collectorNumber,
    count, used, lastUsed: now,
  }
}

/** [key]'s entry made again: one more time if it's the same card, otherwise replaced. */
function upsert(list: ScanCorrection[], kind: CorrectionKind, key: string, r: ScanReading, card: CardRef, now: number): ScanCorrection[] {
  const was = list.find((c) => c.key === key)
  const same = was && was.scryfallId === card.id
  const next = entry(kind, key, r, card, same ? was.count + 1 : 1, same ? was.used : 0, now)
  return [next, ...list.filter((c) => c.key !== key)]
}

/**
 * [list] after the user changed a scan read as [r] to [card]. [learned] is the key of the correction
 * that scan was put right by, if it was. Picking the card the scanner came up with un-corrects: a
 * learned correction goes, a misread is dropped, and a printing picked once before counts one less.
 */
export function recordCorrection(list: ScanCorrection[] | undefined, r: ScanReading, card: CardRef, now: number, learned: string | null = null): ScanCorrection[] {
  let out = list ?? []
  if (card.id === r.recognizedId) {
    out = out.filter((c) => c.key !== misreadKey(r) && c.key !== learned)
    if (learned === null && setOf(r) === null) {
      const pkey = printingKey(r.recognizedName)
      out = out.flatMap((c) => (c.key !== pkey || c.scryfallId === card.id ? [c] : c.count > 1 ? [{ ...c, count: c.count - 1 }] : []))
    }
    return capCorrections(out)
  }
  if (learned !== null) out = out.filter((c) => c.key !== learned)
  out = sameCardName(card.name, r.recognizedName) && setOf(r) === null
    ? upsert(out, 'PRINTING', printingKey(r.recognizedName), r, card, now)
    : upsert(out, 'MISREAD', misreadKey(r), r, card, now)
  return capCorrections(out)
}

/** [key]'s correction has put another scan right. */
export function markUsed(list: ScanCorrection[] | undefined, key: string, now: number): ScanCorrection[] {
  return capCorrections((list ?? []).map((c) => (c.key === key ? { ...c, used: c.used + 1, lastUsed: Math.max(c.lastUsed, now) } : c)))
}

export const forgetCorrection = (list: ScanCorrection[] | undefined, key: string): ScanCorrection[] => (list ?? []).filter((c) => c.key !== key)

/**
 * Two devices' corrections, entry by entry: added on either side, kept; both have it, the one used
 * last wins; gone on one side and not used since on the other, gone. Capped as ever.
 */
export function mergeCorrections(base: ScanCorrection[] | undefined, mine: ScanCorrection[] | undefined, theirs: ScanCorrection[] | undefined, minePreferred: boolean): ScanCorrection[] | undefined {
  if (base === undefined && mine === undefined && theirs === undefined) return undefined
  const b = new Map((base ?? []).map((c) => [c.key, c]))
  const m = new Map((mine ?? []).map((c) => [c.key, c]))
  const t = new Map((theirs ?? []).map((c) => [c.key, c]))
  const out: ScanCorrection[] = []
  for (const key of new Set([...m.keys(), ...t.keys()])) {
    const bc = b.get(key)
    const mc = m.get(key)
    const tc = t.get(key)
    if (mc && tc) {
      out.push(mc.lastUsed > tc.lastUsed ? mc : tc.lastUsed > mc.lastUsed ? tc : minePreferred ? mc : tc)
      continue
    }
    const one = (mc ?? tc)!
    // Only on one side: new there, or forgotten on the other — unless it's been used since.
    if (!bc || one.lastUsed > bc.lastUsed) out.push(one)
  }
  return capCorrections(out)
}

/**
 * [theirs] with [source]'s corrections, when [theirs] was saved by an app that doesn't know about them
 * (no "scanCorrections" key) — the same object otherwise.
 */
export function keepCorrectionsFromOlderApp(source: Collection, theirs: Collection): Collection {
  if (theirs.scanCorrections !== undefined || source.scanCorrections === undefined || !isUnsorted(theirs)) return theirs
  return { ...theirs, scanCorrections: source.scanCorrections }
}

/** The corrections learned so far, newest first. */
export const correctionsOf = (collections: Collection[]): ScanCorrection[] => collections.find(isUnsorted)?.scanCorrections ?? []

/** [collections] with the corrections set to [list] (on the Unsorted pile, made if it isn't there). */
export function withCorrections(collections: Collection[], list: ScanCorrection[]): Collection[] {
  return withUnsortedPile(collections).map((c) => (isUnsorted(c) ? { ...c, scanCorrections: capCorrections(list) } : c))
}

/** The corrected card, as the list says it: "Plains · DMU #262". */
export const correctedLine = (c: ScanCorrection) => `${c.name} · ${c.set.toUpperCase()} #${c.collectorNumber}`

/** What was read, as the list says it. */
export function readLine(c: ScanCorrection): string {
  if (c.kind === 'PRINTING') return `${c.wrongName}, set unread`
  const where = c.readSet ? ` (${c.readSet.toUpperCase()}${c.readNumber ? ` #${c.readNumber}` : ''})` : ''
  return `“${c.read}”${where}, taken for ${c.wrongName}`
}

/** How often, as the list says it: "Corrected twice · used 3 times". */
export function usedLine(c: ScanCorrection): string {
  const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
  if (c.kind === 'PRINTING' && c.count < PRINTING_PICKS) return `Picked ${times(c.count)} · preferred once picked ${times(PRINTING_PICKS)}`
  return `Corrected ${times(c.count)} · ${c.used === 0 ? 'not used yet' : `used ${times(c.used)}`}`
}
