import { countAction } from '../usage/usage'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useOverview } from '../social/SocialContext'
import { Icon } from '../components/Icon'
import { PageHeader, useBack } from '../components/kit'
import { lend, lendSources, loanDue, type LendSource } from '../collection/loans'
import { loansOf, placesOf } from '../collection/storagePlaces'
import { sendLoan } from '../collection/loanServer'
import { recordMoves, dayOf } from '../collection/copyHistoryStore'
import { lentMove } from '../collection/copyHistory'
import { gameNights } from '../lifecounter/gameNightStore'
import '../collection/storage.css'
import '../collection/loans.css'

type BackBy = 'none' | 'night' | 'date'

/**
 * Lend cards: what to lend — one card's copies (?card=<name>, from its Where it is) or any of the
 * cards in a place (?place=<id>, ticked) — to whom (a friend by account, or anyone by name), back by
 * when (no date, the next game night, or a day) and a note. Copies from a place come off it while
 * they're out. The logic is collection/loans.ts. Mirrors the Android app's LendScreen.kt. At /loans/lend.
 */
export function LendPage() {
  const [params] = useSearchParams()
  const cardName = params.get('card')
  const placeId = params.get('place')
  const back = useBack(placeId ? `/collections/place/${placeId}` : cardName ? `/card/${encodeURIComponent(cardName)}` : '/loans')
  const navigate = useNavigate()
  const { collections, decks, changeStorage, account } = useSync()
  const { overview, person } = useOverview()
  const sources = useMemo(
    () => lendSources(collections, decks, placeId ? { placeId } : { name: cardName ?? '' }),
    // Picked once: lending changes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [picked, setPicked] = useState<Map<string, number>>(() => new Map(cardName && sources[0] ? [[sources[0].key, 1]] : []))
  const friends = (overview?.friends ?? []).filter((f) => f.status === 'accepted')
    .map((f) => ({ id: f.user_id, name: person(f.user_id)?.display_name ?? 'Friend' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const [friendId, setFriendId] = useState<string | null>(null)
  const [someone, setSomeone] = useState(false)
  const [name, setName] = useState('')
  const nights = gameNights()
  const [backBy, setBackBy] = useState<BackBy>('none')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const count = [...picked.values()].reduce((n, v) => n + v, 0)
  const to = friendId ? friends.find((f) => f.id === friendId)?.name ?? '' : someone ? name.trim() : ''
  const place = placeId ? placesOf(collections).find((p) => p.id === placeId) : undefined
  const fromDeck = sources.find((s) => s.deckId && (picked.get(s.key) ?? 0) > 0)

  const set = (s: LendSource, n: number) => setPicked((m) => {
    const next = new Map(m)
    const v = Math.max(0, Math.min(s.qty, n))
    if (v > 0) next.set(s.key, v)
    else next.delete(s.key)
    return next
  })

  const go = () => {
    if (count === 0 || !to) return
    const now = Date.now()
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${now}-${Math.random()}`
    const loan = {
      id, to, lentAt: now,
      ...(friendId ? { friendId } : {}),
      ...(backBy === 'date' && date ? { backBy: date } : {}),
      ...(backBy === 'night' ? { gameNight: true } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    const picks = sources.filter((s) => (picked.get(s.key) ?? 0) > 0).map((s) => ({ source: s, qty: picked.get(s.key)! }))
    let after = collections
    changeStorage((c) => { after = lend(c, picks, loan); return after })
    const made = loansOf(after).find((l) => l.id === id)
    if (made) {
      countAction('loan_created')
      const due = loanDue(made, dayOf(now), []).label
      recordMoves(picks.map((p) => lentMove(now, { name: p.source.name, scryfallId: p.source.scryfallId }, p.qty, to, p.source.from, p.source.line?.placeId ?? null, due === 'No date' ? null : due)))
      if (made.friendId) void sendLoan(made)
    }
    navigate('/loans', { replace: true })
  }

  const title = count > 0 ? `Lend ${count} ${count === 1 ? 'card' : 'cards'}` : 'Lend cards'
  return (
    <>
      <PageHeader title={title} eyebrow={place ? `From ${place.name}` : cardName ?? undefined} onBack={back} />
      <div className="content-scroll lend-page">
        <section className="loan-card">
          {sources.length === 0 && <div className="dim">Nothing here to lend — copies already lent out aren’t offered.</div>}
          {sources.map((s) => {
            const n = picked.get(s.key) ?? 0
            return (
              <div key={s.key} className={`lend-row${n > 0 ? ' on' : ''}`}>
                <label className="lend-pick">
                  <input type="checkbox" checked={n > 0} onChange={() => set(s, n > 0 ? 0 : 1)} />
                  <span className="storage-text"><b>{s.name}{s.foil ? ' · foil' : ''}</b><span>from {s.from}</span></span>
                </label>
                {s.qty > 1 && (
                  <span className="lend-qty">
                    <button type="button" className="ib" aria-label="One fewer" disabled={n <= 0} onClick={() => set(s, n - 1)}><Icon name="remove" /></button>
                    <b>{n}/{s.qty}</b>
                    <button type="button" className="ib" aria-label="One more" disabled={n >= s.qty} onClick={() => set(s, n + 1)}><Icon name="add" /></button>
                  </span>
                )}
              </div>
            )
          })}
        </section>

        <div className="field-label">To</div>
        <div className="chips wrap">
          {friends.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={friendId === f.id} onClick={() => { setFriendId(f.id); setSomeone(false) }}>{f.name} (friend)</button>
          ))}
          <button type="button" className="chip" aria-pressed={someone} onClick={() => { setSomeone(true); setFriendId(null) }}>Someone else…</button>
        </div>
        {someone && <input className="input" style={{ marginTop: 8 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" aria-label="Their name" autoFocus />}
        {!account && friends.length === 0 && <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>Sign in to lend to friends by account.</div>}

        <div className="field-label" style={{ marginTop: 14 }}>Back by</div>
        <div className="chips wrap">
          <button type="button" className="chip" aria-pressed={backBy === 'none'} onClick={() => setBackBy('none')}>No date</button>
          {nights.exists && <button type="button" className="chip" aria-pressed={backBy === 'night'} onClick={() => setBackBy('night')}>Next game night</button>}
          <button type="button" className="chip" aria-pressed={backBy === 'date'} onClick={() => setBackBy('date')}>Pick a date</button>
        </div>
        {backBy === 'date' && <input className="input" type="date" style={{ marginTop: 8 }} value={date} min={dayOf(Date.now())} onChange={(e) => setDate(e.target.value)} aria-label="Back by" />}

        <div className="field-label" style={{ marginTop: 14 }}>Note</div>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for the Saturday event" maxLength={200} />

        {(friendId || fromDeck) && to && (
          <div className="loan-card dim" style={{ marginTop: 14, fontSize: 13 }}>
            {friendId ? `${to} gets a note in Friends: “Borrowed from ${overview?.me?.display_name ?? 'you'}: ${count} ${count === 1 ? 'card' : 'cards'}”. ` : ''}
            {fromDeck ? `The ${fromDeck.from} will show ${fromDeck.name} as lent out until it's back.` : ''}
          </div>
        )}
        <div className="pull-bar" style={{ marginTop: 16 }}>
          <button type="button" className="btn gold block" disabled={count === 0 || !to || (backBy === 'date' && !date)} onClick={go}>
            {to ? `Lend to ${to}` : 'Lend'}
          </button>
        </div>
      </div>
    </>
  )
}
