import { useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { useMoney } from '../money/currency'
import { runningSeason, seasonTable } from '../decks/league'
import { useSync } from '../sync/SyncContext'
import * as api from './api'
import * as more from './more'
import { friendsWantFromYou, peopleLine, podLine, wantFromYouLine, type WantFromYou } from './friendsHub'
import { tradeMatchesCached } from './TradeValue'
import type { PriceBook } from './tradeFairness'

// Pieces of the Friends tab (friendsHub.ts has their logic): two-way trade matches shared by People
// and Trades, what friends want from the user across all binders, and the Your pods row with each
// pod's running league season. The Android app's twin is ui/social/FriendsHubUi.kt.

/** Two-way trade matches with friends (asked once a minute at most); empty without social_more. */
export function useTradeMatches(overview: api.Overview): more.TradeMatch[] {
  const available = more.useSocialMore()
  const [matches, setMatches] = useState<more.TradeMatch[]>([])
  useEffect(() => {
    if (!available) return
    let cancelled = false
    void tradeMatchesCached().then((m) => { if (!cancelled) setMatches(m) })
    return () => { cancelled = true }
  }, [available, overview])
  return useMemo(() => matches.filter((m) => overview.people[m.friend]), [matches, overview])
}

/** What friends want from the user across all binders, priced at today's prices once they're in. */
export function useWantsFromYou(overview: api.Overview): WantFromYou[] {
  const { collections } = useSync()
  const matches = useTradeMatches(overview)
  const key = [...new Set(matches.flatMap((m) => m.they_want.map((c) => c.scryfallId)))].sort().join(',')
  const [prices, setPrices] = useState<PriceBook>(new Map())
  useEffect(() => {
    if (!key) return
    let cancelled = false
    getCardsByIds(key.split(','))
      .then((list) => {
        if (cancelled) return
        setPrices(new Map(list.map((c) => [c.id, {
          usd: c.prices?.usd ? Number(c.prices.usd) : null,
          foil: c.prices?.usd_foil ? Number(c.prices.usd_foil) : null,
        }])))
      })
      .catch(() => {}) // No prices: the lines go without a value.
    return () => { cancelled = true }
  }, [key])
  return useMemo(() => {
    const names = new Map(collections.map((c) => [c.id, c.name]))
    return friendsWantFromYou(matches, (id) => names.get(id), prices)
  }, [matches, prices, collections])
}

/** A pod's running league season and the user's place in it; [season] null when none is running. */
export interface PodLeague { season: string | null; rank: number | null }

/** Each pod's league (decks/league.ts), by pod id; a pod whose seasons can't be loaded is left out. */
export function usePodLeagues(pods: api.Pod[], me: string): Record<string, PodLeague> {
  const [leagues, setLeagues] = useState<Record<string, PodLeague>>({})
  const ids = pods.map((p) => p.id).join(',')
  useEffect(() => {
    if (!ids) return
    let cancelled = false
    void (async () => {
      const out: Record<string, PodLeague> = {}
      for (const id of ids.split(',')) {
        try {
          const season = runningSeason(await api.podSeasons(id))
          out[id] = season
            ? { season: season.name, rank: seasonTable(season, await api.podGames(id)).standings.find((s) => s.userId === me)?.rank ?? null }
            : { season: null, rank: null }
        } catch {
          // Leagues not on the server yet, or offline: the pod shows its people only.
        }
      }
      if (!cancelled) setLeagues(out)
    })()
    return () => { cancelled = true }
  }, [ids, me])
  return leagues
}

/** Your pods, side by side: each pod's name and "5 people · Season 2 · you're 2nd". */
export function PodsRow({ pods, leagues, onOpen, onPlan, onEdit }: {
  pods: api.Pod[]
  leagues: Record<string, PodLeague>
  onOpen: (pod: api.Pod) => void
  /** Plan a game night for the pod, under its line (when given). */
  onPlan?: (pod: api.Pod) => void
  /** The pod's members to edit, under its line (when given). */
  onEdit?: (pod: api.Pod) => void
}) {
  return (
    <div className="pods-row">
      {pods.map((pod) => {
        const league = leagues[pod.id]
        const line = league ? podLine(pod.members.length, league.season, league.rank) : peopleLine(pod.members.length)
        if (!onPlan && !onEdit) {
          return (
            <button key={pod.id} type="button" className="pod-card press" onClick={() => onOpen(pod)}>
              <b>{pod.name}</b>
              <span>{line}</span>
            </button>
          )
        }
        return (
          <div key={pod.id} className="pod-card with-links">
            <button type="button" className="pod-card-open press" onClick={() => onOpen(pod)}>
              <b>{pod.name}</b>
              <span>{line}</span>
            </button>
            <span className="pod-card-links">
              {onPlan && <button type="button" className="link" onClick={() => onPlan(pod)}>Plan a game night</button>}
              {onEdit && <button type="button" className="link muted-link" onClick={() => onEdit(pod)}>Members</button>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** What friends want from you: a line per friend (cards, where, value) and Make offers. */
export function WantsFromYouCard({ overview, wants, onOpen }: { overview: api.Overview; wants: WantFromYou[]; onOpen: (match: more.TradeMatch) => void }) {
  const money = useMoney()
  return (
    <div className="wants-card">
      {wants.slice(0, 6).map((w) => (
        <button key={w.friend} type="button" className="wants-line press" onClick={() => onOpen(w.match)}>
          <span className="wants-who">{wantFromYouLine(overview.people[w.friend]?.display_name ?? 'A friend', w.cards)}</span>
          {w.where && <span className="dim wants-where">{w.where}</span>}
          {w.value != null && <b>{money.format(w.value, true)}</b>}
        </button>
      ))}
      {/* Make offers starts with the friend who wants the most; each line starts its own. */}
      <button type="button" className="link wants-offers" onClick={() => { if (wants[0]) onOpen(wants[0].match) }}>Make offers</button>
    </div>
  )
}
