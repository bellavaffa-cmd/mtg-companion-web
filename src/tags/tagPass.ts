// The background tag pass: every card the user has — in binders, the Wishlist and decks (considering
// and sideboards too) — gets its role tags (roleTags.ts) looked up, not only the ones a screen has
// asked about. Run when the browser is idle after the app opens and after the cards change (a sync,
// an import); roleTags.ts saves each 75 found at once and carries on where it stopped. Once, after
// the first full pass, entries saved before keyword tags were kept get theirs, in one change. The
// Android app's data/TagPass.kt (with WorkManager there).

import { useEffect } from 'react'
import { getCollection, type CardIdentifier } from '../api/scryfall'
import { cardTags, type ScryfallCard } from '../types/scryfall'
import type { Collection, Deck, DeckCardEntry } from '../types/models'
import { anyDue, CHUNK, hintIds, isScryfallId, key, requestRefs, type TagRef } from './roleTags'

/** Between requests: the pass shares Scryfall with whatever the user is doing. */
const PAUSE_MS = 250
/** The cards changed: wait this long for more changes before tagging. */
const SETTLE_MS = 5_000

const deckEntries = (d: Deck): DeckCardEntry[] =>
  [...[d.commander, d.partnerCommander].filter((e): e is DeckCardEntry => !!e), ...d.cards, ...(d.considering ?? []), ...(d.sideboard ?? [])]

/** Every card the user has, once a name: binders, the Wishlist, decks — commanders, considering and sideboards too. */
export function refsOf(collections: Collection[], decks: Deck[]): TagRef[] {
  const out = new Map<string, TagRef>()
  const add = (name: string, id: string) => {
    const k = key(name)
    if (!k) return
    const had = out.get(k)
    if (!had || (!had.scryfallId && isScryfallId(id))) out.set(k, { name, scryfallId: isScryfallId(id) ? id : undefined })
  }
  for (const c of collections) for (const e of c.entries) add(e.name, e.scryfallId)
  for (const d of decks) for (const e of deckEntries(d)) add(e.name, e.scryfallId)
  return [...out.values()]
}

// ---- Keyword tags for old entries ----

const BACKFILL_KEY = 'mtgweb_entry_tags_backfill'
/** Bumped to fill in again (say, if cardTags learns new tags). */
const BACKFILL_VERSION = 1

/** The printings (Scryfall ids) with an entry that has no tags. */
export function idsNeedingTags(collections: Collection[], decks: Deck[]): string[] {
  const ids = new Set<string>()
  for (const c of collections) for (const e of c.entries) if (!e.tags?.length && isScryfallId(e.scryfallId)) ids.add(e.scryfallId)
  for (const d of decks) for (const e of deckEntries(d)) if (!e.tags?.length && isScryfallId(e.scryfallId)) ids.add(e.scryfallId)
  return [...ids]
}

/** [collections] with every entry that has no tags given [tagsById]'s for its printing; the same array when none changed. */
export function withFilledTags(collections: Collection[], tagsById: Map<string, string[]>): Collection[] {
  let changedAny = false
  const out = collections.map((c) => {
    if (!c.entries.some((e) => !e.tags?.length && tagsById.get(e.scryfallId)?.length)) return c
    changedAny = true
    return { ...c, entries: c.entries.map((e) => (!e.tags?.length && tagsById.get(e.scryfallId)?.length ? { ...e, tags: tagsById.get(e.scryfallId)! } : e)) }
  })
  return changedAny ? out : collections
}

/** [decks] with every entry that has no tags given [tagsById]'s; the same array when none changed. */
export function decksWithFilledTags(decks: Deck[], tagsById: Map<string, string[]>): Deck[] {
  const fill = (e: DeckCardEntry): DeckCardEntry => (!e.tags?.length && tagsById.get(e.scryfallId)?.length ? { ...e, tags: tagsById.get(e.scryfallId)! } : e)
  let changedAny = false
  const out = decks.map((d) => {
    if (!deckEntries(d).some((e) => !e.tags?.length && tagsById.get(e.scryfallId)?.length)) return d
    changedAny = true
    return {
      ...d,
      commander: d.commander && fill(d.commander),
      partnerCommander: d.partnerCommander && fill(d.partnerCommander),
      cards: d.cards.map(fill),
      ...(d.considering ? { considering: d.considering.map(fill) } : {}),
      ...(d.sideboard ? { sideboard: d.sideboard.map(fill) } : {}),
    }
  })
  return changedAny ? out : decks
}

/**
 * Fetches the cards behind [ids] (75 a request, through [fetchCards]) and answers each one's keyword
 * tags by id. Null if a request failed — nothing is written then, and it's tried again next time.
 */
export async function tagsById(ids: string[], fetchCards: (ids: CardIdentifier[]) => Promise<{ data: ScryfallCard[] }>): Promise<Map<string, string[]> | null> {
  const out = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    try {
      const { data } = await fetchCards(ids.slice(i, i + CHUNK).map((id) => ({ id })))
      for (const card of data) out.set(card.id, cardTags(card))
    } catch {
      return null
    }
  }
  return out
}

const backfillDone = () => { try { return Number(localStorage.getItem(BACKFILL_KEY) ?? 0) >= BACKFILL_VERSION } catch { return false } }

let backfilling = false
/** Fills in the missing keyword tags once, through [change] (one change for binders and decks together). */
async function backfillOnce(
  collections: Collection[],
  decks: Deck[],
  change: (fn: (collections: Collection[], decks: Deck[]) => { collections: Collection[]; decks: Deck[] }) => void,
) {
  if (backfilling || backfillDone()) return
  backfilling = true
  try {
    const ids = idsNeedingTags(collections, decks)
    if (ids.length) {
      const tags = await tagsById(ids, getCollection)
      if (!tags) return // offline: next time
      // Applied to the cards as they are by then.
      if ([...tags.values()].some((t) => t.length)) change((c, d) => ({ collections: withFilledTags(c, tags), decks: decksWithFilledTags(d, tags) }))
    }
    try { localStorage.setItem(BACKFILL_KEY, String(BACKFILL_VERSION)) } catch { /* done again next visit */ }
  } finally {
    backfilling = false
  }
}

const idle = (fn: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 10_000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(fn, 1_000)
  return () => window.clearTimeout(id)
}

/**
 * Runs the pass for [collections] and [decks]: a few seconds after they last changed, when the
 * browser is idle. Mounted once, near the top of the app.
 */
export function useTagPass(
  collections: Collection[],
  decks: Deck[],
  change: (fn: (collections: Collection[], decks: Deck[]) => { collections: Collection[]; decks: Deck[] }) => void,
): void {
  useEffect(() => {
    let cancelIdle: (() => void) | null = null
    const settle = window.setTimeout(() => {
      cancelIdle = idle(() => {
        const refs = refsOf(collections, decks)
        hintIds(refs)
        if (anyDue(refs)) requestRefs(refs, { pauseMs: PAUSE_MS })
        if (!backfillDone()) void backfillOnce(collections, decks, change)
      })
    }, SETTLE_MS)
    return () => { window.clearTimeout(settle); cancelIdle?.() }
  }, [collections, decks, change])
}
