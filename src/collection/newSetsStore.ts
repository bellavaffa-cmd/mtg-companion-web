// Where New sets keeps its bits in this browser: the sets followed, the ones already announced, and
// Scryfall's set data, kept a while so opening the app doesn't ask again each time — the release list
// for 12 hours, a set's cards for this visit (12 hours at most). Requests go through api/scryfall.ts,
// paced to Scryfall's limits. Mirrors the Android app's NewSetsStore (data/NewSetsStore.kt).

import { useEffect, useState } from 'react'
import { getCardsByIds, getSets, searchCards } from '../api/scryfall'
import { cardTags, displayImageUrl, displayOracleText, type ScryfallCard } from '../types/scryfall'
import { cachedTags, tagLabel, tagsFor } from '../tags/roleTags'
import type { Deck } from '../types/models'
import type { SetInfo } from './setCompletion'
import { addDays, commanderDecks, deckProfile, listable, releaseSets, setsToAnnounce, type DeckProfile, type SetCard } from './newSets'
import { fitsByCard, mayTellReveals, revealNews } from './spoilers'
import { today } from './valueHistory'

const FOLLOWED_KEY = 'mtgweb_followed_sets'
const TOLD_KEY = 'mtgweb_sets_told'
const SETS_KEY = 'mtgweb_release_sets'
const REVEALS_SEEN_KEY = 'mtgweb_reveals_seen'
const REVEALS_TOLD_KEY = 'mtgweb_reveals_told_at'
const FRESH_MS = 12 * 60 * 60 * 1000
/** Pages of a set's cards to read at most: 175 a page, so a big set and its extras. */
const MAX_PAGES = 6

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

function readSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]) } catch { return new Set() }
}
function writeSet(key: string, value: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...value])) } catch { /* this visit only */ }
}

let followed = readSet(FOLLOWED_KEY)
let told = readSet(TOLD_KEY)

export const isFollowed = (code: string) => followed.has(code)

/**
 * Follow or stop following [set]: a followed set is announced when it comes out — one already out
 * isn't announced (it's no news).
 */
export function setFollowed(set: SetInfo, on: boolean) {
  followed = new Set(followed)
  if (on) followed.add(set.code)
  else followed.delete(set.code)
  writeSet(FOLLOWED_KEY, followed)
  if (on && (set.releasedAt ?? '') <= today()) {
    told = new Set([...told, set.code])
    writeSet(TOLD_KEY, told)
  }
  changed()
}

/** The banner for [codes] closed: they're not announced again. */
export function markTold(codes: string[]) {
  told = new Set([...told, ...codes])
  writeSet(TOLD_KEY, told)
  changed()
}

/** Re-renders when a set is followed or announced. */
export function useFollowed(): { followed: Set<string>; told: Set<string> } {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return { followed, told }
}

/**
 * The sets worth listing — out in the last two months or still to come — from Scryfall, or as kept
 * from the last 12 hours.
 */
export async function loadReleaseSets(): Promise<SetInfo[]> {
  try {
    const kept = JSON.parse(localStorage.getItem(SETS_KEY) ?? 'null') as { at: number; sets: SetInfo[] } | null
    if (kept && Date.now() - kept.at < FRESH_MS && Array.isArray(kept.sets)) return kept.sets
  } catch { /* ask again */ }
  const since = addDays(today(), -60)
  const sets = [...(await getSets()).values()].filter((s) => listable(s) && (s.releasedAt ?? '') > since)
  try { localStorage.setItem(SETS_KEY, JSON.stringify({ at: Date.now(), sets })) } catch { /* this visit only */ }
  return sets
}

/** [card] as the matching keeps it — with the role tags its rules text shows (Tagger hasn't tagged a new card yet). */
export function setCardOf(card: ScryfallCard): SetCard {
  return {
    id: card.id, name: card.name, typeLine: card.type_line ?? '', colorIdentity: card.color_identity ?? [], tags: cardTags(card),
    imageUrl: displayImageUrl(card), rarity: card.rarity ?? null,
    roles: tagsFor(undefined, displayOracleText(card) ?? '', new Map()).map(tagLabel),
    releasedAt: card.released_at ?? null,
    usd: card.prices?.usd ?? null,
    commanderLegality: card.legalities?.commander ?? null,
  }
}

const cardsCache = new Map<string, { at: number; cards: SetCard[] }>()

/**
 * The cards Scryfall has for [code] so far — every printing (showcase frames and all), no basic
 * lands — the most recently revealed first.
 */
export async function loadSetCards(code: string): Promise<SetCard[]> {
  const kept = cardsCache.get(code)
  if (kept && Date.now() - kept.at < FRESH_MS) return kept.cards
  const cards: SetCard[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await searchCards(`e:${code.toLowerCase()} -t:basic`, page, 'spoiled', 'desc', 'prints')
    cards.push(...result.cards.map(setCardOf))
    if (!result.hasMore) break
  }
  cardsCache.set(code, { at: Date.now(), cards })
  return cards
}

/** Each deck's commanders' colour identity together, by deck id (one request for them all). */
export async function commanderIdentities(decks: Deck[]): Promise<Map<string, string[]>> {
  const ids = decks.flatMap((d) => [d.commander?.scryfallId, d.partnerCommander?.scryfallId]).filter((id): id is string => !!id)
  const byId = new Map((await getCardsByIds(ids)).map((c) => [c.id, c.color_identity ?? []]))
  const out = new Map<string, string[]>()
  for (const d of decks) {
    const main = d.commander ? byId.get(d.commander.scryfallId) : undefined
    // A commander Scryfall didn't send can't be checked: the deck is left out.
    if (!main) continue
    const partner = d.partnerCommander ? byId.get(d.partnerCommander.scryfallId) ?? [] : []
    out.set(d.id, [...new Set([...main, ...partner])])
  }
  return out
}

