// Comments on a shared deck: the Comments tab of SharedItemPage. Friends the deck is shared with
// comment on it or on one of its cards and reply one level deep; the owner hides or deletes any
// comment, authors delete their own. The Android app's twin is ui/social/DeckComments.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, IconButton, SearchPill, toArtCrop } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import type { Profile } from './api'
import * as activity from './activity'
import {
  COMMENT_MAX, commentActions, commentCount, commentHeader, commentReportId, commentsNote, composerPlaceholder, offerCard, swapReply, threadComments,
  type DeckComment, type DeckComments as Loaded,
} from './activityLogic'
import { forTradeLines } from './moreLogic'
import { BlockReportButton } from './MoreUi'
import './more.css'

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

interface PickCard { name: string; imageUrl: string | null }

/**
 * [owner]'s deck [deckId] — its cards [deckCards], commanders included — and its comments.
 * [onCount]: how many comments there are, for the tab's "Comments · 3".
 */
export function DeckComments({ owner, deckId, deckCards, onCount }: {
  owner: Pick<Profile, 'user_id' | 'display_name'>
  deckId: string
  deckCards: PickCard[]
  onCount: (n: number) => void
}) {
  const navigate = useNavigate()
  const { account, collections } = useSync()
  const me = account?.userId ?? null
  const available = activity.useActivityComments()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [card, setCard] = useState<PickCard | null>(null)
  const [replyTo, setReplyTo] = useState<DeckComment | null>(null)
  const [picking, setPicking] = useState(false)
  const [confirm, setConfirm] = useState<DeckComment | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    activity.deckComments(owner.user_id, deckId)
      .then((d) => { setData(d ?? { is_owner: false, can_comment: false, comments: [] }); setError(null) })
      .catch((e: unknown) => setError(message(e)))
  useEffect(() => { if (available) void load() }, [available, owner.user_id, deckId]) // eslint-disable-line react-hooks/exhaustive-deps

  const threads = useMemo(() => threadComments(data?.comments ?? []), [data])
  const count = commentCount(threads)
  useEffect(() => { onCount(count) }, [count, onCount])

  if (available === false) return <div className="empty-state"><Icon name="forum" />Comments aren't available yet.</div>
  if (error && !data) return <div className="empty-state"><Icon name="cloud_off" />{error}<button type="button" className="btn line" onClick={() => void load()}>Try again</button></div>
  if (!data) return <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>

  const isOwner = me === owner.user_id
  const names = deckCards.map((c) => c.name)

  const post = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await activity.postComment(owner.user_id, deckId, body, replyTo?.id ?? null, replyTo ? null : card)
      setText('')
      setCard(null)
      setReplyTo(null)
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const run = async (f: () => Promise<void>) => {
    try { await f(); await load() } catch (e) { setError(message(e)) }
  }

  const row = (c: DeckComment) => {
    const haveCard = !!c.card_name && !!offerCard(collections, c.card_name)
    const can = commentActions(c, { me, owner: owner.user_id, canComment: data.can_comment, deckCards: names, haveCard })
    const [who, ...where] = commentHeader(c, me, owner.user_id, names).split(' · ')
    return (
      <div key={c.id} className={`comment-card${c.parent ? ' reply' : ''}${c.hidden ? ' hidden-comment' : ''}`}>
        <div className="comment-head">
          <span><b>{who}</b>{where.length > 0 ? ` · ${where.join(' · ')}` : ''}</span>
          {can.hide && <IconButton icon={c.hidden ? 'visibility' : 'visibility_off'} label={c.hidden ? 'Show this comment' : 'Hide this comment'} onClick={() => void run(() => activity.hideComment(c.id, !c.hidden))} />}
          {can.remove && <IconButton icon="delete" label="Delete this comment" onClick={() => setConfirm(c)} />}
          {can.report && <BlockReportButton compact userId={c.author.user_id} name={c.author.display_name} item={{ kind: 'deck', id: commentReportId(c.id) }} onBlocked={() => void load()} />}
        </div>
        <span className="comment-body">{c.body}</span>
        {(can.reply || can.swap || can.offer) && (
          <div className="comment-actions">
            {can.reply && <button type="button" className="activity-action" onClick={() => { setReplyTo(c); setCard(null) }}>Reply</button>}
            {can.swap && (
              <button
                type="button"
                className="activity-action"
                onClick={() => {
                  if (isOwner) navigate(`/decks/${encodeURIComponent(deckId)}`, { state: { tab: 'Considering' } })
                  else { setReplyTo(c); setCard(null); setText(swapReply(c.card_name!)) }
                }}
              >Consider a swap</button>
            )}
            {can.offer && (
              <button
                type="button"
                className="activity-action"
                onClick={() => {
                  const give = offerCard(collections, c.card_name!)
                  navigate(`/trades/new?to=${owner.user_id}`, { state: { give: give ? [give] : [] } })
                }}
              >Offer it in a trade</button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="list" style={{ marginTop: 14 }}>
        {threads.length === 0 && <div className="empty-state"><Icon name="forum" />No comments yet.{data.can_comment ? ' Say what you think, or pick a card to talk about.' : ''}</div>}
        {threads.flatMap((t) => [row(t.comment), ...t.replies.map(row)])}
      </div>
      <p className="dim activity-note">{commentsNote(owner.display_name, isOwner)}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {data.can_comment && (
        <form className="comment-composer" onSubmit={(e) => { e.preventDefault(); void post() }}>
          {(card || replyTo) && (
            <div className="comment-chips">
              {replyTo && (
                <button type="button" className="chip" onClick={() => setReplyTo(null)} aria-label="Stop replying">
                  Reply to {replyTo.author.user_id === me ? 'yourself' : replyTo.author.display_name}<Icon name="close" aria-hidden />
                </button>
              )}
              {card && !replyTo && (
                <button type="button" className="chip" onClick={() => setCard(null)} aria-label={`Not about ${card.name}`}>
                  On {card.name}<Icon name="close" aria-hidden />
                </button>
              )}
            </div>
          )}
          {!replyTo && <button type="button" className="on-card" aria-label="Pick a card to comment on" onClick={() => setPicking(true)}>On a card</button>}
          <label htmlFor="deck-comment" className="sr-only">Comment</label>
          <input
            id="deck-comment"
            value={text}
            maxLength={COMMENT_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder={composerPlaceholder(owner.display_name, isOwner, replyTo ? (replyTo.author.user_id === me ? 'yourself' : replyTo.author.display_name) : null)}
          />
          <button type="submit" className="send" aria-label="Post" disabled={busy || !text.trim()}><Icon name="send" /></button>
        </form>
      )}
      {picking && (
        <CardPick
          deckCards={deckCards}
          yours={isOwner ? [] : forTradeLines(collections).map((l) => ({ name: l.entry.name, imageUrl: l.entry.imageUrl ?? null }))}
          onPick={(c) => { setCard(c); setPicking(false) }}
          onClose={() => setPicking(false)}
        />
      )}
      {confirm && (
        <Dialog
          title="Delete this comment?"
          onDismiss={() => setConfirm(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="btn gold" onClick={() => { const c = confirm; setConfirm(null); void run(() => activity.deleteComment(c.id)) }}>Delete</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>{confirm.parent ? 'It goes for everyone.' : 'It goes for everyone, with its replies.'}</p>
        </Dialog>
      )}
    </>
  )
}

/** "On a card": one of the deck's cards, or — for a friend — one of their own cards for trade, to suggest. */
function CardPick({ deckCards, yours, onPick, onClose }: { deckCards: PickCard[]; yours: PickCard[]; onPick: (c: PickCard) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const match = (list: PickCard[]) =>
    list.filter((c, i) => list.findIndex((o) => o.name === c.name) === i && (!q || c.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)
  const inDeck = match(deckCards)
  const mine = match(yours.filter((y) => !deckCards.some((d) => d.name === y.name)))
  const pickRow = (c: PickCard) => (
    <button key={c.name} type="button" className="person-row press" onClick={() => onPick(c)}>
      <ArtImage className="thumb" src={toArtCrop(c.imageUrl)} seed={c.name} />
      <span className="person-main"><span className="person-name">{c.name}</span></span>
    </button>
  )
  return (
    <Dialog title="Comment on a card" onDismiss={onClose} actions={<button type="button" className="btn line" onClick={onClose}>Cancel</button>}>
      <SearchPill value={query} onChange={setQuery} placeholder="Card name" autoFocus />
      <div className="list comment-pick-list" style={{ marginTop: 10 }}>
        {inDeck.length > 0 && <div className="eyebrow">In the deck</div>}
        {inDeck.map(pickRow)}
        {mine.length > 0 && <div className="eyebrow">Suggest one of yours for trade</div>}
        {mine.map(pickRow)}
        {inDeck.length + mine.length === 0 && <p className="muted" style={{ margin: 0 }}>No cards match “{query}”.</p>}
      </div>
    </Dialog>
  )
}
