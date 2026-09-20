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

/**
 * Scryfall's hard rate limits (scryfall.com/docs/api/rate-limits): card searches, named and random
 * lookups and /cards/collection at most 2 a second, everything else 10 a second. A 429 locks the
 * app out for 30 seconds — and ignoring it risks a ban — so after one every request waits the
 * lockout out. The Android app does the same (network/ScryfallPacer.kt).
 */
const SLOW_PATHS = ['/cards/search', '/cards/named', '/cards/random', '/cards/collection']
const SLOW_GAP_MS = 550
const FAST_GAP_MS = 110
const LOCKOUT_MS = 31_000
let nextSlow = 0
let nextFast = 0
let blockedUntil = 0

/** Waits for this request's turn: its endpoint's spacing, and any lockout. */
async function waitTurn(path: string) {
  const slow = SLOW_PATHS.some((p) => path.startsWith(p))
  const now = Date.now()
  const start = Math.max(now, blockedUntil, slow ? nextSlow : nextFast)
  if (slow) nextSlow = start + SLOW_GAP_MS
  else nextFast = start + FAST_GAP_MS
  if (start > now) await new Promise((r) => setTimeout(r, start - now))
}

/**
 * fetch(), paced to Scryfall's limits, with a dropped connection turned into a message worth
 * showing someone. A request refused with 429 is asked once more, after the lockout.
 */
async function get(url: string | URL, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname
  for (let attempt = 0; ; attempt++) {
    await waitTurn(path)
    let res: Response
    try {
      res = await fetch(url, { headers: HEADERS, ...init })
    } catch {
      throw new OfflineError()
    }
    if (res.status !== 429 || attempt > 0) return res
    blockedUntil = Math.max(blockedUntil, Date.now() + LOCKOUT_MS)
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

/** One exact printing, by its set code and collector number (as printed at the bottom of a card). */
export async function getBySetAndNumber(set: string, number: string): Promise<ScryfallCard> {
  const res = await get(`${BASE}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`)
  if (!res.ok) throw new Error(`No card ${set.toUpperCase()} #${number}`)
  return res.json()
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

/** Which card a collection lookup asks for: by id, by printing (set + number), or by name (optionally in a set). */
export interface CardIdentifier {
  id?: string
  name?: string
  set?: string
  collector_number?: string
}

/**
 * Up to 75 cards in one request (POST /cards/collection): [data] are the cards found, [not_found]
 * the identifiers that weren't. A rate limit is waited out and tried again.
 */
export async function getCollection(identifiers: CardIdentifier[]): Promise<{ data: ScryfallCard[]; not_found: CardIdentifier[] }> {
  for (let attempt = 0; ; attempt++) {
    const res = await get(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    })
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`Scryfall couldn't look those cards up (HTTP ${res.status}). Try again in a moment.`)
    const json = await res.json()
    return { data: json.data ?? [], not_found: json.not_found ?? [] }
  }
}

/**
 * Every printing of a card, newest first — the alternate arts, the borderless one, the Secret Lair.
 * Empty when Scryfall knows no such card.
 */
/** Pages of printings to follow at most. A basic land runs to five; nothing runs to ten. */
const MOST_PRINTING_PAGES = 10

export async function getPrintings(name: string): Promise<ScryfallCard[]> {
  const query = new URLSearchParams({ q: `!"${name}"`, unique: 'prints', order: 'released', dir: 'desc' })
  let next: string | null = `${BASE}/cards/search?${query}`
  const all: ScryfallCard[] = []
  // Scryfall answers 175 printings at a time; a basic land has hundreds of them.
  for (let page = 0; next && page < MOST_PRINTING_PAGES; page++) {
    const res = await get(next)
    if (!res.ok) break
    const json = await res.json()
    all.push(...((json.data ?? []) as ScryfallCard[]))
    next = json.has_more ? (json.next_page as string) : null
  }
  return all
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
