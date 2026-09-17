// Email + password accounts on Supabase Auth (GoTrue REST), the same project and accounts as the
// Android app (see MtgCompanionApp/.../data/supabase/SupabaseAuth.kt). Plain fetch, no SDK.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
const SESSION_KEY = 'mtgweb_supabase_session'

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
export class AuthError extends Error {}

/** The server couldn't be reached at all. */
export class OfflineError extends Error {}

/** Where account emails (confirm sign-up, reset password) send people back to: this web app. */
export function authRedirectUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL
}

export function restUrl(path: string): string {
  return SUPABASE_URL + path
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
  if (!res.ok) throw new AuthError(friendlyError(res.status, json))
  return json
}

const redirectParam = () => `redirect_to=${encodeURIComponent(authRedirectUrl())}`

export async function signIn(email: string, password: string): Promise<Account> {
  const s = saveSession(await post('/auth/v1/token?grant_type=password', { email: email.trim(), password }))
  return { userId: s.userId, email: s.email }
}

/** Returns the account if it's signed in right away, or null when a confirmation email was sent. */
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
      // Revoked or expired refresh token: the user has to sign in again. Network trouble keeps the session.
      if (e instanceof AuthError) {
        clearSession()
        return null
      }
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

/** Signs this browser out (scope=local keeps the user's other devices signed in). */
export async function signOut(): Promise<void> {
  const s = loadSession()
  clearSession()
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
