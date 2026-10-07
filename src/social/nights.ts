// Game night invites and pod chat: calls to the server functions in
// MtgCompanionApp/supabase/migrations/20261006070000_game_nights_chat.sql. The rules behind the
// screens are in nightsLogic.ts. The Android app's twin is data/social/GameNightsApi.kt.
//
// Until that migration is applied the functions aren't there: nightsAvailable() says so, and the
// screens say "Game night invites aren't available yet" / "Pod chat isn't available yet".

import { useEffect, useRef, useState } from 'react'
import { accessToken } from '../sync/supabaseAuth'
import { watchDm } from '../sync/realtime'
import { useSync } from '../sync/SyncContext'
import { call, SocialError } from './api'
import { useAreaChanges } from './liveChanges'
import {
  parseNightInvite, parseNightInvites, parsePodChats, parsePodMessage, parsePodMessages,
  type NightInvite, type PodChat, type PodMessage, type PodMessageRef, type RsvpAnswer,
} from './nightsLogic'

export const NIGHTS_UNAVAILABLE = "Game night invites aren't available yet."
export const CHAT_UNAVAILABLE = "Pod chat isn't available yet."

let probe: Promise<boolean> | null = null

/** Whether the server has these functions. Asked once per page load (again after a failed ask). */
export function nightsAvailable(): Promise<boolean> {
  if (!probe) {
    probe = call<number>('game_nights_version')
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
export function useNightsAvailable(): boolean | null {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [state, setState] = useState<{ user: string | null; ok: boolean } | null>(null)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void nightsAvailable().then((ok) => { if (!cancelled) setState({ user: userId, ok }) })
    return () => { cancelled = true }
  }, [userId])
  if (!userId) return false
  return state && state.user === userId ? state.ok : null
}

// ---- Game nights ----

export interface NightFields {
  startsAt: number
  place: string
  note: string
  /** Friends from outside the pod. */
  guests: string[]
}

/** The user's nights still to come (in [podId] only, when given), soonest first. */
export const gameNights = (podId: string | null = null) => call<unknown>('game_nights', { p_pod: podId }).then(parseNightInvites)
/** One night the user is invited to, or null. */
export const gameNight = (id: string) => call<unknown>('game_night', { p_night: id }).then(parseNightInvite)

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

/** Plans a night in [podId] ([id] null) or changes one; answers it. */
export const saveGameNight = (id: string | null, podId: string, f: NightFields) =>
  call<unknown>('save_game_night', {
    p_night: id, p_pod: podId, p_starts_at: new Date(f.startsAt).toISOString(), p_tz: zone(),
    p_place: f.place.trim(), p_note: f.note.trim() || null, p_guests: f.guests,
  }).then((n) => {
    const night = parseNightInvite(n)
    if (!night) throw new SocialError('bad_night', 'Something went wrong.')
    return night
  })

export const cancelGameNight = (id: string) => call<void>('cancel_game_night', { p_night: id })

/** The user's answer, with the deck they'll bring; answers the night as it is now. */
export const rsvpGameNight = (id: string, answer: RsvpAnswer, deck: string | null) =>
  call<unknown>('rsvp_game_night', { p_night: id, p_answer: answer, p_deck: deck?.trim() || null }).then(parseNightInvite)

// ---- Pod chat ----

export const podChats = (): Promise<PodChat[]> => call<unknown>('pod_chats').then(parsePodChats)
/** A page of [podId]'s chat, oldest first: the messages before [before] (null: the newest). */
export const podMessages = (podId: string, before: number | null = null, limit = 50) =>
  call<unknown>('pod_messages', { p_pod: podId, p_before: before, p_limit: limit }).then(parsePodMessages)
export const sendPodMessage = (podId: string, body: string) =>
  call<unknown>('send_pod_message', { p_pod: podId, p_body: body, p_kind: 'text', p_ref: null }).then((m) => parsePodMessage(m))
/** Shares a game night, a deck or a card into the chat, with an optional caption. */
export const sharePodMessage = (podId: string, ref: PodMessageRef, caption = '') =>
  call<unknown>('send_pod_message', { p_pod: podId, p_body: caption, p_kind: 'share', p_ref: ref }).then((m) => parsePodMessage(m))
export const markPodRead = (podId: string) => call<void>('mark_pod_read', { p_pod: podId })
export const unreadPodMessages = () => call<number>('unread_pod_messages').then((n) => n ?? 0)

/**
 * Pod chat messages and game night changes for the signed-in user while a screen is open, on their
 * own "dm:<id>" channel: [onMessage] for each new chat message, [onNight] when a night changed (its
 * id), [onReconnect] after a drop so the screen can reload.
 */
export function usePodLive(
  handlers: { onMessage?: (m: PodMessage) => void; onNight?: (nightId: string, podId: string) => void; onReconnect?: () => void },
  enabled = true,
) {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const ref = useRef(handlers)
  useEffect(() => { ref.current = handlers })
  useEffect(() => {
    if (!userId || !enabled) return
    let joined = false
    return watchDm(
      userId,
      accessToken,
      (event, payload) => {
        if (event === 'pod_message') {
          const m = parsePodMessage(payload)
          if (m) ref.current.onMessage?.(m)
        } else if (event === 'game_night' && payload && typeof payload === 'object') {
          const p = payload as { nightId?: string; podId?: string }
          if (p.nightId) ref.current.onNight?.(p.nightId, p.podId ?? '')
        }
      },
      () => { if (joined) ref.current.onReconnect?.(); joined = true },
      () => {},
    )
  }, [userId, enabled])
}

/** The user's nights still to come, kept fresh while shown; null while loading, [] when unavailable. */
export function useGameNights(podId: string | null = null): { nights: NightInvite[] | null; available: boolean | null; reload: () => void } {
  const available = useNightsAvailable()
  const [nights, setNights] = useState<NightInvite[] | null>(null)
  const [tick, setTick] = useState(0)
  // Also when a night changes elsewhere: the app-wide live channel (SocialContext).
  const live = useAreaChanges('nights')
  useEffect(() => {
    if (!available) return
    let cancelled = false
    gameNights(podId).then((n) => { if (!cancelled) setNights(n) }).catch(() => { if (!cancelled) setNights((x) => x ?? []) })
    return () => { cancelled = true }
  }, [available, podId, tick, live])
  usePodLive({ onNight: () => setTick((t) => t + 1), onReconnect: () => setTick((t) => t + 1) }, !!available)
  return { nights: available === false ? [] : nights, available, reload: () => setTick((t) => t + 1) }
}
