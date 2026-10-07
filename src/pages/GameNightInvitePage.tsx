import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { activeDecks } from '../decks/deckFolders'
import { saveBag, useBags } from '../collection/bagStore'
import { newBag } from '../collection/eventBag'
import { dayOf } from '../collection/copyHistoryStore'
import { newPlayerId, updateNight } from '../lifecounter/gameNightStore'
import { SocialGate } from './FriendsPage'
import { TradeMatchesTonight } from '../social/TradeMatchesTonight'
import * as api from '../social/api'
import * as more from '../social/more'
import { cancelGameNight, gameNight, NIGHTS_UNAVAILABLE, rsvpGameNight, saveGameNight, useNightsAvailable, usePodLive } from '../social/nights'
import {
  attendeesOf, calendarTitle, canManageNight, deckNamed, headerLine, myInvite, nightIcs, nightWhen, NOTE_MAX, PLACE_MAX, playersFromInvite, whoHeader, whoRows,
  type NightInvite, type RsvpAnswer,
} from '../social/nightsLogic'
import '../social/nights.css'

// A game night invite (the Invite mockup): when and where, Going / Maybe / Can't with the deck
// you'll bring, who's coming, "Ready for the night" (Pack your bag, Trade matches tonight, cards to
// give back), Add to calendar and Make pods on the night. At /play/nights/:id; planning or changing
// one at /play/nights/new?pod=<id> and /play/nights/:id/edit. The Android app's
// GameNightInviteScreen.kt.

const ANSWERS: { id: RsvpAnswer; label: string }[] = [{ id: 'going', label: 'Going' }, { id: 'maybe', label: 'Maybe' }, { id: 'cant', label: "Can't" }]

