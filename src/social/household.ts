// Sharing storage at home: calls to the server functions in
// MtgCompanionApp/supabase/migrations/20261006050000_households.sql. The rules are householdLogic.ts;
// the Android app's twin is data/social/HouseholdApi.kt.
//
// Until that migration is applied the functions aren't there: householdAvailable() says so, and the
// screens say "Household sharing isn't available yet" (pull lists simply show no "ask" cards).

import { useCallback, useEffect, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { call, SocialError } from './api'
import { HOUSEHOLD_ERRORS, type HouseholdCards, type MyHouseholds, type Shelf } from './householdLogic'
import type { PlaceKind } from '../types/models'
import { useAreaChanges } from './liveChanges'

let probe: Promise<boolean> | null = null

/** Whether the server has the household functions. Asked once per page load (again after a failed ask). */
export function householdAvailable(): Promise<boolean> {
  if (!probe) {
    probe = call<number>('household_version')
      .then((v) => typeof v === 'number' && v >= 1)
      .catch((e: unknown) => {
        if (e instanceof SocialError && e.code === 'unavailable') return false
        probe = null // offline or signed out: ask again next time
        throw e
      })
  }
  return probe
}

/** A server answer in words for the household's screens. */
export function householdError(e: unknown): string {
  if (e instanceof SocialError) return HOUSEHOLD_ERRORS[e.code] ?? e.message
  return e instanceof Error ? e.message : 'Something went wrong.'
}

const emptyCards = (c: HouseholdCards | null): HouseholdCards => ({ copies: c?.copies ?? [], loans: c?.loans ?? [] })

export const myHouseholds = () => call<MyHouseholds>('my_households').then((d) => ({ households: d?.households ?? [], invites: d?.invites ?? [] }))
export const createHousehold = (name: string) => call<string>('create_household', { p_name: name })
export const inviteToHousehold = (household: string, friend: string) => call<'invited' | 'already'>('invite_to_household', { p_household: household, p_friend: friend })
export const respondHousehold = (household: string, accept: boolean) => call<void>('respond_household', { p_household: household, p_accept: accept })
export const leaveHousehold = (household: string) => call<void>('leave_household', { p_household: household })
export const cancelHouseholdInvite = (household: string, user: string) => call<void>('cancel_household_invite', { p_household: household, p_user: user })
export const shareHouseholdPlace = (household: string, place: { id: string; name: string; kind: PlaceKind }) =>
  call<void>('share_household_place', { p_household: household, p_place_id: place.id, p_name: place.name, p_kind: place.kind })
export const joinHouseholdPlace = (household: string, placeId: string) => call<void>('join_household_place', { p_household: household, p_place_id: placeId })
export const unshareHouseholdPlace = (household: string, placeId: string) => call<void>('unshare_household_place', { p_household: household, p_place_id: placeId })
export const householdCards = (household: string) => call<HouseholdCards | null>('household_cards', { p_household: household }).then(emptyCards)
export const householdBorrow = (household: string, from: string, clientId: string, cards: { name: string; qty: number; printingId: string }[], note: string | null = null) =>
  call<string>('household_borrow', { p_household: household, p_from: from, p_client_id: clientId, p_cards: cards, p_note: note })
export const householdLoanReturned = (loanId: string) => call<void>('household_loan_returned', { p_loan: loanId })

export type HouseholdsState =
  | { kind: 'signed-out' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: MyHouseholds }

/** The user's households for a screen, loaded when it opens; [reload] after a change. */
export function useHouseholds(): { state: HouseholdsState; reload: () => Promise<void> } {
  const { account } = useSync()
  const userId = account?.userId ?? null
  const [state, setState] = useState<HouseholdsState>({ kind: 'loading' })
  // A household or its loans changed elsewhere (a live ping): load again.
  const live = useAreaChanges('household') + useAreaChanges('loans')
  const reload = useCallback(async () => {
    if (!userId) return
    try {
      if (!(await householdAvailable())) { setState({ kind: 'unavailable' }); return }
      setState({ kind: 'ready', data: await myHouseholds() })
    } catch (e) {
      if (e instanceof SocialError && e.code === 'unavailable') setState({ kind: 'unavailable' })
      else setState({ kind: 'error', message: householdError(e) })
    }
  }, [userId])
  useEffect(() => { void reload() }, [reload, live])
  return { state: userId ? state : { kind: 'signed-out' }, reload }
}

/** Every household's shelves, for a pull list: null until loaded, or when households aren't there (yet). */
export function useShelves(): { shelves: Shelf[] | null; reload: () => Promise<void> } {
  const { state, reload: reloadHouseholds } = useHouseholds()
  const [shelves, setShelves] = useState<Shelf[] | null>(null)
  const households = state.kind === 'ready' ? state.data.households : null
  const load = useCallback(async () => {
    if (!households || households.length === 0) { setShelves(null); return }
    const out: Shelf[] = []
    for (const h of households) {
      try { out.push({ household: h, cards: await householdCards(h.id) }) } catch { /* that shelf just isn't asked of */ }
    }
    setShelves(out)
  }, [households])
  useEffect(() => { void load() }, [load])
  const reload = useCallback(async () => { await reloadHouseholds(); await load() }, [reloadHouseholds, load])
  return { shelves, reload }
}
