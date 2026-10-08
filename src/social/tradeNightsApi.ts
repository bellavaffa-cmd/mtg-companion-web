// Trade nights: calls to the server functions in
// MtgCompanionApp/supabase/migrations/20261008100000_trade_nights.sql. The rules behind the screen
// are in tradeNights.ts. The Android app's twin is data/social/TradeNightsApi.kt.
//
// Until that migration is applied the functions aren't there: tradeNightsAvailable() says so, and a
// game night simply has no Trades section.

import { useEffect, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { call, SocialError, type TradeCard } from './api'
import { parseTradeNight, type NightCard, type NightSource, type NightWant } from './tradeNights'

let probe: Promise<boolean> | null = null

/** Whether the server has these functions. Asked once per page load (again after a failed ask). */
export function tradeNightsAvailable(): Promise<boolean> {
  if (!probe) {
    probe = call<number>('trade_nights_version')
      .then((v) => typeof v === 'number' && v >= 1)
      .catch((e: unknown) => {
        if (e instanceof SocialError && e.code === 'unavailable') return false
        probe = null // offline or signed out: ask again next time
        return false
      })
  }
  return probe
}

/** The same, for a screen: null while asking. False when signed out. */
export function useTradeNightsAvailable(): boolean | null {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [state, setState] = useState<{ user: string | null; ok: boolean } | null>(null)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void tradeNightsAvailable().then((ok) => { if (!cancelled) setState({ user: userId, ok }) })
    return () => { cancelled = true }
  }, [userId])
  if (!userId) return false
  return state && state.user === userId ? state.ok : null
}

/** The trade side of a night for the user, or null when they aren't invited. */
export const tradeNight = (nightId: string) => call<unknown>('trade_night', { p_night: nightId }).then(parseTradeNight)

/** Puts up (or replaces) the user's list for the night; answers the night's trade side. */
export const setTradeNightList = (nightId: string, sources: NightSource[], cards: NightCard[], wants: NightWant[]) =>
  call<unknown>('set_trade_night_list', { p_night: nightId, p_sources: sources, p_cards: cards, p_wants: wants }).then(parseTradeNight)

/** Takes the user's list for the night down. */
export const stopTradeNightList = (nightId: string) => call<null>('stop_trade_night_list', { p_night: nightId })

/** Proposes a trade to someone at the night (they needn't be a friend); answers its id. */
export const proposeNightTrade = (nightId: string, to: string, want: TradeCard[], give: TradeCard[], message: string) =>
  call<string>('propose_night_trade', { p_night: nightId, p_to: to, p_want: want, p_give: give, p_message: message || null })
