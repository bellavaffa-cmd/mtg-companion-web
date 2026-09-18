import { primaryType, type ScryfallCard } from '../types/scryfall'

// Scryfall sends `Access-Control-Allow-Origin: *` on every response (verified live) so this can
// call the API directly from the browser with no proxy. Still identify the app per their API
// etiquette guidelines, same User-Agent string the Android app uses.
const BASE = 'https://api.scryfall.com'
const HEADERS = { 'User-Agent': 'MtgCompanionWeb/1.0 (+https://github.com/mtgcompanion)' }

/** A request that never reached Scryfall (no connection, DNS, blocked) rather than one it refused. */
export class OfflineError extends Error {
  constructor(message = "You're offline — this needs a connection to Scryfall.") {
    super(message)
  }
}

/** fetch(), with a dropped connection turned into a message worth showing someone. */
async function get(url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { headers: HEADERS, ...init })
  } catch {
    throw new OfflineError()
  }
}

export interface SearchPage {
  cards: ScryfallCard[]
  hasMore: boolean
}

export async function searchCards(query: string, page = 1, order?: string, dir?: 'asc' | 'desc'): Promise<SearchPage> {
  if (!query.trim()) return { cards: [], hasMore: false }
  const url = new URL(`${BASE}/cards/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('page', String(page))
  if (order) url.searchParams.set('order', order)
  if (order && dir) url.searchParams.set('dir', dir)
  const res = await get(url)
  if (res.status === 404) return { cards: [], hasMore: false }
  if (!res.ok) throw new Error(`Scryfall search failed (${res.status})`)
  const json = await res.json()
  return { cards: json.data ?? [], hasMore: Boolean(json.has_more) }
}

export async function autocomplete(query: string): Promise<string[]> {
  if (!query.trim()) return []
  const url = new URL(`${BASE}/cards/autocomplete`)
  url.searchParams.set('q', query)
  const res = await get(url)
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? []
}

/** The card with exactly [name] (a double-faced card's full "Front // Back" name works too). */
export async function getByExactName(name: string): Promise<ScryfallCard> {
  const url = new URL(`${BASE}/cards/named`)
  url.searchParams.set('exact', name)
  const res = await get(url)
  if (!res.ok) throw new Error(`No card named "${name}"`)
  return res.json()
}

export async function getByFuzzyName(name: string): Promise<ScryfallCard> {
  const url = new URL(`${BASE}/cards/named`)
  url.searchParams.set('fuzzy', name)
  const res = await get(url)
  if (!res.ok) throw new Error(`No match for "${name}"`)
  return res.json()
}

export interface Ruling {
  source: string
  published_at: string
  comment: string
}

/** The official rulings for the card that best matches [name], oldest first as Scryfall lists them. */
export async function getRulings(name: string): Promise<{ card: ScryfallCard; rulings: Ruling[] }> {
  const card = await getByFuzzyName(name)
  const res = await get(`${BASE}/cards/${card.id}/rulings`)
  if (!res.ok) throw new Error(`Scryfall couldn't send the rulings (HTTP ${res.status}).`)
  const json = await res.json()
  return { card, rulings: (json.data ?? []) as Ruling[] }
}

/** Bulk lookup by Scryfall id, batched into /cards/collection's 75-per-request limit. */
/**
 * The cards for [ids], fetched 75 at a time. A batch that fails is left out — unless [strict], when
 * it throws instead, for callers where a partial list would quietly produce something incomplete.
 */
export async function getCardsByIds(ids: string[], strict = false): Promise<ScryfallCard[]> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return []
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 75) chunks.push(unique.slice(i, i + 75))
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await get(`${BASE}/cards/collection`, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
      })
      if (!res.ok) {
        if (strict) throw new Error(`Scryfall couldn't send every card (HTTP ${res.status}). Try again in a moment.`)
        return []
      }
      const json = await res.json()
      return (json.data ?? []) as ScryfallCard[]
    }),
  )
  return results.flat()
}

export async function getRandomCard(): Promise<ScryfallCard> {
  const res = await get(`${BASE}/cards/random`)
  if (!res.ok) throw new Error('Random card lookup failed')
  return res.json()
}

/**
 * A rough "similar cards" list: same primary type, same colors, and (for non-lands) a mana value
 * within 1 of this card's — Scryfall has no native similarity search, so this is a heuristic query
 * built from the card's own attributes, sorted by EDHREC popularity. Excludes every printing of
 * this card itself. Empty for cards whose type doesn't map to a known primary type.
 */
export async function findSimilarCards(card: ScryfallCard, limit = 12): Promise<ScryfallCard[]> {
  const type = primaryType(card)
  if (type === 'Other') return []
  const parts = [`t:${type}`]
  if (type === 'Land') {
    if (card.produced_mana?.length) parts.push(`produces:${card.produced_mana.join('').toLowerCase()}`)
  } else {
    parts.push(`c:${card.colors?.length ? card.colors.join('').toLowerCase() : 'c'}`)
    if (card.cmc != null) {
      parts.push(`mv>=${Math.max(0, Math.floor(card.cmc - 1))}`)
      parts.push(`mv<=${Math.floor(card.cmc + 1)}`)
    }
  }
  const { cards } = await searchCards(parts.join(' '), 1, 'edhrec')
  const excludeId = card.oracle_id ?? card.id
  return cards.filter((c) => (c.oracle_id ?? c.id) !== excludeId).slice(0, limit)
}
