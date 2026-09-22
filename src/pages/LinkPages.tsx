import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { rise, useBack } from '../components/kit'
import * as api from '../social/api'
import * as auth from '../sync/supabaseAuth'
import { approveLogin, loginRequestInfo } from '../sync/qrLogin'
import { useSync } from '../sync/SyncContext'
import { useOverview } from '../social/SocialContext'
import { SocialGate } from './FriendsPage'

/** Opened from a friend's QR code (/add/username): asks to be friends. */
export function AddFriendLinkPage() {
  const { username = '' } = useParams<{ username: string }>()
  const back = useBack('/friends')
  const navigate = useNavigate()
  const { refresh } = useOverview()
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const name = username.toLowerCase()
  // Another friend's code opened on top of this one starts over.
  useEffect(() => setResult(null), [name])

  return (
    <>
      <TopBar title="Add a friend" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>
            {(overview) => {
              if (overview.me?.username === name) {
                return <div className="empty-state"><Icon name="qr_code_2" />That's your own code — let a friend scan it.</div>
              }
              const already = overview.friends.find((f) => overview.people[f.user_id]?.username === name)
              return (
                <div className="link-card rise" style={rise(0)}>
                  <Icon name="person_add" className="link-icon" />
                  <h2 className="social-title">@{name}</h2>
                  {already?.status === 'accepted' ? (
                    <>
                      <p className="muted">You're already friends.</p>
                      <button type="button" className="btn gold" onClick={() => navigate(`/friends/${already.user_id}`)}>Open</button>
                    </>
                  ) : result ? (
                    <>
                      <p className={result.ok ? 'muted' : 'field-error'} aria-live="polite">{result.text}</p>
                      <button type="button" className="btn line" onClick={() => navigate('/friends')}>Go to Friends</button>
                    </>
                  ) : (
                    <>
                      <p className="muted">Ask them to be friends? You'll be able to see what each of you shares, and trade.</p>
                      <button
                        type="button"
                        className="btn gold"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          try {
                            const r = await api.requestFriend(name)
                            setResult({ ok: true, text: r === 'accepted' ? "You're now friends." : r === 'already' ? 'You already asked — waiting for their answer.' : 'Asked! They’ll see your request.' })
                            await refresh()
                          } catch (e) {
                            setResult({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' })
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        <Icon name="person_add" aria-hidden />Send friend request
                      </button>
                    </>
                  )}
                </div>
              )
            }}
          </SocialGate>
        </div>
      </div>
    </>
  )
}

type Joined = { state: 'joining' } | { state: 'failed'; message: string }

/** Opened from a seat's QR code on someone's life counter (/join/code/seat): sits the user there. */
export function JoinSeatPage() {
  const { code = '', seat = '' } = useParams<{ code: string; seat: string }>()
  const back = useBack('/')
  return (
    <>
      <TopBar title="Join a table" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{() => <JoinSeat key={`${code}/${seat}`} code={code} seat={Number(seat)} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

/** Takes the seat, then turns this phone into the seat's remote (RemotePage). */
function JoinSeat({ code, seat }: { code: string; seat: number }) {
  const navigate = useNavigate()
  const [joined, setJoined] = useState<Joined>({ state: 'joining' })
  // Scanning the code is the ask: join straight away, once.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api.joinMatch(code, seat)
      .then((r) => navigate(`/remote/${r.match_id}/${r.seat}`, { replace: true }))
      .catch((e: unknown) => setJoined({ state: 'failed', message: e instanceof Error ? e.message : 'Something went wrong.' }))
  }, [code, seat, navigate])

  return (
    <div className="link-card rise" style={rise(0)}>
      {joined.state === 'joining' && <><Icon name="hourglass_empty" className="link-icon" /><p className="muted">Taking your seat…</p></>}
      {joined.state === 'failed' && (
        <>
          <Icon name="event_busy" className="link-icon" />
          <h2 className="social-title">Couldn't join</h2>
          <p className="field-error">{joined.message}</p>
        </>
      )}
    </div>
  )
}

/**
 * Opened from a sign-in code (/login/<code>) — by a phone's camera, say, rather than the app's own
 * scanner. Signed in here, this device can approve the waiting browser itself; signed out, it says
 * where to scan instead.
 */
export function ApproveLoginPage() {
  const { code = '' } = useParams<{ code: string }>()
  const back = useBack('/account')
  const { account } = useSync()
  const [asking, setAsking] = useState<{ browser: string } | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stopped = false
    setResult(null)
    setAsking(null)
    void (async () => {
      const token = account ? await auth.accessToken() : null
      if (!token || stopped) return
      const info = await loginRequestInfo(code, token)
      if (!stopped) {
        setAsking(info ? { browser: info.browser } : null)
        if (!info) setResult({ ok: false, text: 'That code has run out or has already been used. Show a new one on the other device.' })
      }
    })()
    return () => { stopped = true }
  }, [code, account])

  return (
    <>
      <TopBar title="Sign in on the web" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <div className="link-card rise" style={rise(0)}>
            <Icon name="qr_code_scanner" className="link-icon" />
            {!account ? (
              <>
                <h2 className="social-title">Sign in first</h2>
                <p className="muted">
                  This code signs another device into your account. Sign in here, or open Manabind on a phone that's
                  already signed in, tap Scan, and point it at the code.
                </p>
                <button type="button" className="btn gold" onClick={() => { window.location.assign(`${import.meta.env.BASE_URL}account`) }}>Go to Account</button>
              </>
            ) : result ? (
              <>
                <h2 className="social-title">{result.ok ? 'Signed in' : "That didn't work"}</h2>
                <p className="muted">{result.text}</p>
              </>
            ) : asking ? (
              <>
                <h2 className="social-title">Sign in {asking.browser}?</h2>
                <p className="muted">It will be signed in as {account.email} until it's signed out.</p>
                <div className="account-actions">
                  <button type="button" className="btn line" disabled={busy} onClick={back}>Not me</button>
                  <button
                    type="button" className="btn gold" disabled={busy}
                    onClick={() => void (async () => {
                      setBusy(true)
                      try {
                        const token = await auth.accessToken()
                        if (!token) throw new Error('signed out')
                        await approveLogin(code, token)
                        setResult({ ok: true, text: `${asking.browser} is signed in as you.` })
                      } catch (e) {
                        setResult({ ok: false, text: e instanceof Error ? e.message : "That didn't work." })
                      } finally {
                        setBusy(false)
                      }
                    })()}
                  >
                    Sign it in
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Checking that code…</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
