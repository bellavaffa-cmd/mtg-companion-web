// Upkeep as it stands (upkeep.ts), worked out from this browser's pull lists, last import, game
// nights and noted prices. The Android app's rememberUpkeep (ui/collection/UpkeepScreen.kt).

import { useEffect, useMemo, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { gameNights } from '../lifecounter/gameNightStore'
import { currentMoney } from '../money/currency'
import type { PriceTrack } from './cardPriceHistory'
import { dayOf } from './copyHistoryStore'
import { loadPriceHistory } from './priceHistoryStore'
import { pullsUnderway } from './pullProgress'
import { priceFromHistory, upkeep, type UpkeepReport } from './upkeep'
import { lastImport } from './upkeepStore'

export function useUpkeep(): UpkeepReport {
  const { collections, decks } = useSync()
  const [tracks, setTracks] = useState<Map<string, PriceTrack> | null>(null)
  useEffect(() => {
    let live = true
    void loadPriceHistory().then((t) => { if (live) setTracks(t) })
    return () => { live = false }
  }, [])
  return useMemo(() => {
    const now = Date.now()
    return upkeep({
      collections,
      decks,
      now,
      today: dayOf(now),
      nights: gameNights().nights.map((n) => ({ at: n.at, day: dayOf(n.at) })),
      pulls: pullsUnderway(),
      lastImport: lastImport(),
      price: priceFromHistory(tracks ?? new Map()),
      money: (usd) => currentMoney().format(usd, true),
    })
  }, [collections, decks, tracks])
}
