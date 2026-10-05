// What a binder entry's copies are like: their condition and the language they're printed in
// (CollectionEntry.condition / .language). Both describe every copy in the entry, and both are
// optional — left out when the user hasn't said. Stored as short codes so the Android app reads the
// same values; other apps' words for them ("Lightly Played", "near_mint", "Japanese") are read by
// conditionCode and languageCode when a CSV comes in. Mirrors the Android app's data/CopyDetails.kt.

import type { CollectionEntry } from '../types/models'
import { withPlaces } from './storagePlaces'

/** Conditions, best first: Near Mint, Lightly / Moderately / Heavily Played, Damaged. */
export const CARD_CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
export type CardCondition = (typeof CARD_CONDITIONS)[number]

/** Scryfall's language codes, in the order the picker offers them. */
export const CARD_LANGUAGES = ['en', 'ja', 'de', 'fr', 'it', 'es', 'pt', 'ru', 'ko', 'zhs', 'zht'] as const
export type CardLanguage = (typeof CARD_LANGUAGES)[number]

const CONDITION_NAMES: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  ko: 'Korean',
  zhs: 'Chinese Simplified',
  zht: 'Chinese Traditional',
}

/** "Lightly Played" for "LP"; the code itself for one this app doesn't know. */
export const conditionName = (code: string): string => CONDITION_NAMES[code] ?? code

/** "Japanese" for "ja". */
export const languageName = (code: string): string => LANGUAGE_NAMES[code] ?? code

/** The small badge on a row: "JA", "ZHS". */
export const languageBadge = (code: string): string => code.toUpperCase()

const words = (raw: string) => raw.trim().toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ')

const CONDITION_WORDS: [string, string[]][] = [
  ['NM', ['nm', 'near mint', 'mint', 'm', 'mt', 'nm m', 'nm/m', 'near mint mint']],
  ['LP', ['lp', 'lightly played', 'light played', 'slightly played', 'sp', 'excellent', 'ex', 'ex+']],
  ['MP', ['mp', 'moderately played', 'played', 'pl', 'good', 'gd', 'vg', 'very good']],
  ['HP', ['hp', 'heavily played', 'heavy played']],
  ['DMG', ['dmg', 'damaged', 'poor', 'po', 'd']],
]

/**
 * The condition code for what another app wrote: TCGplayer's and Moxfield's words ("Near Mint",
 * "Lightly Played", "Near Mint Foil"), Deckbox's ("Good (Lightly Played)", "Played"), ManaBox's
 * ("near_mint", "excellent", "light_played", "poor"), Dragon Shield's ("NearMint", "LightPlayed") and the short forms (NM, LP, EX, PL…). Null
 * for a blank cell or a word it can't place.
 */
export function conditionCode(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  // Dragon Shield runs the words together: "NearMint", "LightPlayed".
  let w = words(raw.replace(/([a-z])([A-Z])/g, '$1 $2'))
  if (w.endsWith(' foil')) w = w.slice(0, -' foil'.length)
  if (w.endsWith(' etched')) w = w.slice(0, -' etched'.length)
  w = w.trim()
  if (!w) return null
  // Deckbox's "Good (Lightly Played)" says what it means in brackets.
  const inner = /\(([^)]*)\)/.exec(w)?.[1]
  if (inner !== undefined) {
    const code = conditionCode(inner)
    if (code) return code
  }
  for (const [code, names] of CONDITION_WORDS) if (names.includes(w)) return code
  return CARD_CONDITIONS.find((c) => c.toLowerCase() === w) ?? null
}

const LANGUAGE_WORDS: [string, string[]][] = [
  ['en', ['english', 'eng']],
  ['ja', ['japanese', 'jp', 'jpn']],
  ['de', ['german', 'deutsch', 'ger', 'deu']],
  ['fr', ['french', 'français', 'francais', 'fra', 'fre']],
  ['it', ['italian', 'italiano', 'ita']],
  ['es', ['spanish', 'español', 'espanol', 'spa', 'sp']],
  ['pt', ['portuguese', 'portuguese (brazil)', 'portuguese brazil', 'português', 'por', 'pt br']],
  ['ru', ['russian', 'rus']],
  ['ko', ['korean', 'kr', 'kor']],
  ['zhs', ['chinese simplified', 'simplified chinese', 'chinese (simplified)', 'zh cn', 'zh hans', 'cs', 'chs', 's chinese']],
  ['zht', ['chinese traditional', 'traditional chinese', 'chinese (traditional)', 'zh tw', 'zh hant', 'ct', 'cht', 't chinese']],
]

/**
 * The language code for what another app wrote: a name ("Japanese", "Chinese Simplified",
 * "Simplified Chinese") or a code (Scryfall's own, or the usual others: "jp", "zh-CN", "kr"). Null
 * for a blank cell or a language Scryfall doesn't print in.
 */
export function languageCode(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const w = words(raw)
  if ((CARD_LANGUAGES as readonly string[]).includes(w)) return w
  for (const [code, names] of LANGUAGE_WORDS) if (names.includes(w)) return code
  return null
}

/** The badges a binder row shows for its copies — only what's been set: "LP", "JA". */
export function copyBadges(entry: Pick<CollectionEntry, 'condition' | 'language'>): string[] {
  return [entry.condition, entry.language ? languageBadge(entry.language) : null].filter((b): b is string => !!b)
}

/** [entry] with an optional key set to [value], or left out when there's nothing to say. */
export function withOptional<T extends object, K extends keyof T>(entry: T, key: K, value: T[K] | null | undefined): T {
  const next = { ...entry }
  if (value === null || value === undefined) delete next[key]
  else next[key] = value
  return next
}

/** [entry] with its copies' condition and language; null leaves one out. */
export function withCopyDetails(entry: CollectionEntry, condition: string | null, language: string | null): CollectionEntry {
  return withOptional(withOptional(entry, 'condition', condition), 'language', language)
}

/**
 * This entry with [added]'s copies put in with its own. One entry describes all its copies, so it
 * keeps its own condition, language and rise alert, taking [added]'s only where it has none.
 */
export function withCopiesOf(entry: CollectionEntry, added: CollectionEntry): CollectionEntry {
  let next: CollectionEntry = { ...entry, quantity: entry.quantity + added.quantity, foilQuantity: entry.foilQuantity + added.foilQuantity }
  next = withOptional(next, 'condition', entry.condition ?? added.condition)
  next = withOptional(next, 'language', entry.language ?? added.language)
  next = withOptional(next, 'priceAlertAbove', entry.priceAlertAbove ?? added.priceAlertAbove)
  // Where the added copies are kept comes with them (see storagePlaces.ts).
  if (entry.places !== undefined || added.places !== undefined) next = withPlaces(next, [...(entry.places ?? []), ...(added.places ?? [])])
  return next
}
