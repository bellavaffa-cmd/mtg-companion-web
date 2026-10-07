// Pieces of the social screens for blocking and reporting, messages, trade reputation, activity and
// two-way trade matches. The Android app's twin is ui/social/SocialMoreUi.kt.

import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { SectionHeader } from '../components/kit'
import type * as api from './api'
import { useOverview } from './SocialContext'
import { useSync } from '../sync/SyncContext'
import { Avatar, handle } from './ui'
import * as more from './more'
import {
  canRate, matchSentence, messageParts, positiveLine, REPORT_REASONS, tradesLine, withYouLine,
  type ReportReason,
} from './moreLogic'
import './more.css'

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

/** A message's text, with [[Card Name]] as links to the card. */
export function MessageText({ body }: { body: string }) {
  return (
    <>
      {messageParts(body).map((p, i) => (
        'card' in p
          ? <Link key={i} className="dm-card" to={`/card/${encodeURIComponent(p.card)}`}>{p.card}</Link>
          : <Fragment key={i}>{p.text}</Fragment>
      ))}
    </>
  )
}

/**
 * "Block or report" for someone, from their profile, a trade, a shared item or a conversation.
 * [item]: what a report is about, when it's one thing. [onBlocked]: after blocking (leave the screen).
 */
export function BlockReportButton({ userId, name, item, onBlocked, compact = false }: {
  userId: string
  name: string
  item?: { kind: more.ReportItemKind; id: string }
  onBlocked?: () => void
  compact?: boolean
}) {
  const available = more.useSocialMore()
  const [open, setOpen] = useState<'menu' | 'report' | 'block' | 'reported' | null>(null)
  if (!available) return null
  return (
    <>
      {compact ? (
        <button type="button" className="ib" aria-label={`Block or report ${name}`} title="Block or report" onClick={() => setOpen('menu')}>
          <Icon name="flag" />
        </button>
      ) : (
        <button type="button" className="btn line block" onClick={() => setOpen('menu')}>
          <Icon name="flag" aria-hidden />Block or report
        </button>
      )}
      {open === 'menu' && (
        <Dialog title={name} onDismiss={() => setOpen(null)} actions={<button type="button" className="btn line" onClick={() => setOpen(null)}>Cancel</button>}>
          <div className="list">
            <button type="button" className="person-row press" onClick={() => setOpen('report')}>
              <Icon name="flag" style={{ color: 'var(--gold)' }} />
              <span className="person-main"><span className="person-name">Report {name}</span><span className="dim">Tell us what's wrong. They won't know it was you.</span></span>
            </button>
            <button type="button" className="person-row press" onClick={() => setOpen('block')}>
              <Icon name="block" style={{ color: 'var(--error)' }} />
              <span className="person-main"><span className="person-name">Block {name}</span><span className="dim">They can't see your things or contact you.</span></span>
            </button>
          </div>
        </Dialog>
      )}
      {open === 'report' && <ReportDialog userId={userId} name={name} item={item} onClose={(sent) => setOpen(sent ? 'reported' : null)} />}
      {open === 'reported' && (
        <Dialog title="Thanks for telling us" onDismiss={() => setOpen(null)} actions={
          <>
            <button type="button" className="btn line" onClick={() => setOpen('block')}>Block {name}</button>
            <button type="button" className="btn gold" onClick={() => setOpen(null)}>Done</button>
          </>
        }>
          <p className="muted" style={{ margin: 0 }}>We'll look at your report. You can also block {name}, so they can't contact you.</p>
        </Dialog>
      )}
      {open === 'block' && <BlockDialog userId={userId} name={name} onClose={(blocked) => { setOpen(null); if (blocked) onBlocked?.() }} />}
    </>
  )
}

