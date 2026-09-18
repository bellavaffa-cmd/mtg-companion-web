// Every card name, for matching what the scanner reads: a misread title ("Rhstic Study") still lands on
// the right card, and noise the reader picks up from a card's frame ("———", "EEE") matches nothing.
// Scryfall's catalog of names (about 35,000; ~1 MB, once per visit) indexed by three-letter chunks.

const CATALOG_URL = 'https://api.scryfall.com/catalog/card-names'

/** A read has to share at least this much (Dice similarity of its three-letter chunks) with a name. */
export const MIN_MATCH = 0.5

export interface NameMatch {
  /** The card's full name, as Scryfall writes it ("Delver of Secrets // Insectile Aberration"). */
  name: string
  /** 0..1: how closely the read matched it. */
  score: number
}

export interface NameIndex {
  match(text: string): NameMatch | null
}

/** Letters and digits only, accents off: what's compared. */
export function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

function chunks(s: string): Set<string> {
  const padded = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
  return out
}

/** An index over [names]. A double-faced card is matched by its front face, the name printed on top. */
export function buildNameIndex(names: string[]): NameIndex {
  const byChunk = new Map<string, number[]>()
  const sizes: number[] = []
  names.forEach((name, i) => {
    const grams = chunks(normalizeName(name.split(' // ')[0]))
    sizes.push(grams.size)
    grams.forEach((g) => {
      let list = byChunk.get(g)
      if (!list) byChunk.set(g, (list = []))
      list.push(i)
    })
  })
  return {
    match(text: string): NameMatch | null {
      const query = chunks(normalizeName(text))
      if (query.size < 4) return null
      const shared = new Map<number, number>()
      query.forEach((g) => {
        const list = byChunk.get(g)
        // Chunks in thousands of names ("the", "of ") say little and cost a lot.
        if (list && list.length < 3000) list.forEach((i) => shared.set(i, (shared.get(i) ?? 0) + 1))
      })
      let best = -1
      let bestScore = 0
      shared.forEach((count, i) => {
        const score = (2 * count) / (query.size + sizes[i])
        if (score > bestScore) { bestScore = score; best = i }
      })
      return best < 0 ? null : { name: names[best], score: bestScore }
    },
  }
}

let index: Promise<NameIndex> | null = null

/** The index of every card name, fetched on first use (a failure lets the next call try again). */
export function cardNameIndex(): Promise<NameIndex> {
  index ??= (async () => {
    const response = await fetch(CATALOG_URL)
    if (!response.ok) throw new Error(`Scryfall's list of card names didn't load (HTTP ${response.status}).`)
    const catalog = (await response.json()) as { data: string[] }
    return buildNameIndex(catalog.data)
  })()
  index.catch(() => { index = null })
  return index
}
