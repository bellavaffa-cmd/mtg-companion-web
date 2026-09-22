// Email + password accounts on Supabase Auth (GoTrue REST), the same project and accounts as the
// Android app (see MtgCompanionApp/.../data/supabase/SupabaseAuth.kt). Plain fetch, no SDK.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const SESSION_KEY = 'mtgweb_supabase_session'
const SIGNED_OUT_KEY = 'mtgweb_signed_out'

export const supabaseConfigured = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== ''

export interface Account {
  userId: string
  email: string
}

interface Session extends Account {
  accessToken: string
  refreshToken: string
  /** Epoch ms when the access token expires. */
  expiresAt: number
}

/** The server refused: wrong credentials, expired/revoked session, rate limit… */
export class AuthError extends Error {
  readonly status: number
  readonly code: string
  readonly serverMessage: string

  constructor(message: string, status = 0, code = '', serverMessage = '') {
    super(message)
    this.status = status
    this.code = code
    this.serverMessage = serverMessage
  }

  /**
   * Whether the server says the session is gone for good (revoked, expired, already-used refresh
   * token), as opposed to being briefly unable to answer — only then should the browser sign out.
   */
  get sessionGone(): boolean {
    return this.status >= 400 && this.status <= 403 && (
      SESSION_GONE_CODES.has(this.code) || /refresh token|invalid_grant/i.test(this.serverMessage)
    )
  }
}
const SESSION_GONE_CODES = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired',
  'user_not_found', 'user_banned', 'invalid_grant',
])
/** The server couldn't be reached at all. */
export class OfflineError extends Error {}
/** The server answered with a temporary problem (overloaded, rate limited): keep the session, retry later. */
export class ServerBusyError extends OfflineError {}

/** Where account emails (confirm sign-up, reset password) send people back to: this web app. */
export function authRedirectUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL
}

export function restUrl(path: string): string {
  return SUPABASE_URL + path
}

/** Supabase Realtime's WebSocket address (Phoenix protocol, JSON messages). */
export function realtimeSocketUrl(): string {
  return `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`
}

export function apiHeaders(token?: string): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function saveSession(json: Record<string, unknown>): Session {
  const user = json.user as { id: string; email?: string }
  const session: Session = {
    userId: user.id,
    email: user.email ?? '',
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function currentAccount(): Account | null {
  const s = loadSession()
  return s ? { userId: s.userId, email: s.email } : null
}

function friendlyError(status: number, json: Record<string, unknown>): string {
  const raw = ['msg', 'error_description', 'message', 'error']
    .map((k) => json[k])
    .find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? ''
  const has = (s: string) => raw.toLowerCase().includes(s.toLowerCase())
  if (has('Invalid login credentials')) return 'Wrong email or password.'
  if (has('Email not confirmed')) return 'Confirm your email first — open the link we sent you, then sign in.'
  if (has('already registered')) return 'That email already has an account. Sign in instead.'
  if (has('should be different from the old password')) return "That's your current password — choose a different one."
  if (has('Password should be')) return raw
  if (has('rate limit') || status === 429) return 'Too many attempts. Wait a minute and try again.'
  if (has('Error sending')) return "Couldn't send the email right now. Try again in a few minutes."
  return raw || `Request failed (HTTP ${status}).`
}

async function post(path: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(restUrl(path), { method: 'POST', headers: apiHeaders(token), body: JSON.stringify(body) })
  } catch {
    throw new OfflineError("Can't reach the server — check your connection.")
  }
  const text = await res.text()
  const json = (() => {
    try { return text ? JSON.parse(text) : {} } catch { return {} }
  })()
  if (!res.ok) {
    const raw = ['msg', 'error_description', 'message', 'error'].map((k) => json[k]).filter((v) => typeof v === 'string').join(' ')
    const code = typeof json.error_code === 'string' ? json.error_code : typeof json.error === 'string' ? json.error : ''
    throw new AuthError(friendlyError(res.status, json), res.status, code, raw)
  }
  return json
}

const redirectParam = () => `redirect_to=${encodeURIComponent(authRedirectUrl())}`

export async function signIn(email: string, password: string): Promise<Account> {
  const s = saveSession(await post('/auth/v1/token?grant_type=password', { email: email.trim(), password }))
  return { userId: s.userId, email: s.email }
}

/** Returns the account if it's signed in right away, or null when a confirmation email was sent. */
/**
 * Signs in with a one-time token a phone approved (see sync/qrLogin.ts). The token is a magic-link
 * hash the server made for that account; it works once.
 */
export async function signInWithTokenHash(tokenHash: string): Promise<Account> {
  const s = saveSession(await post('/auth/v1/verify', { type: 'magiclink', token_hash: tokenHash }))
  return { userId: s.userId, email: s.email }
}

export async function signUp(email: string, password: string): Promise<Account | null> {
  const json = await post(`/auth/v1/signup?${redirectParam()}`, { email: email.trim(), password })
  if (!json.access_token) return null
  const s = saveSession(json)
  return { userId: s.userId, email: s.email }
}

export async function resendConfirmation(email: string): Promise<void> {
  await post(`/auth/v1/resend?${redirectParam()}`, { type: 'signup', email: email.trim() })
}

/** Emails a reset link. Supabase answers the same whether or not the email has an account. */
export async function sendPasswordReset(email: string): Promise<void> {
  await post(`/auth/v1/recover?${redirectParam()}`, { email: email.trim() })
}

let refreshing: Promise<string | null> | null = null

/** A valid access token (refreshed when close to expiry), or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const s = loadSession()
  if (!s) return null
  if (Date.now() < s.expiresAt - 60_000) return s.accessToken
  refreshing ??= (async () => {
    try {
      return saveSession(await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refreshToken })).accessToken
    } catch (e) {
      // Revoked or expired refresh token: the user has to sign in again. Network trouble or a server
      // hiccup (5xx, rate limit) keeps the session for the next try.
      if (e instanceof AuthError && e.sessionGone) {
        clearSession()
        try {
          localStorage.setItem(SIGNED_OUT_KEY, JSON.stringify({ reason: signedOutReason(e), at: Date.now() }))
        } catch {
          // Storage unavailable: the sign-out still happens, it just can't be explained afterwards.
        }
        return null
      }
      if (e instanceof AuthError) throw new ServerBusyError("The account server isn't responding — will try again shortly.")
      throw e
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function updatePassword(newPassword: string): Promise<void> {
  const token = await accessToken()
  if (!token) throw new AuthError("You're signed out — request a new reset link.")
  let res: Response
  try {
    res = await fetch(restUrl('/auth/v1/user'), { method: 'PUT', headers: apiHeaders(token), body: JSON.stringify({ password: newPassword }) })
  } catch {
    throw new OfflineError("Can't reach the server — check your connection.")
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new AuthError(friendlyError(res.status, json))
  }
}

/** Why this browser stopped being signed in, and when — shown on the account page until dismissed. */
export interface SignedOutNotice { reason: string; at: number }

export function signedOutNotice(): SignedOutNotice | null {
  try {
    const raw = localStorage.getItem(SIGNED_OUT_KEY)
    return raw ? (JSON.parse(raw) as SignedOutNotice) : null
  } catch {
    return null
  }
}

export function dismissSignedOutNotice(): void {
  localStorage.removeItem(SIGNED_OUT_KEY)
}

/** Plain-English version of why the server ended the session. */
function signedOutReason(e: AuthError): string {
  const says = (text: string) => e.serverMessage.toLowerCase().includes(text)
  if (e.code === 'refresh_token_already_used' || says('already used')) {
    return "The server saw this browser's sign-in used twice and ended it. This can happen if a tab was closed mid-sync, or if you changed your password on another device."
  }
  if (e.code === 'user_banned') return 'This account has been suspended.'
  if (e.code === 'user_not_found') return 'This account no longer exists.'
  if (e.code === 'session_not_found' || e.code === 'session_expired' || says('not found')) {
    return 'The sign-in was no longer valid — it may have been ended by a password change or by signing out everywhere.'
  }
  return `The server ended this sign-in (${e.code || `HTTP ${e.status}`}).`
}

/** The server refused the current access token (a clock that's off, say): refresh it on next use. */
export function invalidateAccessToken(): void {
  const s = loadSession()
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, expiresAt: 0 }))
}