function BlockDialog({ userId, name, onClose }: { userId: string; name: string; onClose: (blocked: boolean) => void }) {
  const { refresh } = useOverview()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const block = async () => {
    setBusy(true)
    setError(null)
    try {
      await more.blockUser(userId)
      await refresh().catch(() => {})
      onClose(true)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Block ${name}?`} onDismiss={() => onClose(false)} actions={
      <>
        <button type="button" className="btn line" onClick={() => onClose(false)}>Cancel</button>
        <button type="button" className="btn danger" disabled={busy} onClick={() => void block()}>Block</button>
      </>
    }>
      <p className="muted" style={{ margin: 0 }}>
        You'll stop being friends, open trades between you are cancelled, and neither of you will see the other's decks, binders or messages. They can't ask to be friends or send you anything. Pods you're both in stay as they are. You can unblock them in Settings.
      </p>
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

function ReportDialog({ userId, name, item, onClose }: { userId: string; name: string; item?: { kind: more.ReportItemKind; id: string }; onClose: (sent: boolean) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    if (!reason) return
    setBusy(true)
    setError(null)
    try {
      await more.reportUser(userId, reason, note, item)
      onClose(true)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title={`Report ${name}`} onDismiss={() => onClose(false)} actions={
      <>
        <button type="button" className="btn line" onClick={() => onClose(false)}>Cancel</button>
        <button type="button" className="btn gold" disabled={busy || !reason} onClick={() => void send()}>Send report</button>
      </>
    }>
      <div className="field-label" style={{ marginTop: 0 }}>What's wrong?</div>
      <div className="report-reasons" role="radiogroup" aria-label="Reason">
        {REPORT_REASONS.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className={`chip${reason === r.id ? ' on' : ''}`} aria-pressed={reason === r.id} onClick={() => setReason(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <label className="field-label" htmlFor="report-note" style={{ marginTop: 14 }}>Anything else? (optional)</label>
      <textarea id="report-note" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened" />
      {item && item.kind !== 'profile' && <p className="dim" style={{ fontSize: 12.5, margin: '8px 0 0' }}>The report says which {item.kind === 'collection' ? 'binder' : item.kind} it's about.</p>}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

/** People the user has blocked, each with Unblock — the Settings section. */
export function BlockedPeople() {
  const { account } = useSync()
  const available = more.useSocialMore()
  const [people, setPeople] = useState<more.BlockedPerson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => more.blockedUsers().then((l) => { setPeople(l); setError(null) }).catch((e: unknown) => setError(message(e)))
  useEffect(() => { if (available) void load() }, [available])
  if (!account) return <section className="panel"><p className="dim settings-note">Sign in to see who you've blocked.</p></section>
  if (available === false) return <section className="panel"><p className="dim settings-note">Not available yet.</p></section>
  if (error) return <div className="notice warn">{error}</div>
  if (!people) return <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
  return (
    <section className="panel">
      <p className="dim settings-note">People you've blocked can't see your things, ask to be friends, or send you anything.</p>
      {people.length === 0 ? (
        <div className="dim">You haven't blocked anyone.</div>
      ) : (
        <div className="list">
          {people.map((p) => (
            <div key={p.user_id} className="person-row compact">
              <Avatar profile={p} size={34} />
              <span className="person-main">
                <span className="person-name">{p.display_name}</span>
                <span className="dim">{handle(p)}</span>
              </span>
              <UnblockButton userId={p.user_id} onDone={load} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function UnblockButton({ userId, onDone }: { userId: string; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" className="btn line sm" disabled={busy} onClick={async () => {
      setBusy(true)
      try { await more.unblockUser(userId); await onDone() } finally { setBusy(false) }
    }}>Unblock</button>
  )
}

/** A friend's trading record: "Trades completed: N · since …", how many with the user, thumbs up. */
export function ReputationLine({ userId }: { userId: string }) {
  const available = more.useSocialMore()
  const [rep, setRep] = useState<more.Reputation | null>(null)
  useEffect(() => {
    if (!available) return
    let cancelled = false
    more.tradeReputation(userId).then((r) => { if (!cancelled) setRep(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [available, userId])
  if (!rep) return null
  return (
    <div className="rep-line">
      <span>{tradesLine(rep.total, rep.since)}</span>
      {rep.total > 0 && <span className="dim">{withYouLine(rep.with_you)}</span>}
      {rep.positive > 0 && <span className="rep-up"><Icon name="thumb_up" aria-hidden />{positiveLine(rep.positive)}</span>}
    </div>
  )
}

/** Thumbs up or down for the other side of a finished trade; [rating]: what the user said before. */
export function RateTrade({ trade, me, rating, name, onRated }: { trade: api.Trade; me: string; rating: boolean | undefined; name: string; onRated: (positive: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canRate(trade, me)) return null
  const rate = async (positive: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await more.rateTrade(trade.id, positive)
      onRated(positive)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rate-trade">
      <span className="dim">{rating === undefined ? `How did trading with ${name} go?` : 'Thanks — you can change it.'}</span>
      <button type="button" className={`ib${rating === true ? ' on' : ''}`} aria-pressed={rating === true} aria-label="Good trade" disabled={busy} onClick={() => void rate(true)}><Icon name="thumb_up" /></button>
      <button type="button" className={`ib${rating === false ? ' on' : ''}`} aria-pressed={rating === false} aria-label="Bad trade" disabled={busy} onClick={() => void rate(false)}><Icon name="thumb_down" /></button>
      {error && <span className="field-error" role="alert" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  )
}

/** Friends with matches either way, each opening a trade started from them. */
export function TradeMatchesSection({ overview }: { overview: api.Overview }) {
  const available = more.useSocialMore()
  const navigate = useNavigate()
  const [matches, setMatches] = useState<more.TradeMatch[]>([])
  useEffect(() => {
    if (!available) return
    let cancelled = false
    more.tradeMatches().then((m) => { if (!cancelled) setMatches(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [available, overview])
  const shown = matches.filter((m) => overview.people[m.friend] && (m.they_have.length > 0 || m.they_want.length > 0))
  if (shown.length === 0) return null
  return (
    <>
      <SectionHeader title="Trade matches" />
      <div className="list">
        {shown.slice(0, 8).map((m) => {
          const p = overview.people[m.friend]
          return (
            <button key={m.friend} type="button" className="person-row press" onClick={() => navigate(`/trades/new?to=${m.friend}`, { state: { want: m.they_have.map(more.matchAsTrade), give: m.they_want.map(more.matchAsTrade) } })}>
              <Avatar profile={p} size={44} />
              <span className="person-main">
                <span className="person-name">{matchSentence(p.display_name, m.they_have.length, m.they_want.length)}</span>
                <span className="dim">Tap to start a trade with them</span>
              </span>
              <Icon name="swap_horiz" style={{ color: 'var(--gold)' }} />
            </button>
          )
        })}
      </div>
    </>
  )
}

/** The Friends page's Activity tab (ActivityFeed.tsx). */
export { ActivityList } from './ActivityFeed'
