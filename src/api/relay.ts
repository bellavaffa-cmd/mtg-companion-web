/**
 * The app's Supabase "api-relay" Edge Function (source: MtgCompanionApp/supabase/functions/api-relay).
 * It fetches the sources a browser can't call directly — Commander Spellbook's API and the news
 * RSS feeds don't allow cross-origin requests. Scryfall, EDHREC and MTGJSON do, and are called directly.
 */

import { cacheKey, cachedCombos, cachedDeckCombos, deckKey, keepCombos, keepDeckCombos } from './comboCache'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Whether this build knows where the relay is (the same settings accounts use). */
export const relayAvailable = !!SUPABASE_URL && !!ANON_KEY

async function relay<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!relayAvailable) throw new Error('Not configured')
  const res = await fetch(`${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/api-relay${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY!,
      Authorization: `Bearer ${ANON_KEY}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`Relay ${path} failed (${res.status})`)
  return res.json() as Promise<T>
}

// ---- News ----

export interface NewsItem { title: string; link: string; source: string; publishedAt: number | null }

const NEWS_CACHE_KEY = 'mtgweb_news'
const NEWS_TTL_MS = 30 * 60 * 1000

/** Latest headlines, newest first; cached in this browser for half an hour. */
export async function fetchNews(): Promise<NewsItem[]> {
  try {
    const cached = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) ?? 'null') as { at: number; items: NewsItem[] } | null
    if (cached && Date.now() - cached.at < NEWS_TTL_MS && cached.items.length > 0) return cached.items
  } catch {
    // Ignore a corrupt cache entry.
  }
  const { items } = await relay<{ items: NewsItem[] }>('/news')
  try {
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ at: Date.now(), items }))
  } catch {
    // Storage unavailable: just don't cache.
  }
  return items
}

// ---- Commander Spellbook combos ----

export interface ComboCard { name: string; imageUriFrontNormal?: string | null; imageUriFrontArtCrop?: string | null }
export interface ComboVariant {
  id: string
  uses: { card: ComboCard; quantity?: number }[]
  produces: { feature: { name: string } }[]
  description?: string | null
  popularity?: number | null
}
export interface DeckCombos { included: ComboVariant[]; almostIncluded: ComboVariant[] }

/**
 * Combos a decklist contains, and those it's exactly one card short of (within its colours). Kept
 * for a week under that exact list, so opening a deck again is instant while an edited deck asks
 * afresh.
 */
export async function findCombosInDeck(commanders: string[], main: string[]): Promise<DeckCombos> {
  const key = deckKey(commanders, main)
  const kept = cachedDeckCombos(key)
  if (kept) return kept
  const started = deckRequests.get(key)
  if (started) return started
  const body = JSON.stringify({
    commanders: commanders.map((card) => ({ card })),
    main: main.map((card) => ({ card })),
  })
  const request = relay<{ results?: { included?: ComboVariant[]; almostIncluded?: ComboVariant[] } }>('/combos/find-my-combos', {
    method: 'POST',
    body,
  })
    .then((res) => {
      const combos = { included: res.results?.included ?? [], almostIncluded: res.results?.almostIncluded ?? [] }
      keepDeckCombos(key, combos)
      return combos
    })
    .finally(() => { deckRequests.delete(key) })
  deckRequests.set(key, request)
  return request
}

/** Deck lookups under way, so two panels asking for the same decklist make one request. */
const deckRequests = new Map<string, Promise<DeckCombos>>()

/** Lookups under way, so two panels asking for the same card make one request. */
const comboRequests = new Map<string, Promise<ComboVariant[]>>()

/**
 * Combos that use [cardName], most popular first. Kept for a week in this browser (see comboCache),
 * since the lookup goes through the relay to Commander Spellbook and takes about a second.
 */
export async function combosUsingCard(cardName: string, limit = 6): Promise<ComboVariant[]> {
  const kept = cachedCombos(cardName)
  if (kept) return kept
  const key = cacheKey(cardName)
  const started = comboRequests.get(key)
  if (started) return started
  const query = new URLSearchParams({ q: `card:"${cardName}"`, limit: String(limit) })
  const request = relay<{ results?: ComboVariant[] }>(`/combos/variants?${query}`)
    .then((res) => {
      const variants = res.results ?? []
      keepCombos(cardName, variants)
      return variants
    })
    .finally(() => { comboRequests.delete(key) })
  comboRequests.set(key, request)
  return request
}

export const comboUrl = (id: string) => `https://commanderspellbook.com/combo/${encodeURIComponent(id)}/`
