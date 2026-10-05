// Tonight's game night and the one before it (for not repeating its pairings), kept in this
// browser so the night survives a reload. And each deck's estimated bracket, for the suggestions.
// The Android app keeps the same in GameNightStore.kt.

import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { estimateBracket, gameChangersOf } from '../decks/deckAnalysis'
import type { Deck } from '../types/models'
import { NIGHT_STALE_MS, newNight, type GameNight } from './gameNight'

const KEY = 'mtgweb_game_night'

interface Saved { current: GameNight; previous: GameNight | null }

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

const listeners = new Set<() => void>()
let saved: Saved = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    return { current: raw?.current ?? newNight(newId(), Date.now()), previous: raw?.previous ?? null }
  } catch { return { current: newNight(newId(), Date.now()), previous: null } }
})()

function setSaved(next: Saved) {
  saved = next
  try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch { /* this visit only */ }
  listeners.forEach((l) => l())
}

/** Puts [night] in place of tonight's. */
export const saveNight = (night: GameNight) => setSaved({ ...saved, current: night })

/** Changes tonight's night as it stands now — for answers that arrive after a wait. */
export const updateNight = (fn: (night: GameNight) => GameNight) => setSaved({ ...saved, current: fn(saved.current) })

/** A new night with tonight's players; tonight becomes the one before (when its pods were made). */
export function startNewNight() {
  const old = saved.current
  setSaved({ current: newNight(newId(), Date.now(), old), previous: old.pods.length > 0 ? old : saved.previous })
}

/**
 * Tonight's game night and the one before. A night left from another day starts over by itself,
 * with the same players.
 */
export function useGameNight(): { night: GameNight; previous: GameNight | null } {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  useEffect(() => {
    if (Date.now() - saved.current.createdAt > NIGHT_STALE_MS) startNewNight()
  }, [])
  return { night: saved.current, previous: saved.previous }
}

export const newPlayerId = newId

// ---- Each deck's estimated bracket ----

const brackets = new Map<string, number | null>()
const bracketKey = (deck: Deck) => `${deck.id}:${deck.cards.length}`

/** The bracket already estimated for [deck], if it has been. */
export const knownBracket = (deck: Deck): number | null => brackets.get(bracketKey(deck)) ?? null

/**
 * [deck]'s bracket estimated from its Game Changers, as the deck's Stats do (combos aren't asked
 * about here). Looked up once per deck; null when its cards couldn't be (offline).
 */
export async function estimateDeckBracket(deck: Deck): Promise<number | null> {
  const key = bracketKey(deck)
  if (brackets.has(key)) return brackets.get(key) ?? null
  if (deck.cards.length === 0) return null
  const cards = await getCardsByIds(deck.cards.map((c) => c.scryfallId)).catch(() => [])
  if (cards.length === 0) return null
  const bracket = estimateBracket(gameChangersOf(deck.cards, new Map(cards.map((c) => [c.id, c]))).length, 0).bracket
  brackets.set(key, bracket)
  return bracket
}
