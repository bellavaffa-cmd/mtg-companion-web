import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { Dialog } from '../components/Dialog'
import { PageHeader, SegmentedTabs, rise, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { loanCardFrom, loansOf, stillOut } from '../collection/storagePlaces'
import { loanDue, loanPeople, loansFromTags, reminderText, returnCards, shortDay, taggedLentCopies, type LoanPerson } from '../collection/loans'
import { remindFriend, sendFriendLoans, sendLoan } from '../collection/loanServer'
import { recordMoves, dayOf } from '../collection/copyHistoryStore'
import { returnedMove } from '../collection/copyHistory'
import { gameNights } from '../lifecounter/gameNightStore'
import { myBorrowedLoans, type BorrowedLoan } from '../social/api'
import type { Collection, Loan } from '../types/models'
import '../collection/storage.css'
import '../collection/loans.css'

/**
 * Loans: the cards lent out, a group per person — overdue first, each card with where it goes back
 * to — with Got them back (every card back where it came from), Some back… and Remind (a friend gets
 * a notification; anyone else, a message to send). Borrowed: what friends have lent the user. And,
 * while copies are still marked with "lent" tags, a one-time Turn them into loans. The logic is
 * collection/loans.ts. Mirrors the Android app's LoansScreen.kt. At /loans (?tab=borrowed).
 */
export function LoansPage() {
  const back = useBack('/collections?tab=storage')
  const navigate = useNavigate()
  const { collections, decks, changeStorage, setCardTags, account } = useSync()
  const [params, setParams] = useSearchParams()
  const borrowedTab = params.get('tab') === 'borrowed'
  const loans = loansOf(collections)
  const today = dayOf(Date.now())
  const nights = useMemo(() => gameNights().nights.map((n) => ({ at: n.at, day: dayOf(n.at) })), [])
  const people = useMemo(() => loanPeople(loans, today, nights), [loans, today, nights])
  const tagged = useMemo(() => taggedLentCopies(collections), [collections])
  const [borrowed, setBorrowed] = useState<BorrowedLoan[] | null | 'failed'>(null)
  const [some, setSome] = useState<LoanPerson | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const lentCount = people.reduce((n, p) => n + p.copies, 0)
  const borrowedCount = Array.isArray(borrowed) ? borrowed.reduce((n, l) => n + l.cards.reduce((m, c) => m + c.qty, 0), 0) : 0

  // The friend side, best effort: send what's out (in case a send was missed), and fetch what's borrowed.
  useEffect(() => {
    if (!account) return
    void sendFriendLoans(loansOf(collections), Date.now())
    myBorrowedLoans().then(setBorrowed).catch(() => setBorrowed('failed'))
    // Once per visit to the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  const gotBack = (person: LoanPerson, counts?: Map<string, number[]>) => {
    const now = Date.now()
    let after: Collection[] = collections
    changeStorage((c) => {
      let out = c
      for (const loan of person.loans) out = returnCards(out, loan.id, now, counts?.get(loan.id))
      after = out
      return out
    })
    // History: each card back, and where to.
    const moves = person.loans.flatMap((loan) => loan.cards.flatMap((card, i) => {
      const n = Math.min(stillOut(card), counts ? counts.get(loan.id)?.[i] ?? 0 : stillOut(card))
      return n > 0 ? [returnedMove(now, card, n, person.name, loanCardFrom(card, after, decks), card.placeId ?? null)] : []
    }))
    recordMoves(moves)
    for (const loan of loansOf(after).filter((l) => person.loans.some((p) => p.id === l.id))) void sendLoan(loan)
    setSome(null)
    setNote(counts ? 'Got those back — each card is where it came from.' : `Got everything back from ${person.name} — each card is where it came from.`)
  }

  const remind = async (person: LoanPerson) => {
    if (person.friendId) {
      const r = await remindFriend(person.loans)
      if (r === 'sent') { setNote(`Reminded ${person.name}.`); return }
      if (r === 'already') { setNote(`${person.name} was reminded in the last 12 hours.`); return }
    }
    const text = reminderText(person.name, person.loans)
    try {
      if (navigator.share) { await navigator.share({ text }); return }
    } catch { /* closed the share sheet */ return }
    try {
      await navigator.clipboard.writeText(text)
      setNote('Reminder copied — paste it in a message.')
    } catch {
      setNote(text)
    }
  }

  const convert = () => {
    const now = Date.now()
    let made = 0
    let retag: { scryfallId: string; tags: string[] }[] = []
    changeStorage((c) => {
      let n = 0
      const out = loansFromTags(c, now, () => `${now.toString(36)}-${++n}-${Math.random().toString(36).slice(2, 8)}`)
      made = out.loans.length
      retag = out.retag
      return out.collections
    })
    for (const r of retag) setCardTags(r.scryfallId, r.tags)
    setNote(`Made ${made} ${made === 1 ? 'loan' : 'loans'} from your “lent” tags.`)
  }

  return (
    <>
      <PageHeader title="Loans" onBack={back} />
      <div className="content-scroll">
        <div className="rise" style={{ ...rise(0), marginBottom: 14, maxWidth: 560 }}>
          <SegmentedTabs
            labels={[`Lent out · ${lentCount}`, `Borrowed · ${borrowedCount}`]}
            selected={borrowedTab ? 1 : 0}
            onSelect={(i) => setParams(i === 1 ? { tab: 'borrowed' } : {}, { replace: true })}
          />
        </div>
        {note && <div className="notice" role="status" style={{ maxWidth: 560, marginBottom: 12 }}>{note}</div>}

        {!borrowedTab && (
          <div className="loan-list">
            {tagged > 0 && (
              <div className="loan-card">
                <b>{tagged} {tagged === 1 ? 'copy is' : 'copies are'} tagged “lent”</b>
                <span className="dim">Turn the tags into loans, with who has them, and the tags come off.</span>
                <div className="loan-actions"><button type="button" className="btn gold" onClick={convert}>Turn “lent” tags into loans</button></div>
              </div>
            )}
            {people.length === 0 && (
              <EmptyState icon="handshake" text="Nothing lent out. Open a card or one of your places to lend from it." actions={[{ label: 'Your places', icon: 'shelves', to: '/collections?tab=storage' }, { label: 'Search cards', icon: 'search', to: '/search' }]} />
            )}
            {people.map((p) => (
              <PersonCard
                key={p.key} person={p} collections={collections} decks={decks} today={today}
                onBack={() => gotBack(p)} onSome={() => setSome(p)} onRemind={() => void remind(p)}
              />
            ))}
            {people.length > 0 && <div className="dim" style={{ fontSize: 12 }}>“Got them back” puts each card where it came from.</div>}
          </div>
        )}

        {borrowedTab && (
          <div className="loan-list">
            {!account && <div className="empty-state"><Icon name="handshake" /><div>Sign in to see what friends have lent you.</div></div>}
            {account && borrowed === null && <div className="dim">Loading…</div>}
            {account && borrowed === 'failed' && <div className="empty-state"><Icon name="cloud_off" /><div>Couldn’t load what friends have lent you. Try again later.</div></div>}
            {account && Array.isArray(borrowed) && borrowed.length === 0 && (
              <div className="empty-state"><Icon name="handshake" /><div>Nothing borrowed. When a friend lends you cards in Manabind, they show here.</div></div>
            )}
            {Array.isArray(borrowed) && borrowed.map((l) => <BorrowedCard key={l.id} loan={l} today={today} />)}
          </div>
        )}
        <div style={{ height: 24 }} />
        {!borrowedTab && (
          <button type="button" className="btn line" onClick={() => navigate('/collections?tab=storage')}>
            <Icon name="shelves" aria-hidden />Lend from a place
          </button>
        )}
      </div>
      {some && <SomeBackDialog person={some} collections={collections} decks={decks} onDismiss={() => setSome(null)} onDone={(counts) => gotBack(some, counts)} />}
    </>
  )
}

function PersonCard({ person, collections, decks, today, onBack, onSome, onRemind }: {
  person: LoanPerson; collections: Collection[]; decks: import('../types/models').Deck[]; today: string
  onBack: () => void; onSome: () => void; onRemind: () => void
}) {
  const money = useMoney()
  const data = useCardData([...new Set(person.loans.flatMap((l) => l.cards.map((c) => c.scryfallId)))])
  const value = data
    ? person.loans.reduce((n, l) => n + l.cards.reduce((m, c) => {
      const card = data.get(c.scryfallId)
      return m + (Number(c.foil ? card?.prices?.usd_foil ?? card?.prices?.usd : card?.prices?.usd ?? card?.prices?.usd_foil) || 0) * stillOut(c)
    }, 0), 0)
    : null
  const notes = [...new Set(person.loans.map((l) => l.note).filter(Boolean))]
  const single = person.copies === 1
  const dates = person.loans.filter((l) => l.backBy).map((l) => `Back by ${shortDay(l.backBy!, Number(today.slice(0, 4)))}`).filter((v, i, a) => a.indexOf(v) === i).join(' · ')
  return (
    <section className={`loan-card${person.overdue > 0 ? ' overdue' : ''}`}>
      <div className="loan-h">
        <h2>{person.name}</h2>
        <span className={person.overdue > 0 ? 'late' : 'dim'}>{person.label}</span>
      </div>
      <div className="loan-sum">
        {person.copies} {single ? 'card' : 'cards'}{value !== null && value > 0 ? ` · ${money.format(value, true)}` : ''}
        {notes.length > 0 ? ` · “${notes.join('”, “')}”` : ''}
      </div>
      {person.loans.flatMap((l) => l.cards.filter((c) => stillOut(c) > 0).map((c, i) => (
        <div key={`${l.id}:${i}`} className="loan-line">
          <span>{stillOut(c) > 1 ? `${stillOut(c)}× ` : ''}{c.name}{c.foil ? ' · foil' : ''}</span>
          <span className="dim">→ {loanCardFrom(c, collections, decks)}</span>
        </div>
      )))}
      {/* The dates, when there's more to say than the one already beside the name. */}
      {dates && person.overdue === 0 && dates !== person.label && <div className="dim" style={{ fontSize: 12 }}>{dates}</div>}
      <div className="loan-actions">
        <button type="button" className="btn gold" onClick={onBack}>Got them back</button>
        {person.copies > 1 && <button type="button" className="btn soft" onClick={onSome}>Some back…</button>}
        <button type="button" className="btn soft remind" onClick={onRemind}>Remind {person.name}</button>
      </div>
    </section>
  )
}

/** Some of a person's cards back: how many of each. */
function SomeBackDialog({ person, collections, decks, onDismiss, onDone }: {
  person: LoanPerson; collections: Collection[]; decks: import('../types/models').Deck[]; onDismiss: () => void; onDone: (counts: Map<string, number[]>) => void
}) {
  const [counts, setCounts] = useState<Map<string, number[]>>(() => new Map(person.loans.map((l) => [l.id, l.cards.map(() => 0)])))
  const set = (loan: Loan, i: number, n: number) => setCounts((m) => {
    const next = new Map(m)
    const arr = [...(next.get(loan.id) ?? [])]
    arr[i] = Math.max(0, Math.min(stillOut(loan.cards[i]), n))
    next.set(loan.id, arr)
    return next
  })
  const total = [...counts.values()].flat().reduce((n, v) => n + v, 0)
  return (
    <Dialog
      title={`What did ${person.name} give back?`}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={total === 0} onClick={() => onDone(counts)}>Got {total} back</button>
        </>
      }
    >
      <div className="loan-some">
        {person.loans.flatMap((l) => l.cards.map((c, i) => stillOut(c) > 0 && (
          <div key={`${l.id}:${i}`} className="loan-some-row">
            <div className="storage-text"><b>{c.name}{c.foil ? ' · foil' : ''}</b><span>→ {loanCardFrom(c, collections, decks)}</span></div>
            <button type="button" className="ib" aria-label={`One fewer ${c.name}`} onClick={() => set(l, i, (counts.get(l.id)?.[i] ?? 0) - 1)}><Icon name="remove" /></button>
            <b>{counts.get(l.id)?.[i] ?? 0}/{stillOut(c)}</b>
            <button type="button" className="ib" aria-label={`One more ${c.name}`} onClick={() => set(l, i, (counts.get(l.id)?.[i] ?? 0) + 1)}><Icon name="add" /></button>
          </div>
        )))}
      </div>
    </Dialog>
  )
}

function BorrowedCard({ loan, today }: { loan: BorrowedLoan; today: string }) {
  const due = loanDue(
    { id: loan.clientId, to: '', lentAt: loan.lentAt, cards: loan.cards.map((c) => ({ name: c.name, scryfallId: c.printingId ?? '', qty: c.qty })), ...(loan.backBy ? { backBy: loan.backBy } : {}), ...(loan.gameNight ? { gameNight: true } : {}) },
    today, [],
  )
  const n = loan.cards.reduce((m, c) => m + c.qty, 0)
  return (
    <section className={`loan-card${due.overdue > 0 ? ' overdue' : ''}`}>
      <div className="loan-h">
        <h2>Borrowed from {loan.lender?.display_name ?? 'a friend'}</h2>
        <span className={due.overdue > 0 ? 'late' : 'dim'}>{due.label}</span>
      </div>
      <div className="loan-sum">{n} {n === 1 ? 'card' : 'cards'}{loan.note ? ` · “${loan.note}”` : ''}</div>
      {loan.cards.map((c, i) => <div key={i} className="loan-line"><span>{c.qty > 1 ? `${c.qty}× ` : ''}{c.name}</span></div>)}
    </section>
  )
}