/** Signs this browser out (scope=local keeps the user's other devices signed in). */
export async function signOut(): Promise<void> {
  const s = loadSession()
  clearSession()
  dismissSignedOutNotice() // asked for, so nothing to explain
  if (s) {
    await fetch(restUrl('/auth/v1/logout?scope=local'), { method: 'POST', headers: apiHeaders(s.accessToken) }).catch(() => {})
  }
}

export type LinkResult =
  | { kind: 'signed-in'; account: Account; recovery: boolean }
  | { kind: 'error'; message: string }

/**
 * Finishes sign-in when an account email link opened this page: Supabase appends the session to the
 * URL fragment (#access_token=…&refresh_token=…&type=signup|recovery) or an error. Returns null
 * when the URL isn't such a link. Clears the fragment either way so tokens don't linger in the URL.
 */
export async function consumeAuthLink(): Promise<LinkResult | null> {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.includes('access_token=') && !hash.includes('error_description=')) return null
  const params = new URLSearchParams(hash)
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  const errorDescription = params.get('error_description')
  if (errorDescription) {
    return {
      kind: 'error',
      message: params.get('error_code') === 'otp_expired'
        ? 'That link has expired or was already used. Sign in, or send a new email.'
        : errorDescription,
    }
  }
  const access = params.get('access_token')
  const refresh = params.get('refresh_token')
  if (!access || !refresh) return { kind: 'error', message: "That link didn't include a sign-in. Try signing in with your password." }
  try {
    const res = await fetch(restUrl('/auth/v1/user'), { headers: apiHeaders(access) })
    if (!res.ok) return { kind: 'error', message: `Couldn't finish signing in (HTTP ${res.status}). Try signing in with your password.` }
    const user = await res.json()
    const s = saveSession({ access_token: access, refresh_token: refresh, expires_in: params.get('expires_in') ?? 3600, user })
    return { kind: 'signed-in', account: { userId: s.userId, email: s.email }, recovery: params.get('type') === 'recovery' }
  } catch {
    return { kind: 'error', message: "Couldn't reach the server to finish signing in. Sign in with your password instead." }
  }
}
