// Live updates from Supabase Realtime: while a tab is open, it hears as soon as another device saves
// one of this account's decks or binders, and syncs then instead of at its next check. Plain
// WebSocket speaking Realtime's Phoenix protocol (JSON messages), no SDK. The Android app does the
// same in data/supabase/SupabaseRealtime.kt.
//
// Realtime applies library_items' row-level security with the tab's own sign-in, so only this
// account's rows are ever heard about. Needs the table in the supabase_realtime publication
// (MtgCompanionApp/supabase/migrations/20260918010000_library_realtime.sql).

import { realtimeSocketUrl } from './supabaseAuth'

const HEARTBEAT_MS = 25_000
/** Sign-in tokens last an hour: rejoin with a fresh one well before that. */
const REJOIN_MS = 45 * 60_000
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
  let heartbeat: number | undefined
  let rejoin: number | undefined
  let retry: number | undefined

  const send = (message: object) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  const setLive = (live: boolean) => {
    if (joined === live) return
    joined = live
    onLive(live)
  }
  const drop = () => {
    window.clearInterval(heartbeat)
    window.clearTimeout(rejoin)
    const s = socket
    socket = null
    s?.close()
    setLive(false)
  }

  const connect = async () => {
    if (stopped) return
    const jwt = await token().catch(() => null)
    if (stopped || !jwt) return // signed out: nothing to listen for
    const ws = new WebSocket(realtimeSocketUrl())
    socket = ws

    ws.onopen = () => {
      ref += 1
      send({
        topic,
        event: 'phx_join',
        ref: String(ref),
        join_ref: String(ref),
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
      heartbeat = window.setInterval(() => { ref += 1; send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref) }) }, HEARTBEAT_MS)
    }

    ws.onmessage = (e) => {
      let message: { topic?: string; event?: string; payload?: { status?: string } }
      try {
        message = JSON.parse(String(e.data))
      } catch {
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
            rejoin = window.setTimeout(() => { drop(); void connect() }, REJOIN_MS)
          } else if (message.payload?.status === 'error') {
            ws.close() // refused (an expired sign-in, say): reconnect with a fresh one
          }
          break
        case 'postgres_changes':
          onChange()
          break
        case 'system':
          // Realtime couldn't set up the subscription (the table isn't published for it): stop
          // trying; the regular checks carry on.
          if (message.payload?.status === 'error') { stopped = true; drop() }
          break
        case 'phx_error':
        case 'phx_close':
          ws.close()
          break
      }
    }

    ws.onclose = () => {
      if (socket !== ws) return // replaced or stopped on purpose
      drop()
      if (stopped) return
      retry = window.setTimeout(() => { void connect() }, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)])
      attempt += 1
    }
  }

  void connect()
  return () => {
    stopped = true
    window.clearTimeout(retry)
    drop()
  }
}
