// Phone and browser notifications for friend requests and trades (Web Push). The service worker
// (pwa/sw.template.js) shows them; this subscribes the browser and tells the server where to send.
// On iPhone and iPad it only works once the app is added to the Home Screen (iOS 16.4+).

import { accessToken, apiHeaders, restUrl } from '../sync/supabaseAuth'

/** The push function's public VAPID key (supabase/functions/push); browsers subscribe with it. */
const VAPID_PUBLIC_KEY = 'BF3EBWKE4Jdj4TxIBA3DuT3pJEjvjk4IJOP15HBbSm8_Ufsb7Qut6OlECR1Kfpi19JhG8vJfEUpbJD5VJGPpyhA'

export type PushState =
  /** This browser can't (no service worker or push support — or an iPhone not using the Home Screen app). */
  | 'unsupported'
  /** The user blocked notifications for this site; only the browser's site settings can undo that. */
  | 'blocked'
  | 'off'
  | 'on'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** An iPhone or iPad in Safari rather than the Home Screen app, where push isn't available. */
export const needsHomeScreen = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  // The service worker only exists in the built app (not the dev server).
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function pushState(): Promise<PushState> {
  const reg = await registration()
  if (!reg) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  const token = await accessToken()
  if (!token) throw new Error('Sign in first.')
  const res = await fetch(restUrl(`/rest/v1/rpc/${fn}`), { method: 'POST', headers: apiHeaders(token), body: JSON.stringify(args) })
  if (!res.ok) throw new Error(`Couldn't reach the server (HTTP ${res.status}).`)
  return res
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** Asks for permission (the tap is the ask) and subscribes this browser for the signed-in account. */
export async function enablePush(): Promise<PushState> {
  const reg = await registration()
  if (!reg) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const subscription = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
  await registerSubscription(subscription)
  return 'on'
}

async function registerSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON()
  await rpc('register_push_token', { p_platform: 'web', p_token: subscription.endpoint, p_subscription: { endpoint: json.endpoint, keys: json.keys } })
}

/** Stops notifications to this browser. */
export async function disablePush(): Promise<void> {
  const subscription = await (await registration())?.pushManager.getSubscription()
  if (!subscription) return
  await rpc('unregister_push_token', { p_token: subscription.endpoint }).catch(() => {})
  await subscription.unsubscribe()
}

/**
 * On sign-out: this browser stops getting the account's notifications. Unsubscribing makes the old
 * address dead, and the server forgets it the next time it tries it.
 */
export async function dropPushOnSignOut(): Promise<void> {
  const subscription = await (await registration().catch(() => null))?.pushManager.getSubscription().catch(() => null)
  await subscription?.unsubscribe().catch(() => {})
}

/**
 * On start, signed in: an existing subscription is registered again, so it belongs to whoever is
 * signed in now and the server keeps an up-to-date address.
 */
export async function refreshPush(): Promise<void> {
  const subscription = await (await registration())?.pushManager.getSubscription()
  if (subscription && Notification.permission === 'granted') await registerSubscription(subscription)
}

export interface NotificationPrefs {
  friends: boolean
  trades: boolean
}

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  return (await rpc('notification_prefs', {})).json()
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  return (await rpc('set_notification_prefs', { p_friends: prefs.friends, p_trades: prefs.trades })).json()
}
