import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSync } from '../sync/SyncContext'
import * as api from './api'
import { refreshPush } from './push'
import { socialMoreAvailable, unreadMessages } from './more'
import { nightsAvailable, unreadPodMessages } from './nights'
import { watchDm } from '../sync/realtime'
import { accessToken } from '../sync/supabaseAuth'
import { bumpAreas, useAllAreaChanges } from './liveChanges'
import { DEBOUNCE_MS, inboxOf, inOverview, POLL_MS, SOCIAL_AREAS, socialAreaFor, socialDebounce, type SocialArea } from './live'

interface SocialValue {
  /** Null until loaded (or while signed out). */
  overview: api.Overview | null
  /** Friend requests and trades waiting on the user, for the badge. */
  inbox: api.Inbox
  /** Unread direct messages, for the Friends tab's badge (0 without the social_more functions). */
  unread: number
  /** The Friends page tells the badge what it just read. */
  setUnread: (n: number) => void
  /** Unread pod chat messages (nights.ts), counted with [unread] on the Friends badge and Chats tab. */
  podUnread: number
  setPodUnread: (n: number) => void
  loading: boolean
  /** Why the last load failed, when it did. */
  error: string | null
  /** Reloads everything the Friends screens show. */
  refresh: () => Promise<void>
  /**
   * A change the user makes ([action]: the server call): [optimistic] shows it at once, then the
   * overview reloads from the server (on failure too, putting back what the server has; the error is
   * rethrown). [areas] are marked changed for screens that load them themselves.
   */
  mutate: <T>(action: () => Promise<T>, opts?: { optimistic?: (o: api.Overview) => api.Overview; areas?: SocialArea[] }) => Promise<T>
  /** Shows [change] on the overview at once (badge counts too), before the server confirms it. */
  applyLocal: (change: (o: api.Overview) => api.Overview) => void
  /** How many times each area has changed (live pings, the user's own changes): key loading on it. */
  changes: Readonly<Record<SocialArea, number>>
  /** Marks [areas] changed. */
  bump: (...areas: SocialArea[]) => void
  /** A person the user can see, by id (friends, pod members, people who shared with them…). */
  person: (userId: string) => api.Profile | null
}

const SocialContext = createContext<SocialValue | null>(null)

const NO_INBOX: api.Inbox = { friend_requests: 0, trades: 0 }

/**
 * Friends, pods, shares and trades for the signed-in account, fetched from the server when needed.
 * None of it is stored in the browser, so nothing lingers after signing out.
 */
