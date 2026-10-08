// The printing picker's search field ("Best guess · pick art", Change printing, Sort a pile's
// "Wrong card? › Pick the printing"): a card's printings narrowed to what's typed — a set's name
// ("final fan", "dusk"), its code ("fin", "PLST"), a collector number ("306", "0306"), set and number
// together ("fin 306", "FIN·306", "fin#306"), or the year it came out ("2025"). The same cases run
// in the Android app (data/PrintingSearch.kt) from tests/scan/printingSearchVectors.json.

/** What the search looks at in one printing. */
export interface PrintingFacts {
  set?: string | null
  setName?: string | null
  number?: string | null
  /** Scryfall's released_at, "2025-06-13". */
  released?: string | null
}

/** How well a printing matches, best first; printings in one group keep the order they came in. */
export const MATCH = { exactCode: 0, codePrefix: 1, setName: 2, number: 3, year: 4 } as const

/** Lower case, accents dropped, anything but letters and digits a single space: "Lim-Dûl" → "lim dul". */
export function foldText(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A collector number to compare: folded, no spaces, no leading zeros ("0306" → "306", "306★" → "306"). */
function foldNumber(s: string | null | undefined): string {
  return foldText(s).replace(/ /g, '').replace(/^0+(?=\d)/, '')
}

const NUMBER_LIKE = /^\d+[a-z]*$/
const YEAR = /^(19|20)\d\d$/

/** The group [facts] falls in for the folded query [tokens], or null when it doesn't match. */
export function printingMatch(facts: PrintingFacts, tokens: string[]): number | null {
  if (tokens.length === 0) return null
  const code = foldText(facts.set).replace(/ /g, '')
  const name = foldText(facts.setName)
  const number = foldNumber(facts.number)
  if (tokens.length === 1) {
    const t = tokens[0]
    if (code && code === t) return MATCH.exactCode
    if (code && code.startsWith(t)) return MATCH.codePrefix
    if (name.includes(t)) return MATCH.setName
    if (number && foldNumber(t) === number) return MATCH.number
    if (YEAR.test(t) && (facts.released ?? '').startsWith(t)) return MATCH.year
    return null
  }
  // A set and a number: "fin 306", "final fantasy 306".
  const last = tokens[tokens.length - 1]
  if (NUMBER_LIKE.test(last) && number && foldNumber(last) === number) {
    const head = tokens.slice(0, -1).join(' ')
    if (tokens.length === 2 && code && code === head) return MATCH.exactCode
    if (tokens.length === 2 && code && code.startsWith(head)) return MATCH.codePrefix
    if (name.includes(head)) return MATCH.setName
  }
  // Several words of a set's name: "final fantasy", "magic 2010".
  return name.includes(tokens.join(' ')) ? MATCH.setName : null
}

/** The query split into folded words: "FIN·306" → ["fin", "306"]. */
export function queryTokens(query: string): string[] {
  return foldText(query).split(' ').filter(Boolean)
}

/**
 * [items] that match [query], best first: an exact set code, then a code it begins, then a set's
 * name, then a collector number, then a year — each group in [items]' own order. A blank query
 * keeps them all, as they are.
 */
export function searchPrintings<T>(items: readonly T[], query: string, facts: (item: T) => PrintingFacts): T[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return [...items]
  const ranked: { item: T; group: number; at: number }[] = []
  items.forEach((item, at) => {
    const group = printingMatch(facts(item), tokens)
    if (group !== null) ranked.push({ item, group, at })
  })
  return ranked.sort((a, b) => a.group - b.group || a.at - b.at).map((r) => r.item)
}

/**
 * The set code [query] could name, with the number after it — what to ask Scryfall for when the
 * printings loaded so far have no match (a card with so many printings they aren't all in yet).
 * Null for anything that can't be a set code: a code has a letter in it and is 2 to 6 long.
 */
export function setCodeQuery(query: string): { set: string; number: string | null } | null {
  const tokens = queryTokens(query)
  if (tokens.length === 0 || tokens.length > 2) return null
  const [set, number = null] = tokens
  if (!/^[a-z0-9]{2,6}$/.test(set) || !/[a-z]/.test(set)) return null
  if (number !== null && !NUMBER_LIKE.test(number)) return null
  return { set, number }
}
