// Collection goals for screens: a new goal's id, a set's printing as a set goal keeps it, and the
// goals with their progress, worked out again only when the library changes (GoalsUi.tsx, pages/GoalsPage.tsx).

import { useMemo } from 'react'
import { useSync } from '../sync/SyncContext'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { goalProgress, goalsOf, type CollectionGoal, type GoalProgress, type GoalSetCard } from './collectionGoals'

export const newGoalId = () => (crypto.randomUUID ? crypto.randomUUID() : `g${Date.now()}${Math.random().toString(16).slice(2)}`)

const price = (s: string | null | undefined) => {
  const n = s ? Number(s) : NaN
  return Number.isFinite(n) ? n : null
}

/** A set's printing as a set goal keeps it. */
export const goalSetCard = (c: ScryfallCard): GoalSetCard => ({
  id: c.id, name: c.name, rarity: c.rarity ?? null, number: c.collector_number ?? null, imageUrl: displayImageUrl(c),
  usd: price(c.prices?.usd), usdFoil: price(c.prices?.usd_foil),
})

/** The goals and how far each has got, worked out again only when the library changes. */
export function useGoals(): { goals: CollectionGoal[]; progress: (g: CollectionGoal) => GoalProgress } {
  const { collections, decks } = useSync()
  return useMemo(() => {
    const goals = goalsOf(collections)
    const cache = new Map<string, GoalProgress>()
    const progress = (g: CollectionGoal) => {
      const key = `${g.id}:${g.updatedAt}:${g.countDecks ? 1 : 0}`
      let p = cache.get(key)
      if (!p) { p = goalProgress(g, collections, decks); cache.set(key, p) }
      return p
    }
    return { goals, progress }
  }, [collections, decks])
}