export function SocialProvider({ children }: { children: ReactNode }) {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [overview, setOverview] = useState<api.Overview | null>(null)
  const [inbox, setInbox] = useState<api.Inbox>(NO_INBOX)
  const [unread, setUnreadState] = useState(0)
  const setUnread = useCallback((n: number) => setUnreadState(Math.max(0, n)), [])
  const [podUnread, setPodUnreadState] = useState(0)
  const setPodUnread = useCallback((n: number) => setPodUnreadState(Math.max(0, n)), [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changes = useAllAreaChanges()
  const bump = bumpAreas
  // Answers for an account that has since signed out must not land.
  const current = useRef(userId)
  current.current = userId
  // Reloads are numbered so a slow one can't land on top of a newer one (or of the user's own change).
  const generation = useRef(0)
  const inFlight = useRef(0)
  const overviewRef = useRef<api.Overview | null>(null)
  overviewRef.current = overview

  useEffect(() => {
    setOverview(null)
    setInbox(NO_INBOX)
    setUnreadState(0)
    setPodUnreadState(0)
    setError(null)
    // A browser already getting notifications keeps its address current, for whoever is signed in.
    if (userId) void refreshPush().catch(() => {})
  }, [userId])

  const refresh = useCallback(async () => {
    const who = current.current
    if (!who) return
    const mine = ++generation.current
    inFlight.current += 1
    setLoading(true)
    try {
      const o = await api.socialOverview()
      if (current.current !== who || generation.current !== mine) return
      overviewRef.current = o
      setOverview(o)
      setError(null)
      if (o.me) setInbox(inboxOf(o, who))
    } catch (e) {
      if (current.current === who && generation.current === mine) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      inFlight.current -= 1
      if (current.current === who) setLoading(inFlight.current > 0)
    }
  }, [])

  const applyLocal = useCallback((change: (o: api.Overview) => api.Overview) => {
    const who = current.current
    const o = overviewRef.current
    if (!who || !o) return
    generation.current += 1 // a reload already on its way would undo this
    const next = change(o)
    overviewRef.current = next
    setOverview(next)
    if (next.me) setInbox(inboxOf(next, who))
  }, [])

  const mutate = useCallback(async <T,>(action: () => Promise<T>, opts: { optimistic?: (o: api.Overview) => api.Overview; areas?: SocialArea[] } = {}): Promise<T> => {
    if (opts.optimistic) applyLocal(opts.optimistic)
    try {
      return await action()
    } finally {
      if (opts.areas?.length) bump(...opts.areas)
      await refresh().catch(() => {})
    }
  }, [applyLocal, bump, refresh])

  // Live: a ping on the user's dm channel reloads its area (debounced); the overview only once a
  // screen has loaded it. The channel reconnects by itself, and everything reloads when it does.
  useEffect(() => {
    if (!userId) return
    const reload = (areas: Set<SocialArea>) => {
      if (current.current !== userId) return
      bump(...areas)
      if ([...areas].some(inOverview) && overviewRef.current) void refresh()
    }
    const debounce = socialDebounce(DEBOUNCE_MS, reload)
    let joined = false
    const stop = watchDm(
      userId,
      accessToken,
      (event, payload) => { const area = socialAreaFor(event, payload); if (area) debounce.add(area) },
      () => { if (joined) SOCIAL_AREAS.forEach(debounce.add); joined = true },
      () => {},
    )
    // Coming back into view (or online): whatever changed meanwhile.
    const back = () => { if (!document.hidden) SOCIAL_AREAS.forEach(debounce.add) }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('online', back)
    return () => {
      stop()
      debounce.cancel()
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('online', back)
    }
  }, [userId, bump, refresh])

  // The badge: checked on start, when the app comes back into view, and every minute while it's open
  // (the overview too, once loaded — a fallback for missed pings).
  useEffect(() => {
    if (!userId) return
    let stopped = false
    const check = () => {
      if (document.hidden) return
      api.socialInbox().then((i) => { if (!stopped && current.current === userId) setInbox(i) }).catch(() => {})
      socialMoreAvailable()
        .then((ok) => (ok ? unreadMessages() : 0))
        .then((n) => { if (!stopped && current.current === userId) setUnreadState(Math.max(0, n)) })
        .catch(() => {})
      nightsAvailable()
        .then((ok) => (ok ? unreadPodMessages() : 0))
        .then((n) => { if (!stopped && current.current === userId) setPodUnreadState(Math.max(0, n)) })
        .catch(() => {})
    }
    const poll = () => {
      check()
      if (!document.hidden && overviewRef.current) void refresh()
    }
    check()
    const timer = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [userId, refresh])

  const person = useCallback((id: string) => (overview?.me?.user_id === id ? overview.me : overview?.people[id] ?? null), [overview])

  const value = useMemo(
    () => ({ overview, inbox, unread, setUnread, podUnread, setPodUnread, loading, error, refresh, mutate, applyLocal, changes, bump, person }),
    [overview, inbox, unread, setUnread, podUnread, setPodUnread, loading, error, refresh, mutate, applyLocal, changes, bump, person],
  )
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
}

export function useSocial(): SocialValue {
  const ctx = useContext(SocialContext)
  if (!ctx) throw new Error('useSocial outside SocialProvider')
  return ctx
}

/**
 * The overview for a screen that shows it: loaded when missing, and — with [fresh] — reloaded each
 * time the screen opens, so a request or trade that arrived meanwhile shows up.
 */
export function useOverview({ fresh = false } = {}) {
  const social = useSocial()
  const { account } = useSync()
  const { overview, refresh } = social
  const userId = account?.userId
  useEffect(() => {
    if (userId && fresh) void refresh()
  }, [userId, fresh, refresh])
  useEffect(() => {
    if (account && !overview && !fresh) void refresh()
  }, [account, overview, fresh, refresh])
  return social
}
