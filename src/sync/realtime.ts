// Live updates from Supabase Realtime: while a tab is open, it hears as soon as another device saves
// one of this account's decks or binders, and syncs then instead of at its next check. Plain
// WebSocket speaking Realtime's Phoenix protocol (JSON messages), no SDK. The Android app does the
// same in data/supabase/SupabaseRealtime.kt.
//
// Realtime applies library_items' row-level security with the tab's own sign-in, so only this
// account's rows are ever heard about. Needs the table in the supabase_realtime publication
// (MtgCompanionApp/supabase/migrations/20260918010000_library_realtime.sql).

import { realtimeSocketUrl } from './supabaseAuth'

/** Phoenix drops a connection it hasn't heard from in a while; a missed reply means ours is dead. */
const HEARTBEAT_MS = 25_000
/**
 * How often the sign-in is checked. accessToken() renews it in its last minute, and a renewed one is
 * handed to Realtime right away — otherwise Realtime ends the subscription when the old one expires.
 */
const TOKEN_CHECK_MS = 30_000
/** Waits before reconnecting after a drop, growing with each failed attempt. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000]

/**
 * Listens for changes to [userId]'s library rows, calling [onChange] for each (and after a reconnect,
 * as changes may have been missed while it was down). [onLive] says whether it's connected, so the
 * caller can check less often meanwhile. Returns a function that stops it.
 */
export function watchLibrary(
  userId: string,
  token: () => Promise<string | null>,
  onChange: () => void,
  onLive: (live: boolean) => void,
): () => void {
  const topic = `realtime:library-${userId}`
  let socket: WebSocket | null = null
  let stopped = false
  let joined = false
  let everJoined = false
  let ref = 0
  let attempt = 0
  let sentToken: string | null = null
  let awaitingHeartbeat: string | null = null
  let heartbeat: number | undefined
  let tokenCheck: number | undefined
  let retry: number | undefined

  const nextRef = () => String(++ref)
  const send = (message: object) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  const setLive = (live: boolean) => {
    if (joined === live) return
    joined = live
    onLive(live)
  }
  /** Closes the current connection, if any, without reconnecting. */
  const drop = () => {
    window.clearInterval(heartbeat)
    window.clearInterval(tokenCheck)
    awaitingHeartbeat = null
    const s = socket
    socket = null
    s?.close()
    setLive(false)
  }
  /** The connection is gone (or unusable): drop it and try again after a pause. */
  const lost = (ws: WebSocket) => {
    if (socket !== ws) return // already replaced or stopped
    drop()
    scheduleRetry()
  }
  const scheduleRetry = () => {
    if (stopped) return
    window.clearTimeout(retry)
    retry = window.setTimeout(() => { void connect() }, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)])
    attempt += 1
  }

  const connect = async () => {
    if (stopped) return
    let jwt: string | null
    try {
      jwt = await token()
    } catch {
      scheduleRetry() // offline, or the sign-in server busy: try again shortly
      return
    }
    if (stopped || !jwt) return // signed out: nothing to listen for
    const ws = new WebSocket(realtimeSocketUrl())
    socket = ws
    sentToken = jwt

    ws.onopen = () => {
      const join = nextRef()
      send({
        topic,
        event: 'phx_join',
        ref: join,
        join_ref: join,
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: '' },
            private: false,
            postgres_changes: [{ event: '*', schema: 'public', table: 'library_items', filter: `user_id=eq.${userId}` }],
          },
          access_token: jwt,
        },
      })
      heartbeat = window.setInterval(() => {
        // The last heartbeat was never answered: the connection died without closing (a network
        // change, a laptop waking from sleep). Start over.
        if (awaitingHeartbeat !== null) { lost(ws); return }
        awaitingHeartbeat = nextRef()
        send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: awaitingHeartbeat })
      }, HEARTBEAT_MS)
      tokenCheck = window.setInterval(() => {
        void token().then((fresh) => {
          if (!fresh || fresh === sentToken || socket !== ws) return
          sentToken = fresh
          send({ topic, event: 'access_token', payload: { access_token: fresh }, ref: nextRef() })
        }, () => {})
      }, TOKEN_CHECK_MS)
    }

    ws.onmessage = (e) => {
      let message: { topic?: string; event?: string; ref?: string; payload?: { status?: string; extension?: string } }
      try {
        message = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (message.topic === 'phoenix') {
        if (message.event === 'phx_reply' && message.ref === awaitingHeartbeat) awaitingHeartbeat = null
        return
      }
      if (message.topic !== topic) return
      switch (message.event) {
        case 'phx_reply':
          if (message.payload?.status === 'ok' && !joined) {
            attempt = 0
            setLive(true)
            if (everJoined) onChange() // back after a drop: catch up on anything missed
            everJoined = true
          } else if (message.payload?.status === 'error') {
            lost(ws) // refused (an expired sign-in, say): reconnect with a fresh one
          }
          break
        case 'postgres_changes':
          onChange()
          break
        case 'system':
          if (message.payload?.status !== 'error') break
          if (message.payload.extension === 'postgres_changes') {
            // Realtime can't subscribe to the table (it isn't published for it): stop trying; the
            // regular checks carry on.
            stopped = true
            drop()
          } else {
            lost(ws) // anything else (the sign-in expired, say): reconnect
          }
          break
        case 'phx_error':
        case 'phx_close':
          lost(ws)
          break
      }
    }

    ws.onclose = () => lost(ws)
  }

  void connect()
  return () => {
    stopped = true
    window.clearTimeout(retry)
    drop()
  }
}
