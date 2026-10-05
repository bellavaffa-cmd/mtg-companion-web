import { countAction } from '../usage/usage'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { useBack } from '../components/kit'
import type * as api from '../social/api'
import { useOverview } from '../social/SocialContext'
import { Avatar, handle } from '../social/ui'
import * as more from '../social/more'
import { MESSAGE_MAX, mergeMessages, previewLine, timeAgo, type DirectMessage } from '../social/moreLogic'
import { BlockReportButton, MessageText } from '../social/MoreUi'
import { SocialGate } from './FriendsPage'

// Direct messages between friends: the list of conversations (/messages) and one conversation
// (/messages/<friend id>). The Android app's twin is ui/social/MessagesScreen.kt.

/** Every conversation, newest first, with unread counts; new ones arrive live. */
export function MessagesPage() {
  const back = useBack('/friends')
  return (
    <>
      <TopBar title="Messages" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(overview) => <ConversationList overview={overview} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

/** Every conversation — on this page and on Friends' Messages tab. */
export function ConversationList({ overview }: { overview: api.Overview }) {
  const navigate = useNavigate()
  const available = more.useSocialMore()
  const me = overview.me!.user_id
  const [list, setList] = useState<more.Conversation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(() => {
    more.listConversations()
      .then((l) => { setList(l); setError(null); setNow(Date.now()) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
  }, [])
  useEffect(() => { if (available) load() }, [available, load])
  more.useDirectMessages(() => load(), load, !!available)

  if (available === false) return <div className="empty-state"><Icon name="chat" />Not available yet.</div>
  if (error && !list) return <div className="empty-state"><Icon name="cloud_off" />{error}<button type="button" className="btn line" onClick={load}>Try again</button></div>
  if (!list) return <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>

  const friends = overview.friends.filter((f) => f.status === 'accepted' && !list.some((c) => c.other.user_id === f.user_id))
  return (
    <>
      {list.length === 0 && <div className="notice">No messages yet. Start a conversation with a friend below, or from their profile.</div>}
      <div className="list dm-list">
        {list.map((c) => (
          <button key={c.id} type="button" className="person-row press" onClick={() => navigate(`/messages/${c.other.user_id}`)}>
            <Avatar profile={c.other} size={44} />
            <span className="person-main">
              <span className="person-name">{c.other.display_name}</span>
              <span className="dim">{previewLine(c.last, me)}{c.last ? ` · ${timeAgo(c.last.created_at, now)}` : ''}</span>
            </span>
            {c.unread > 0 && <span className="count-badge">{c.unread}</span>}
          </button>
        ))}
      </div>
      {friends.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: 20 }}>Message a friend</div>
          <div className="list">
            {friends.map((f) => {
              const p = overview.people[f.user_id] ?? null
              return (
                <button key={f.user_id} type="button" className="person-row compact press" onClick={() => navigate(`/messages/${f.user_id}`)}>
                  <Avatar profile={p} size={34} />
                  <span className="person-main"><span className="person-name">{p?.display_name ?? 'Someone'}</span></span>
                  <Icon name="chat" style={{ color: 'var(--t2)' }} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

/** One conversation: older messages as you scroll up, new ones live, card names as links. */
export function ConversationPage() {
  const { id = '' } = useParams<{ id: string }>()
  const back = useBack('/messages')
  const { overview } = useOverview()
  const name = overview?.people[id]?.display_name
  return (
    <>
      <TopBar title={name ?? 'Messages'} onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(o) => <Conversation overview={o} other={id} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

const PAGE = 50

function Conversation({ overview, other }: { overview: api.Overview; other: string }) {
  const navigate = useNavigate()
  const available = more.useSocialMore()
  const me = overview.me!.user_id
  const them = overview.people[other] ?? null
  const isFriend = overview.friends.some((f) => f.user_id === other && f.status === 'accepted')
  const [messages, setMessages] = useState<DirectMessage[] | null>(null)
  const [older, setOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const end = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const loadNewest = useCallback(() => {
    more.getMessages(other, null, PAGE)
      .then((page) => {
        setMessages((list) => mergeMessages(list ?? [], page))
        setOlder((had) => (had ? had : page.length >= PAGE))
        setNow(Date.now())
        void more.markRead(other).catch(() => {})
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
  }, [other])
  useEffect(() => { if (available) loadNewest() }, [available, loadNewest])
  more.useDirectMessages((m) => {
    if (m.sender !== other && m.recipient !== other) return
    stick.current = true
    setMessages((list) => mergeMessages(list ?? [], [m]))
    setNow(Date.now())
    if (m.sender === other) void more.markRead(other).catch(() => {})
  }, loadNewest, !!available)

  useLayoutEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const loadOlder = async () => {
    const first = messages?.[0]?.id
    if (!first) return
    stick.current = false
    const page = await more.getMessages(other, first, PAGE).catch(() => [])
    setMessages((list) => mergeMessages(list ?? [], page))
    setOlder(page.length >= PAGE)
  }

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const sent = await more.sendMessage(other, body)
      countAction('message_sent')
      stick.current = true
      setMessages((list) => mergeMessages(list ?? [], [sent]))
      setDraft('')
      setNow(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (available === false) return <div className="empty-state"><Icon name="chat" />Not available yet.</div>
  if (!them) return <div className="empty-state"><Icon name="person_off" />You can only message friends.</div>

  return (
    <>
      <div className="person-row" style={{ marginTop: 4 }}>
        <Avatar profile={them} size={40} />
        <button type="button" className="person-main link-like" style={{ textAlign: 'left' }} onClick={() => navigate(`/friends/${other}`)}>
          <span className="person-name">{them.display_name}</span>
          <span className="dim">{handle(them)}</span>
        </button>
        <BlockReportButton compact userId={other} name={them.display_name} item={{ kind: 'profile', id: other }} onBlocked={() => navigate('/messages', { replace: true })} />
      </div>
      <div className="dm-thread">
        {older && <button type="button" className="btn line sm" style={{ alignSelf: 'center' }} onClick={() => void loadOlder()}>Show earlier messages</button>}
        {!messages ? (
          <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
        ) : messages.length === 0 ? (
          <div className="dim" style={{ textAlign: 'center', padding: 20 }}>Say hello. Write a card's name in [[double brackets]] to link it.</div>
        ) : messages.map((m) => (
          <div key={m.id} className={`dm-bubble${m.sender === me ? ' mine' : ''}`}>
            <MessageText body={m.body} />
            <div className="dm-time">{timeAgo(m.created_at, now)}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {error && <div className="notice warn">{error}</div>}
      {isFriend ? (
        <form className="dm-compose" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <textarea
            className="input"
            rows={1}
            maxLength={MESSAGE_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder="Message — [[Card Name]] links a card"
            aria-label={`Message ${them.display_name}`}
          />
          <button type="submit" className="btn gold" disabled={busy || !draft.trim()} aria-label="Send"><Icon name="send" aria-hidden /></button>
        </form>
      ) : (
        <div className="notice">You're no longer friends, so you can't send new messages.</div>
      )}
    </>
  )
}
