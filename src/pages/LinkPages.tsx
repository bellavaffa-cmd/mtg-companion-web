import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { rise, useBack } from '../components/kit'
import * as api from '../social/api'
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