export function GameNightInvitePage() {
  const { id = '' } = useParams<{ id: string }>()
  const back = useBack('/play')
  return (
    <>
      <TopBar title="Game night" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(o) => <Invite overview={o} nightId={id} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

function Invite({ overview, nightId }: { overview: api.Overview; nightId: string }) {
  const navigate = useNavigate()
  const available = useNightsAvailable()
  const { decks: allDecks } = useSync()
  const decks = useMemo(() => activeDecks(allDecks).sort((a, b) => a.name.localeCompare(b.name)), [allDecks])
  const bags = useBags()
  const me = overview.me!.user_id
  const [night, setNight] = useState<NightInvite | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showTrades, setShowTrades] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [matches, setMatches] = useState<more.TradeMatch[]>([])
  const [borrowed, setBorrowed] = useState<api.BorrowedLoan[]>([])

  const load = useCallback(() => {
    gameNight(nightId).then((n) => { setNight(n); setError(null) }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
  }, [nightId])
  useEffect(() => { if (available) load() }, [available, load])
  usePodLive({ onNight: (id) => { if (id === nightId) load() }, onReconnect: load }, !!available)
  useEffect(() => {
    let live = true
    void more.socialMoreAvailable().then((ok) => (ok ? more.tradeMatches() : [])).then((m) => { if (live) setMatches(m) }).catch(() => {})
    api.myBorrowedLoans().then((l) => { if (live) setBorrowed(l) }).catch(() => {})
    return () => { live = false }
  }, [])

  if (available === false) return <div className="empty-state"><Icon name="event" />{NIGHTS_UNAVAILABLE}</div>
  if (night === undefined) {
    return error
      ? <div className="empty-state"><Icon name="cloud_off" />{error}<button type="button" className="btn line" onClick={load}>Try again</button></div>
      : <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
  }
  if (night === null) return <div className="empty-state"><Icon name="event_busy" />This game night isn't there any more, or you're not invited.</div>

  const mine = myInvite(night, me)
  const pod = overview.pods.find((p) => p.id === night.podId)
  const manage = canManageNight(night, me, pod?.owner)
  const over = night.startsAt < Date.now() - 12 * 3_600_000
  const coming = attendeesOf(night, me)
  const bagId = `gn-${night.id}`
  const bag = bags.find((b) => b.id === bagId)
  const myDeck = deckNamed(decks, mine?.deck)

  const answer = async (a: RsvpAnswer, deck: string | null) => {
    setBusy(true)
    setError(null)
    try {
      const n = await rsvpGameNight(night.id, a, a === 'cant' ? null : deck)
      if (n) setNight(n)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const pack = () => {
    const attendees = coming.map((c) => c.name)
    if (bag) saveBag({ ...bag, attendees, deckIds: myDeck && !bag.deckIds.includes(myDeck.id) ? [...bag.deckIds, myDeck.id] : bag.deckIds })
    else saveBag(newBag(bagId, `Game night at ${night.place}`, dayOf(night.startsAt), attendees, myDeck ? [myDeck.id] : [], Date.now()))
    navigate(`/play/pack/${bagId}`)
  }

  const makePods = () => {
    const commander = myDeck ? [myDeck.commander?.name, myDeck.partnerCommander?.name].filter(Boolean).join(' & ') || null : null
    updateNight((n) => ({
      ...n,
      players: playersFromInvite(n.players, night, me, overview.me?.display_name ?? 'Me', myDeck ? { id: myDeck.id, name: myDeck.name, commander } : null, newPlayerId),
    }))
    navigate('/play/night')
  }

  const addToCalendar = () => {
    const blob = new Blob([nightIcs(night, Date.now())], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${calendarTitle(night).replace(/[^\w -]+/g, '').trim() || 'Game night'}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const tradeCounts = matches
    .filter((m) => coming.some((c) => c.userId === m.friend))
    .map((m) => ({ name: coming.find((c) => c.userId === m.friend)!.name, n: m.they_have.length + m.they_want.length }))
    .filter((x) => x.n > 0)
  const giveBack = borrowed
    .filter((l) => l.lender && coming.some((c) => c.userId === l.lender!.user_id))
    .map((l) => ({ name: l.lender!.display_name, n: l.cards.reduce((s, c) => s + c.qty, 0) }))

  return (
    <div className="gn-page">
      <section className="gn-head">
        <span className="gn-when">{nightWhen(night.startsAt)}</span>
        <b className="gn-where">At {night.place}</b>
        <span className="gn-meta">{headerLine(night, me)}</span>
        {night.cancelled && <span className="gn-off">Called off</span>}
        {night.note && <span className="gn-note">{night.note}</span>}
      </section>

      {manage && !night.cancelled && !over && (
        <div className="chips">
          <button type="button" className="btn line sm" onClick={() => navigate(`/play/nights/${night.id}/edit`)}><Icon name="edit" aria-hidden />Change</button>
          <button type="button" className="btn line sm" onClick={() => setConfirmCancel(true)}><Icon name="event_busy" aria-hidden />Call it off</button>
        </div>
      )}

      {mine && !night.cancelled && !over && (
        <>
          <div className="gn-rsvp" role="group" aria-label="Are you going?">
            {ANSWERS.map((a) => (
              <button key={a.id} type="button" aria-pressed={mine.answer === a.id} disabled={busy} onClick={() => void answer(a.id, mine.deck)}>{a.label}</button>
            ))}
          </div>
          {(mine.answer === 'going' || mine.answer === 'maybe') && decks.length > 0 && (
            <label className="gn-form">
              <span className="field-label">Bringing</span>
              <select className="input" value={myDeck?.id ?? ''} disabled={busy} onChange={(e) => void answer(mine.answer!, decks.find((d) => d.id === e.target.value)?.name ?? null)}>
                <option value="">No deck picked</option>
                {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      {error && <div className="notice warn">{error}</div>}

      <div className="gn-label">{whoHeader(night)}</div>
      <div className="gn-who">
        {whoRows(night, me).map((r) => (
          <div key={r.key} className="gn-who-row"><span>{r.names}</span><span className={`gn-tone-${r.tone}`}>{r.status}</span></div>
        ))}
      </div>

      {!night.cancelled && (
        <section className="gn-ready">
          <h2>Ready for the night</h2>
          <span className="muted">Filled in from who's coming</span>
          <button type="button" className="link" onClick={pack}>Pack your bag{bag && bag.packed.length > 0 ? ` · ${bag.packed.length} packed` : ''}</button>
          {coming.length > 0 && (
            <button type="button" className="link" aria-expanded={showTrades} onClick={() => setShowTrades((v) => !v)}>
              Trade matches tonight{tradeCounts.length > 0 ? ` · ${tradeCounts.map((t) => `${t.name} ${t.n}`).join(', ')}` : ''}
            </button>
          )}
          {giveBack.map((g) => (
            <button key={g.name} type="button" className="link" onClick={() => navigate('/loans?tab=borrowed')}>
              Give back {g.name}'s {g.n === 1 ? '1 borrowed card' : `${g.n} borrowed cards`}
            </button>
          ))}
          {showTrades && <TradeMatchesTonight players={coming.map((c) => ({ name: c.name, userId: c.userId }))} />}
        </section>
      )}

      <div className="gn-bar">
        <button type="button" className="btn soft" onClick={addToCalendar}><Icon name="event" aria-hidden />Add to calendar</button>
        {!night.cancelled && <button type="button" className="btn gold grow" onClick={makePods}>Make pods on the night</button>}
      </div>

      {confirmCancel && (
        <Dialog
          title="Call off this game night?"
          onDismiss={() => setConfirmCancel(false)}
          actions={<>
            <button type="button" className="btn line" onClick={() => setConfirmCancel(false)}>Keep it</button>
            <button
              type="button"
              className="btn gold"
              onClick={() => {
                setConfirmCancel(false)
                cancelGameNight(night.id).then(load).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
              }}
            >
              Call it off
            </button>
          </>}
        >
          <p>Everyone invited is told it's off.</p>
        </Dialog>
      )}
    </div>
  )
}

// ---- Planning or changing a night ----

const pad = (n: number) => String(n).padStart(2, '0')
const dateInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const timeInput = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** Tomorrow at 7pm, for a new night. */
function defaultStart(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(19, 0, 0, 0)
  return d.getTime()
}

/** Plan a game night (/play/nights/new?pod=<id>) or change one (/play/nights/:id/edit). */
export function GameNightFormPage() {
  const { id } = useParams<{ id: string }>()
  const back = useBack(id ? `/play/nights/${id}` : '/play')
  return (
    <>
      <TopBar title={id ? 'Change game night' : 'Plan a game night'} onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(o) => <NightForm overview={o} nightId={id ?? null} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

function NightForm({ overview, nightId }: { overview: api.Overview; nightId: string | null }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const available = useNightsAvailable()
  const [loaded, setLoaded] = useState(nightId === null)
  const [podId, setPodId] = useState(params.get('pod') ?? overview.pods[0]?.id ?? '')
  const start = defaultStart(Date.now())
  const [date, setDate] = useState(dateInput(start))
  const [time, setTime] = useState(timeInput(start))
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const [guests, setGuests] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!nightId || !available) return
    gameNight(nightId).then((n) => {
      if (!n) { setError("That game night isn't there any more."); return }
      setPodId(n.podId)
      setDate(dateInput(n.startsAt))
      setTime(timeInput(n.startsAt))
      setPlace(n.place)
      setNote(n.note ?? '')
      setGuests(n.invitees.filter((i) => !i.member).map((i) => i.user.user_id))
      setLoaded(true)
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
  }, [nightId, available])

  if (available === false) return <div className="empty-state"><Icon name="event" />{NIGHTS_UNAVAILABLE}</div>
  if (overview.pods.length === 0) return <div className="empty-state"><Icon name="groups" />A game night is for a pod — make one on Friends first.</div>
  if (!loaded) return error ? <div className="notice warn">{error}</div> : <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>

  const pod = overview.pods.find((p) => p.id === podId)
  const friends = overview.friends
    .filter((f) => f.status === 'accepted' && !(pod?.members ?? []).includes(f.user_id))
    .map((f) => overview.people[f.user_id])
    .filter((p): p is api.Profile => !!p)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  const startsAt = new Date(`${date}T${time || '19:00'}`).getTime()
  const ok = !!pod && place.trim().length > 0 && Number.isFinite(startsAt)

  const save = async () => {
    if (!pod) return
    setBusy(true)
    setError(null)
    try {
      const n = await saveGameNight(nightId, pod.id, { startsAt, place, note, guests: guests.filter((g) => friends.some((f) => f.user_id === g)) })
      navigate(`/play/nights/${n.id}`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <form className="gn-form" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void save() }}>
      <span className="field-label">Pod</span>
      <select className="input" value={podId} disabled={!!nightId} onChange={(e) => { setPodId(e.target.value); setGuests([]) }}>
        {overview.pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <span className="field-label">Day</span>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <span className="field-label">Time</span>
      <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      <span className="field-label">Where</span>
      <input className="input" value={place} maxLength={PLACE_MAX} onChange={(e) => setPlace(e.target.value)} placeholder={`${overview.me?.display_name ?? 'Priya'}'s, the game store…`} required />
      <span className="field-label">Note (optional)</span>
      <textarea className="input" rows={3} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="Bring your new decks" />
      <span className="field-label">Everyone in {pod?.name ?? 'the pod'} is invited. Ask friends from outside it too:</span>
      {friends.length === 0 ? <span className="muted">No other friends to ask.</span> : (
        <div className="chips wrap">
          {friends.map((f) => (
            <button key={f.user_id} type="button" className="chip" aria-pressed={guests.includes(f.user_id)}
              onClick={() => setGuests((g) => (g.includes(f.user_id) ? g.filter((x) => x !== f.user_id) : [...g, f.user_id]))}>
              {f.display_name}
            </button>
          ))}
        </div>
      )}
      {error && <div className="notice warn">{error}</div>}
      <div className="gn-bar">
        <button type="submit" className="btn gold grow" disabled={!ok || busy}>{busy ? 'Saving…' : nightId ? 'Save changes' : 'Invite the pod'}</button>
      </div>
    </form>
  )
}
