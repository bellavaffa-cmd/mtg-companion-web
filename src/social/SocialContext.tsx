import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSync } from '../sync/SyncContext'
import * as api from './api'

interface SocialValue {
  /** Null until loaded (or while signed out). */
  overview: api.Overview | null
  /** Friend requests and trades waiting on the user, for the badge. */
  inbox: api.Inbox
  loading: boolean
  /** Why the last load failed, when it did. */
  error: string | null
  /** Reloads everything the Friends screens show. */
  refresh: () => Promise<void>
  /** A person the user can see, by id (friends, pod members, people who shared with them…). */
  person: (userId: string) => api.Profile | null
}

const SocialContext = createContext<SocialValue | null>(null)

const NO_INBOX: api.Inbox = { friend_requests: 0, trades: 0 }
/** How often the badge checks for new requests and trades while the app is open. */
const INBOX_POLL_MS = 60_000

/**
 * Friends, pods, shares and trades for the signed-in account, fetched from the server when needed.
 * None of it is stored in the browser, so nothing lingers after signing out.
 */
export function SocialProvider({ children }: { children: ReactNode }) {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [overview, setOverview] = useState<api.Overview | null>(null)
  const [inbox, setInbox] = useState<api.Inbox>(NO_INBOX)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Answers for an account that has since signed out must not land.
  const current = useRef(userId)
  current.current = userId

  useEffect(() => {
    setOverview(null)
    setInbox(NO_INBOX)
    setError(null)
  }, [userId])

  const refresh = useCallback(async () => {
    const who = current.current
    if (!who) return
    setLoading(true)
    try {
      const o = await api.socialOverview()
      if (current.current !== who) return
      setOverview(o)
      setError(null)
      if (o.me) {
        setInbox({
          friend_requests: o.friends.filter((f) => f.incoming && f.status === 'pending').length,
          trades: o.trades.filter((t) => (t.to_user === who && t.status === 'open')
            || (t.status === 'accepted' && (t.from_user === who ? !t.from_applied : !t.to_applied))).length,
        })
      }
    } catch (e) {
      if (current.current === who) setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (current.current === who) setLoading(false)
    }
  }, [])

  // The badge: checked on start, when the app comes back into view, and every minute while it's open.
  useEffect(() => {
    if (!userId) return
    let stopped = false
    const check = () => {
      if (document.hidden) return
      api.socialInbox().then((i) => { if (!stopped && current.current === userId) setInbox(i) }).catch(() => {})
    }
    check()
    const timer = window.setInterval(check, INBOX_POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [userId])

  const person = useCallback((id: string) => (overview?.me?.user_id === id ? overview.me : overview?.people[id] ?? null), [overview])

  const value = useMemo(() => ({ overview, inbox, loading, error, refresh, person }), [overview, inbox, loading, error, refresh, person])
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