/** Followed sets out now that haven't been announced: Home's banner. Empty while it's worked out, or offline. */
export function useSetsToAnnounce(): SetInfo[] {
  const { followed: f, told: t } = useFollowed()
  const [sets, setSets] = useState<SetInfo[]>([])
  useEffect(() => {
    if (f.size === 0) { setSets([]); return }
    let cancelled = false
    loadReleaseSets()
      .then((all) => { if (!cancelled) setSets(setsToAnnounce(f, all, today(), t)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [f, t])
  return sets
}

/** The Collection home's New sets line: "2 coming soon · 1 just out", and how many followed sets are out. */
export function useNewSetsLine(): { line: string; out: number } {
  const { followed: f, told: t } = useFollowed()
  const [all, setAll] = useState<SetInfo[] | null>(null)
  useEffect(() => {
    let cancelled = false
    loadReleaseSets().then((s) => { if (!cancelled) setAll(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (!all) return { line: "What's coming, and cards for your decks", out: 0 }
  const now = today()
  const { upcoming, recent } = releaseSets(all, now)
  const parts = [upcoming.length > 0 && `${upcoming.length} coming soon`, recent.length > 0 && `${recent.length} just out`].filter(Boolean)
  return { line: parts.length > 0 ? parts.join(' · ') : 'No new sets right now', out: setsToAnnounce(f, all, now, t).length }
}

/** A deck's profile for matching, with its cards' role tags where they've been looked up (tags/roleTags.ts). */
export const profileOf = (deck: Deck, identity: string[]): DeckProfile =>
  deckProfile(deck, identity, (name) => cachedTags(name)?.map(tagLabel))

function readSeen(): Record<string, string[]> {
  try { return (JSON.parse(localStorage.getItem(REVEALS_SEEN_KEY) ?? '{}') as Record<string, string[]>) ?? {} } catch { return {} }
}

/** The revealed cards (ids) already seen that fit a deck, by set: what's new is told (revealNews). */
export function revealsSeen(code: string): Set<string> | null {
  const list = readSeen()[code]
  return Array.isArray(list) ? new Set(list) : null
}

/** [ids] seen for [code] — on its page, or told in Home's banner. */
export function markRevealsSeen(code: string, ids: Iterable<string>) {
  const all = readSeen()
  const had = new Set(all[code] ?? [])
  const before = had.size
  for (const id of ids) had.add(id)
  if (all[code] && had.size === before) return
  all[code] = [...had]
  try { localStorage.setItem(REVEALS_SEEN_KEY, JSON.stringify(all)) } catch { /* this visit only */ }
}

function revealsToldAt(): number | null {
  const at = Number(localStorage.getItem(REVEALS_TOLD_KEY) ?? 0)
  return at > 0 ? at : null
}

/** One followed set's newly revealed cards that fit the user's decks. */
export interface RevealNewsItem { set: SetInfo; count: number }

/**
 * Home's spoiler news: followed sets not out yet (or just out) with cards revealed since last time
 * that fit one of [decks] — worked out once a day at most (the Android app's notification). A set
 * looked at for the first time only notes what's there. Empty while it's worked out, or offline.
 */
export function useRevealNews(decks: Deck[]): { news: RevealNewsItem[]; dismiss: () => void } {
  const { followed: f } = useFollowed()
  const [news, setNews] = useState<RevealNewsItem[]>([])
  const commander = commanderDecks(decks)
  const commanderKey = commander.map((d) => `${d.id}:${d.commander?.scryfallId}:${d.partnerCommander?.scryfallId ?? ''}`).join(',')
  useEffect(() => {
    if (f.size === 0 || commander.length === 0 || !mayTellReveals(revealsToldAt(), Date.now())) return
    let cancelled = false
    ;(async () => {
      const now = today()
      const { upcoming, recent } = releaseSets(await loadReleaseSets(), now)
      const watched = [...upcoming, ...recent].filter((s) => f.has(s.code) && s.cardCount > 0)
      if (watched.length === 0) return
      const identities = await commanderIdentities(commander)
      const profiles = commander.flatMap((d) => { const id = identities.get(d.id); return id ? [profileOf(d, id)] : [] })
      const fitting: [SetInfo, string[]][] = []
      for (const set of watched) fitting.push([set, [...fitsByCard(await loadSetCards(set.code), profiles, now).keys()]])
      // Left before it was worked out: nothing is marked seen, so the next visit tells it.
      if (cancelled) return
      const out: RevealNewsItem[] = []
      for (const [set, ids] of fitting) {
        const fresh = revealNews(revealsSeen(set.code), ids)
        markRevealsSeen(set.code, ids)
        if (fresh.length > 0) out.push({ set, count: fresh.length })
      }
      if (out.length === 0) return
      try { localStorage.setItem(REVEALS_TOLD_KEY, String(Date.now())) } catch { /* this visit only */ }
      setNews(out)
    })().catch(() => {})
    return () => { cancelled = true }
    // commanderKey stands for the decks' commanders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, commanderKey])
  return { news, dismiss: () => setNews([]) }
}
