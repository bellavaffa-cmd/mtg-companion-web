/**
 * Signing in here by scanning a code with the phone.
 *
 * This browser asks the server for a sign-in request and shows its code as a QR. The phone, already
 * signed in, scans it in the app and approves; the server then leaves a one-time sign-in token for
 * this browser — and only this one, which holds a secret the code never carries — to collect and
 * exchange for a session. A request runs out after two minutes and is good for one sign-in.
 *
 * The server side is the Android repo's supabase/migrations/…_qr_login.sql and functions/qr-login.
 */

import { apiHeaders, OfflineError, restUrl } from './supabaseAuth'

/** Where a phone's camera lands when it reads the code: the web app, which explains what to do. */
export const loginLinkFor = (code: string) => `${window.location.origin}${import.meta.env.BASE_URL}login/${code}`

export interface QrLoginRequest {
  code: string
  /** Kept here, never in the QR: what proves this browser asked. */
  secret: string
  expiresAt: number
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

/** "Chrome on Windows" — what the phone shows so the user knows what they're approving. */
export function describeBrowser(agent = navigator.userAgent): string {
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /OPR\//.test(agent) ? 'Opera'
    : /Firefox\//.test(agent) ? 'Firefox'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : 'A browser'
  const os = /Windows/.test(agent) ? 'Windows'
    : /Android/.test(agent) ? 'Android'
    : /iPhone|iPad/.test(agent) ? 'iOS'
    : /Mac OS X/.test(agent) ? 'a Mac'
    : /Linux/.test(agent) ? 'Linux'
    : null
  return os ? `${browser} on ${os}` : browser
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(restUrl(`/rest/v1/rpc/${fn}`), { method: 'POST', headers: apiHeaders(), body: JSON.stringify(args) })
  } catch {
    throw new OfflineError("Can't reach the server — check your connection.")
  }
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status}`)
  return (await res.json()) as T
}

/** A fresh sign-in request to show as a QR. */
export async function startQrLogin(): Promise<QrLoginRequest> {
  const secret = hex(crypto.getRandomValues(new Uint8Array(16)))
  const rows = await rpc<{ code: string; expires_at: string }[]>('start_qr_login', {
    p_secret_hash: await sha256Hex(secret),
    p_browser: describeBrowser(),
  })
  const row = rows?.[0]
  if (!row) throw new Error('start_qr_login: nothing came back')
  return { code: row.code, secret, expiresAt: new Date(row.expires_at).getTime() }
}

/**
 * Waits for the phone to approve [request] and answers the one-time token to sign in with. Null when
 * it runs out first; [stopped] gives up early (the user closed the code).
 */
export async function waitForApproval(request: QrLoginRequest, stopped: () => boolean, everyMs = 2000): Promise<string | null> {
  while (!stopped() && Date.now() < request.expiresAt) {
    const token = await rpc<string | null>('claim_qr_login', { p_code: request.code, p_secret: request.secret })
    if (token) return token
    await new Promise((r) => setTimeout(r, everyMs))
  }
  return null
}

/** What the phone (or a browser opening the link) is being asked to approve. */
export async function loginRequestInfo(code: string, token: string): Promise<{ browser: string; expiresAt: number } | null> {
  const res = await fetch(restUrl('/rest/v1/rpc/qr_login_request'), {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({ p_code: code }),
  })
  if (!res.ok) return null
  const rows = (await res.json()) as { browser: string; expires_at: string }[]
  const row = rows?.[0]
  return row ? { browser: row.browser || 'A browser', expiresAt: new Date(row.expires_at).getTime() } : null
}

/** Approves a waiting sign-in as the signed-in account here. */
export async function approveLogin(code: string, token: string): Promise<void> {
  const res = await fetch(restUrl('/functions/v1/qr-login'), {
    method: 'POST',
    headers: apiHeaders(token),
    body: JSON.stringify({ code }),
  })
  if (!res.ok) {
    const why = await res.json().catch(() => ({}))
    throw new Error(why?.error === 'done' ? 'That code has already been used.' : 'That code has run out — show a new one.')
  }
}
