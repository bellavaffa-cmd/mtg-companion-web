import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { IconButton, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { activeDecks } from '../decks/deckFolders'
import { seasonTable } from '../decks/league'
import { countAction } from '../usage/usage'
import { SocialGate } from './FriendsPage'
import * as api from '../social/api'
import { Avatar } from '../social/ui'
import { BlockReportButton, MessageText } from '../social/MoreUi'
import { communityRules } from '../social/communityRules'
import { CHAT_UNAVAILABLE, markPodRead, podChats, podMessages, sendPodMessage, sharePodMessage, useGameNights, useNightsAvailable, usePodLive } from '../social/nights'
import {
  chatCardLine, chatItems, leagueLabel, membersLine, mergePodMessages, nightDay, nightTime, podPreview, POD_MESSAGE_MAX, tableLine, upcomingNights,
  type NightInvite, type PodChat, type PodMessage, type PodMessageRef,
} from '../social/nightsLogic'
import { timeAgo } from '../social/moreLogic'
import '../social/nights.css'

// A pod's group chat (the Chats mockup): messages with who sent them and when, league results and
// game night invites inline (tap Going? to answer), sharing a game night, a deck or a card, and
// block or report from a sender's name. At /pods/:id/chat. PodChatRows lists every pod's chat for
// the Chats list. The Android app's PodChatScreen.kt.

export function PodChatPage() {
  const { id = '' } = useParams<{ id: string }>()
  const back = useBack('/friends')
  const navigate = useNavigate()
  return (
    <SocialGate>{(o) => {
      const pod = o.pods.find((p) => p.id === id)
      return (
        <>
          <TopBar
            title={pod?.name ?? 'Pod chat'}
            onBack={back}
            actions={pod && <IconButton icon="emoji_events" label="Pod and league" onClick={() => navigate(`/play/playgroup?pod=${pod.id}`)} />}
          />
          <div className="content-scroll">
            <div className="narrow-width">
              {pod ? <Chat overview={o} pod={pod} /> : <div className="empty-state"><Icon name="groups" />You're not in that pod any more.</div>}
            </div>
          </div>
        </>
      )
    }}</SocialGate>
  )
}

const PAGE = 50

function Chat({ overview, pod }: { overview: api.Overview; pod: api.Pod }) {
  const navigate = useNavigate()
  const available = useNightsAvailable()
  const me = overview.me!.user_id
  const { nights } = useGameNights(pod.id)
  const [messages, setMessages] = useState<PodMessage[] | null>(null)
  const [older, setOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [about, setAbout] = useState<PodMessage | null>(null)
  const [table, setTable] = useState<{ seasonId: string; line: string | null } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const end = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const nameOf = (id: string | null) => (id ? (id === me ? 'You' : overview.people[id]?.display_name ?? 'Someone') : 'Manabind')
  const others = pod.members.filter((m) => m !== me).map((m) => overview.people[m]?.display_name).filter((n): n is string => !!n)

  const loadNewest = useCallback(() => {
    podMessages(pod.id, null, PAGE)
      .then((page) => {
        setMessages((list) => mergePodMessages(list ?? [], page))
        setOlder((had) => had || page.length >= PAGE)
        setNow(Date.now())
        void markPodRead(pod.id).catch(() => {})
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
  }, [pod.id])
  useEffect(() => { if (available) loadNewest() }, [available, loadNewest])
  usePodLive({
    onMessage: (m) => {
      if (m.podId !== pod.id) return
      stick.current = true
      setMessages((list) => mergePodMessages(list ?? [], [m]))
      setNow(Date.now())
      if (m.sender !== me) void markPodRead(pod.id).catch(() => {})
    },
    onReconnect: loadNewest,
  }, !!available)

  useLayoutEffect(() => { if (stick.current) end.current?.scrollIntoView({ block: 'end' }) }, [messages])

  // The table under the newest league result: worked out from the pod's games, as the league page does.
  const lastLeague = useMemo(() => [...(messages ?? [])].reverse().find((m) => m.kind === 'league' && m.ref?.seasonId) ?? null, [messages])
  const seasonId = lastLeague?.ref?.seasonId ?? null
  useEffect(() => {
    if (!seasonId) return
    let live = true
    void Promise.all([api.podSeasons(pod.id), api.podGames(pod.id)]).then(([seasons, games]) => {
      const s = seasons.find((x) => x.id === seasonId)
      if (live && s) setTable({ seasonId, line: tableLine(seasonTable(s, games).standings, me) })
    }).catch(() => {})
    return () => { live = false }
  }, [seasonId, pod.id, me, lastLeague?.id])

  const loadOlder = async () => {
    const first = messages?.[0]?.id
    if (!first) return
    stick.current = false
    const page = await podMessages(pod.id, first, PAGE).catch(() => [])
    setMessages((list) => mergePodMessages(list ?? [], page))
    setOlder(page.length >= PAGE)
  }

  const sent = (m: PodMessage | null) => {
    if (!m) return
    countAction('message_sent')
    stick.current = true
    setMessages((list) => mergePodMessages(list ?? [], [m]))
    setNow(Date.now())
  }
  const send = () => { if (draft.trim()) communityRules.require(() => void sendNow()) }
  const sendNow = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      sent(await sendPodMessage(pod.id, body))
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  const share = (ref: PodMessageRef) => {
    setSharing(false)
    communityRules.require(() => {
      setBusy(true)
      setError(null)
      sharePodMessage(pod.id, ref).then(sent).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.')).finally(() => setBusy(false))
    })
  }

  if (available === false) return <div className="empty-state"><Icon name="forum" />{CHAT_UNAVAILABLE}</div>

  const nightById = new Map((nights ?? []).map((n) => [n.id, n]))
  const items = messages ? chatItems(messages, me, now) : []

  return (
    <>
      <div className="pc-head-sub">{membersLine(others)}</div>
      <div className="pc-thread">
        {older && <button type="button" className="btn line sm" style={{ alignSelf: 'center' }} onClick={() => void loadOlder()}>Show earlier messages</button>}
        {!messages ? (
          error ? <div className="notice warn">{error}</div> : <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
        ) : messages.length === 0 ? (
          <div className="dim" style={{ textAlign: 'center', padding: 20 }}>Say hello to {pod.name}. Write a card's name in [[double brackets]] to link it.</div>
        ) : items.map((it) => {
          if (it.type === 'day') return <div key={it.key} className="pc-day">{it.label}</div>
          const m = it.message
          if (m.kind === 'league') {
            return (
              <div key={it.key} className="pc-league">
                <span className="pc-league-label">{leagueLabel(m.ref)}</span>
                <span>{m.body}</span>
                {m.id === lastLeague?.id && table && table.seasonId === m.ref?.seasonId && table.line && <span className="pc-league-table">{table.line}</span>}
              </div>
            )
          }
          if (m.kind === 'system') return <div key={it.key} className="pc-system">{m.body}</div>
          if (m.kind === 'night' || m.ref?.type === 'night') {
            return <NightCard key={it.key} message={m} night={m.ref?.nightId ? nightById.get(m.ref.nightId) ?? null : null} me={me} by={it.showName ? nameOf(m.sender) : null} onOpen={(id) => navigate(`/play/nights/${id}`)} />
          }
          return (
            <div key={it.key} className={`pc-msg${it.mine ? ' mine' : ''}`}>
              {it.showName && (
                <button type="button" className="pc-name link-like" style={{ textAlign: 'left' }} onClick={() => setAbout(m)}>{nameOf(m.sender)}</button>
              )}
              <div className="pc-bubble">
                {m.kind === 'share' ? <Shared message={m} onOpen={navigate} /> : <MessageText body={m.body} />}
              </div>
              <span className="pc-time">{timeAgo(m.createdAt, now)}</span>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {error && messages && <div className="notice warn">{error}</div>}
      <form className="pc-compose" onSubmit={(e) => { e.preventDefault(); send() }}>
        <button type="button" className="btn soft pc-round" aria-label="Share a card, deck or game night" onClick={() => setSharing(true)} disabled={busy}><Icon name="add" aria-hidden /></button>
        <textarea
          className="input"
          rows={1}
          maxLength={POD_MESSAGE_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={`Message ${pod.name}`}
          aria-label={`Message ${pod.name}`}
        />
        <button type="submit" className="btn gold pc-round" disabled={busy || !draft.trim()} aria-label="Send"><Icon name="send" aria-hidden /></button>
      </form>
      {sharing && <ShareDialog nights={upcomingNights(nights ?? [], Date.now())} onShare={share} onPlan={() => navigate(`/play/nights/new?pod=${pod.id}`)} onDismiss={() => setSharing(false)} />}
      {about && about.sender && about.sender !== me && (
        <Dialog title={nameOf(about.sender)} onDismiss={() => setAbout(null)} actions={<button type="button" className="btn line" onClick={() => setAbout(null)}>Close</button>}>
          <div className="person-row" style={{ marginBottom: 10 }}>
            <Avatar profile={overview.people[about.sender] ?? null} size={40} />
            <span className="person-main"><span className="person-name">{nameOf(about.sender)}</span></span>
          </div>
          <BlockReportButton userId={about.sender} name={nameOf(about.sender)} item={{ kind: 'message', id: `pod:${about.id}` }} onBlocked={() => { setAbout(null); setMessages(null); loadNewest() }} />
        </Dialog>
      )}
    </>
  )
}

/** A game night in the chat: "Game night · Fri 10 Oct, 7pm" / "Priya's · 4 going, Sam maybe" and Going?. */
function NightCard({ message, night, me, by, onOpen }: { message: PodMessage; night: NightInvite | null; me: string; by: string | null; onOpen: (id: string) => void }) {
  const at = night?.startsAt ?? message.ref?.startsAt ?? message.createdAt
  const id = night?.id ?? message.ref?.nightId
  const answered = night ? night.invitees.find((i) => i.user.user_id === me)?.answer : null
  return (
    <div className="pc-night">
      <div className="pc-night-main">
        {by && <span>{by} shared</span>}
        <b>Game night · {nightDay(at)}, {nightTime(at)}</b>
        <span>{night ? chatCardLine(night, me) : message.ref?.place ?? ''}</span>
      </div>
      {id && <button type="button" className="gn-going" onClick={() => onOpen(id)}>{night && !night.cancelled && !answered ? 'Going?' : 'Open'}</button>}
    </div>
  )
}

/** A shared deck or card: what it is, and a tap opens it. */
function Shared({ message, onOpen }: { message: PodMessage; onOpen: (to: string) => void }) {
  const ref = message.ref
  const open = ref?.type === 'card' && ref.name ? () => onOpen(`/card/${encodeURIComponent(ref.name!)}`)
    : ref?.type === 'deck' && ref.ownerId && ref.itemId ? () => onOpen(`/shared/${ref.ownerId}/deck/${encodeURIComponent(ref.itemId!)}`) : undefined
  return (
    <div className="pc-share">
      <small>{ref?.type === 'deck' ? 'DECK' : 'CARD'}</small>
      {open ? <button type="button" className="link-like" style={{ textAlign: 'left', fontWeight: 700, color: 'inherit' }} onClick={open}>{ref?.name}</button> : <b>{ref?.name}</b>}
      {message.body && <MessageText body={message.body} />}
    </div>
  )
}

/** The + button: share a game night of this pod's, one of the user's decks, or a card by name. */
function ShareDialog({ nights, onShare, onPlan, onDismiss }: { nights: NightInvite[]; onShare: (ref: PodMessageRef) => void; onPlan: () => void; onDismiss: () => void }) {
  const { decks } = useSync()
  const [card, setCard] = useState('')
  const shown = activeDecks(decks).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30)
  return (
    <Dialog title="Share in the chat" onDismiss={onDismiss} actions={<button type="button" className="btn line" onClick={onDismiss}>Cancel</button>}>
      <div className="pc-pick">
        <div className="field-label">A game night</div>
        {nights.map((n) => (
          <button key={n.id} type="button" className="btn line" onClick={() => onShare({ type: 'night', nightId: n.id })}>Game night · {nightDay(n.startsAt)}, {nightTime(n.startsAt)}</button>
        ))}
        <button type="button" className="btn soft" onClick={onPlan}><Icon name="event" aria-hidden />Plan a game night</button>
        {shown.length > 0 && <div className="field-label" style={{ marginTop: 10 }}>A deck</div>}
        {shown.map((d) => <button key={d.id} type="button" className="btn line" onClick={() => onShare({ type: 'deck', itemId: d.id, name: d.name })}>{d.name}</button>)}
        <div className="field-label" style={{ marginTop: 10 }}>A card</div>
        <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (card.trim()) onShare({ type: 'card', name: card.trim() }) }}>
          <input className="input" value={card} maxLength={150} onChange={(e) => setCard(e.target.value)} placeholder="Card name" aria-label="Card name" />
          <button type="submit" className="btn gold" disabled={!card.trim()}>Share</button>
        </form>
      </div>
    </Dialog>
  )
}

/**
 * Every pod's chat as rows for the Chats list — name, last message, unread count — newest first.
 * Shows nothing until the server has pod chat. [onUnread]: the total, for a badge.
 */
export function PodChatRows({ onUnread }: { onUnread?: (n: number) => void }) {
  const navigate = useNavigate()
  const available = useNightsAvailable()
  const { account } = useSync()
  const me = account?.userId ?? ''
  const [chats, setChats] = useState<PodChat[] | null>(null)
  const report = useRef(onUnread)
  useEffect(() => { report.current = onUnread })
  const load = useCallback(() => {
    podChats().then((c) => { setChats(c); report.current?.(c.reduce((n, x) => n + x.unread, 0)) }).catch(() => {})
  }, [])
  useEffect(() => { if (available) load() }, [available, load])
  usePodLive({ onMessage: load, onReconnect: load }, !!available)
  const [now] = useState(() => Date.now())
  if (!available || !chats || chats.length === 0) return null
  return (
    <div className="list dm-list">
      {chats.map((c) => (
        <button key={c.podId} type="button" className="person-row press" onClick={() => navigate(`/pods/${c.podId}/chat`)}>
          <span className="avatar" style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden><Icon name="groups" /></span>
          <span className="person-main">
            <span className="person-name">{c.name}</span>
            <span className="dim">{podPreview(c.last, me)}{c.last ? ` · ${timeAgo(c.last.createdAt, now)}` : ''}</span>
          </span>
          {c.unread > 0 && <span className="count-badge">{c.unread}</span>}
        </button>
      ))}
    </div>
  )
}
