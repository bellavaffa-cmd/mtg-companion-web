import { useEffect, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import type { Deck } from '../types/models'
import { sortColors } from './kit'

const CACHE_KEY = 'mtgweb_color_identity'

function loadCache(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * deckId -> commander (+ partner) colour identity, for identity strips and pips. Deck entries don't
 * cache colours, so commanders are looked up once on Scryfall and remembered in this browser.
 * Mirrors HomeViewModel.deckColors.
 */
export function useDeckColors(decks: Deck[]): Record<string, string[]> {
  const [byCard, setByCard] = useState<Record<string, string[]>>(loadCache)

  const commanderIds = decks.flatMap((d) => [d.commander?.scryfallId, d.partnerCommander?.scryfallId]).filter((id): id is string => !!id)
  const missingKey = commanderIds.filter((id) => !(id in byCard)).sort().join(',')

  useEffect(() => {
    if (!missingKey) return
    let cancelled = false
    getCardsByIds(missingKey.split(','))
      .then((cards) => {
        if (cancelled || cards.length === 0) return
        setByCard((prev) => {
          const next = { ...prev }
          cards.forEach((c) => { next[c.id] = c.color_identity ?? [] })
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)) } catch { /* storage full: keep in memory */ }
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [missingKey])

  const result: Record<string, string[]> = {}
  decks.forEach((d) => {
    const main = d.commander ? byCard[d.commander.scryfallId] : undefined
    if (!main) return
    const partner = d.partnerCommander ? byCard[d.partnerCommander.scryfallId] ?? [] : []
    result[d.id] = sortColors([...main, ...partner])
  })
  return result
}
