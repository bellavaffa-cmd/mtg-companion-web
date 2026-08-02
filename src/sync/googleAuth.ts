// Google Identity Services (GIS) token client — the browser equivalent of the Android app's
// GoogleSignIn + GoogleAuthUtil. Uses the broad `drive` scope (not `drive.file`) so this web app,
// registered as its own separate OAuth client, can find the SAME backup file the phone app
// created — `drive.file` scopes access per-creating-app, so a different client id would never see
// it; full `drive` scope can look any file up by name instead. Acceptable for a personal-use tool
// that only the account owner ever authorizes (not a publicly distributed, Google-verified app).
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const USERINFO_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}

interface TokenClient {
  callback: (resp: TokenResponse) => void
  requestAccessToken: (opts: { prompt: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resp: TokenResponse) => void
          }) => TokenClient
        }
      }
    }
  }
}

let tokenClient: TokenClient | null = null
let currentToken: string | null = null
let tokenExpiresAt = 0

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('google-identity-script') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')))
      return
    }
    const script = document.createElement('script')
    script.id = 'google-identity-script'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })
}

export function hasValidToken(): boolean {
  return currentToken !== null && Date.now() < tokenExpiresAt
}

/**
 * Resolves with a Drive-scoped access token, prompting the user to sign in/consent if there's no
 * still-valid one cached in memory. Tokens from this flow aren't persisted across page reloads
 * (no refresh token) — a fresh reload needs one more click of "Connect Google Drive".
 */
export async function requestAccessToken(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  if (!clientId) {
    throw new Error('Missing VITE_GOOGLE_CLIENT_ID — see README.md for how to set up a Google OAuth client.')
  }
  await loadGisScript()
  if (hasValidToken()) return currentToken!

  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: `${DRIVE_SCOPE} ${USERINFO_SCOPE}`,
        callback: () => {},
      })
    }
    tokenClient.callback = (resp) => {
      if (resp.error || !resp.access_token) {
        reject(new Error(resp.error ?? 'Sign-in failed'))
        return
      }
      currentToken = resp.access_token
      tokenExpiresAt = Date.now() + (Number(resp.expires_in ?? 3600) - 60) * 1000
      resolve(currentToken)
    }
    tokenClient.requestAccessToken({ prompt: currentToken ? '' : 'consent' })
  })
}

export function clearToken(): void {
  currentToken = null
  tokenExpiresAt = 0
}

export async function fetchUserEmail(token: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const json = await res.json()
  return json.email ?? null
}
