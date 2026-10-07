import { useHouseholds } from '../social/household'
import { HouseholdInvites } from '../social/HouseholdInvites'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, IconButton, PageHeader, SectionHeader, SegmentedTabs, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import * as api from '../social/api'
import { useOverview, useSocial } from '../social/SocialContext'
import { ProfileEditor } from '../social/ProfileEditor'
import { NotificationsPanel } from '../social/NotificationsPanel'
import { Avatar, handle, QrCode } from '../social/ui'
import { matchAsTrade, useSocialMore, unreadMessages, type TradeMatch } from '../social/more'
import { ActivityList } from '../social/MoreUi'
import { friendsTabCounts, friendsTabFor, friendsTabLabel, friendsTabs } from '../social/friendsTabs'
import { ConversationList } from './MessagesPage'
import { TradeInboxList } from './TradesPage'
import { FRIEND_ACTION_LABELS, friendContext, lentTo } from '../social/friendsHub'
import { PodsRow, usePodLeagues, useWantsFromYou, WantsFromYouCard } from '../social/FriendsHubUi'
import { NextGameNightCard } from '../social/NextGameNightCard'
import { useNightsAvailable } from '../social/nights'
import { loanPeople } from '../collection/loans'
import { loansOf } from '../collection/storagePlaces'
import { todayDay } from '../decks/league'
import { useMoney } from '../money/currency'

/**
 * Friends, a tab of the bottom bar, in four tabs (friendsTabs.ts): People — the next game night,
 * your pods with their league, friends each with a line of context and a quick action, requests and
 * the way to what's shared; Chats (direct messages, pod chats above them); Trades — the trade inbox:
 * Your turn, Waiting on them, What friends want from you and Done; and Activity. Chats and Activity
 * need the server's social_more functions. Adding a friend, scanning a QR code and the user's own
 * profile open from the header. The tab is kept in the address (?tab=…), so links, Back and tapped
 * notifications (pwa/sw.template.js) land on the right one. The Android app's twin is
 * ui/social/FriendsScreen.kt.
 */
export function FriendsPage() {
  const navigate = useNavigate()
  const wide = useLayoutSize() !== 'phone'
  const [params, setParams] = useSearchParams()
  const { account } = useSync()
  const { refresh } = useSocial()
  const profile = params.get('tab') === 'profile'
  const [adding, setAdding] = useState(false)
  return (
    <>
      {profile ? (
        <TopBar title="Your profile" onBack={() => setParams({}, { replace: true })} />
      ) : (
        // A tab of the bar: no back button of its own.
        <PageHeader
          title="Friends"
          actions={account ? (
            <span className="friends-head-acts">
              <IconButton icon="person_add" label="Add a friend" onClick={() => setAdding(true)} />
              <IconButton icon="qr_code_scanner" label="Scan a QR code" onClick={() => navigate('/scan')} />
              <IconButton icon="account_circle" label="Your profile and QR code" onClick={() => setParams({ tab: 'profile' })} />
            </span>
          ) : undefined}
        />
      )}
      <div className={`content-scroll${wide || profile ? '' : ' with-nav'}`}>
        <div className="narrow-width">
          <SocialGate>{(overview) => <FriendsContent overview={overview} />}</SocialGate>
        </div>
      </div>
      {adding && (
        <Dialog title="Add a friend" onDismiss={() => setAdding(false)} actions={<button type="button" className="btn line" onClick={() => setAdding(false)}>Close</button>}>
          <AddFriend onAdded={refresh} onShowQr={() => { setAdding(false); setParams({ tab: 'profile' }) }} />
        </Dialog>
      )}
    </>
  )
}

/**
 * Shows [children] once the user is signed in and has a profile; before that, what they need to do.
 */
export function SocialGate({ children }: { children: (overview: api.Overview) => ReactNode }) {
  const navigate = useNavigate()
  const { account, accountsAvailable } = useSync()
  const { overview, error, refresh, loading } = useOverview({ fresh: true })
  if (!accountsAvailable) return <div className="notice">Accounts aren't set up in this build.</div>
  if (!account) {
    return (
      <div className="empty-state rise" style={rise(0)}>
        <Icon name="group" />
        <div>Sign in to add friends, share decks and binders, and trade.</div>
        <button type="button" className="btn gold" onClick={() => navigate('/account')}>Sign in</button>
      </div>
    )
  }
  if (!overview) {
    return error ? (
      <div className="empty-state">
        <Icon name="cloud_off" />
        <div>{error}</div>
        <button type="button" className="btn line" disabled={loading} onClick={() => void refresh()}>Try again</button>
      </div>
    ) : (
      <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
    )
  }
  if (!overview.me) {
    return (
      <div className="rise" style={rise(0)}>
        <h2 className="social-title">Make your profile</h2>
        <p className="muted" style={{ marginTop: 4 }}>Friends find you by your username, and see your name and picture — on shared decks, trades and the life counter.</p>
        <div className="panel" style={{ marginTop: 14 }}><ProfileEditor /></div>
      </div>
    )
  }
  return <>{children(overview)}</>
}

function FriendsContent({ overview }: { overview: api.Overview }) {
  const { inbox, unread: dmUnread, podUnread, setUnread } = useOverview()
  // Pod chats' unread messages count in "Chats · N" and the badge too.
  const unread = dmUnread + podUnread
  // The tab, or the user's own profile; kept in the address so Back and links land on the right one.
  const [params, setParams] = useSearchParams()
  // Chats and Activity need the server's social_more functions.
  const more = useSocialMore()
  useEffect(() => {
    if (!more) return
    let cancelled = false
    unreadMessages().then((n) => { if (!cancelled) setUnread(n) }).catch(() => {})
    return () => { cancelled = true }
  }, [more, overview, setUnread])

  if (params.get('tab') === 'profile') return <ProfileTab me={overview.me!} />

  const tabs = friendsTabs(more)
  const tab = friendsTabFor(params.get('tab'), more)
  const requests = overview.friends.filter((f) => f.status === 'pending' && f.incoming).length
  // The counts go in the labels: "Chats · 3", "Trades · 2".
  const counts = friendsTabCounts(tabs, { requests, unread, trades: inbox.trades })
  return (
    <>
      <div className="rise friends-tabs" style={rise(0)}>
        <SegmentedTabs
          labels={tabs.map((t, i) => friendsTabLabel(t, counts[i] ?? 0))}
          selected={tabs.indexOf(tab)}
          onSelect={(i) => setParams(tabs[i] === 'people' ? {} : { tab: tabs[i] }, { replace: true })}
        />
      </div>
      {tab === 'people' && <PeopleTab overview={overview} />}
      {/* Direct messages and pod chats in one list, newest first. */}
      {tab === 'messages' && <ConversationList overview={overview} podChats />}
      {tab === 'trades' && <TradesTab overview={overview} more={!!more} />}
      {/* Friends' feed with its new kinds (ActivityFeed): each item opens where it's about. */}
      {tab === 'activity' && <ActivityList />}
    </>
  )
}

/**
 * People: the next game night, Your pods, friend requests, friends — each with one line of context
 * and a quick action (friendsHub.ts's friendContext) — requests the user sent, and what's shared.
 */
function PeopleTab({ overview }: { overview: api.Overview }) {
  const navigate = useNavigate()
  const { refresh } = useOverview()
  const { collections } = useSync()
  const money = useMoney()
  const me = overview.me!
  const [podDialog, setPodDialog] = useState<api.Pod | 'new' | null>(null)
  const person = (id: string) => overview.people[id] ?? null
  const incoming = overview.friends.filter((f) => f.status === 'pending' && f.incoming)
  const outgoing = overview.friends.filter((f) => f.status === 'pending' && !f.incoming)
  const friends = overview.friends
    .filter((f) => f.status === 'accepted')
    .sort((a, b) => (person(a.user_id)?.display_name ?? '').localeCompare(person(b.user_id)?.display_name ?? ''))
  const sharers = [...new Set(overview.shared_with_me.map((s) => s.owner))]
  // Invitations to share storage at home (social/household.ts); nothing shows before the server has them.
  const households = useHouseholds()
  const homes = households.state.kind === 'ready' ? households.state.data.households : []
  // Each friend's line: what they want of the user's, what they have on loan, a shelf shared at home.
  const wants = useWantsFromYou(overview)
  const loans = useMemo(() => loansOf(collections), [collections])
  const dues = useMemo(() => loanPeople(loans, todayDay(), []), [loans])
  const leagues = usePodLeagues(overview.pods, me.user_id)
  // Pod chat and game nights (supabase/migrations/20261006070000_game_nights_chat.sql).
  const podChat = useNightsAvailable() === true
  const startTrade = (m: TradeMatch) =>
    navigate(`/trades/new?to=${m.friend}`, { state: { want: m.they_have.map(matchAsTrade), give: m.they_want.map(matchAsTrade) } })

  return (
    <>
      {/* The next game night (NextGameNightCard.tsx): nothing until there's one to show; opens its invite. */}
      <NextGameNightCard />

      {incoming.length > 0 && (
        <>
          <SectionHeader title="Friend requests" />
          <div className="list">
            {incoming.map((f) => (
              <RequestRow key={f.user_id} profile={person(f.user_id)} userId={f.user_id} onDone={refresh} />
            ))}
          </div>
        </>
      )}

      {households.state.kind === 'ready' && households.state.data.invites.length > 0 && (
        <>
          <SectionHeader title="Sharing storage at home" />
          <HouseholdInvites
            invites={households.state.data.invites}
            onDone={async (accepted) => { await households.reload(); if (accepted) navigate(`/collections/household/${accepted}`) }}
          />
        </>
      )}

      <SectionHeader title="Your pods" action="New pod" onAction={() => setPodDialog('new')} />
      {overview.pods.length === 0 ? (
        <div className="notice">A pod is a group of friends — your playgroup. Share a deck with a whole pod at once.</div>
      ) : (
        // A pod opens its chat once the server has pod chat (before that, its members to edit as
        // before); each card also offers Plan a game night, and Members.
        podChat ? (
          <PodsRow
            pods={overview.pods}
            leagues={leagues}
            onOpen={(pod) => navigate(`/pods/${pod.id}/chat`)}
            onPlan={(pod) => navigate(`/play/nights/new?pod=${pod.id}`)}
            onEdit={(pod) => setPodDialog(pod)}
          />
        ) : (
          <PodsRow pods={overview.pods} leagues={leagues} onOpen={(pod) => setPodDialog(pod)} />
        )
      )}

      <SectionHeader title={`Friends${friends.length ? ` · ${friends.length}` : ''}`} />
      {friends.length === 0 ? (
        <div className="notice">No friends yet. Add someone by their username, or let them scan your QR code.</div>
      ) : (
        <div className="list">
          {friends.map((f, i) => {
            const p = person(f.user_id)
            const shares = overview.shared_with_me.filter((s) => s.owner === f.user_id).length
            const want = wants.find((w) => w.friend === f.user_id)
            const home = homes.find((h) => h.members.some((m) => m.status === 'member' && m.profile?.user_id === f.user_id))
            const context = friendContext(
              want?.cards ?? 0,
              want?.value != null ? money.format(want.value, true) : null,
              lentTo(loans, f.user_id),
              dues.find((d) => d.friendId === f.user_id)?.label ?? null,
              !!home,
            )
            const detail = context?.line ?? (shares > 0 ? `Shares ${shares} with you` : p ? handle(p) : '')
            return (
              <div key={f.user_id} className="person-row rise" style={rise(Math.min(i, 8))}>
                <button type="button" className="person-open press" onClick={() => navigate(`/friends/${f.user_id}`)}>
                  <Avatar profile={p} size={44} />
                  <span className="person-main">
                    <span className="person-name">{p?.display_name ?? 'Someone'}</span>
                    <span className="dim">{detail}</span>
                  </span>
                </button>
                {context ? (
                  <button
                    type="button"
                    className={`friend-action ${context.action}`}
                    aria-label={`${FRIEND_ACTION_LABELS[context.action]} — ${p?.display_name ?? 'friend'}`}
                    onClick={() => {
                      if (context.action === 'trade' && want) startTrade(want.match)
                      else if (context.action === 'loan') navigate('/loans')
                      else if (context.action === 'home' && home) navigate(`/collections/household/${home.id}`)
                    }}
                  >
                    {FRIEND_ACTION_LABELS[context.action]}
                  </button>
                ) : (
                  <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {outgoing.length > 0 && (
        <>
          <SectionHeader title="Waiting for an answer" />
          <div className="list">
            {outgoing.map((f) => {
              const p = person(f.user_id)
              return (
                <div key={f.user_id} className="person-row">
                  <Avatar profile={p} size={44} />
                  <span className="person-main">
                    <span className="person-name">{p?.display_name ?? 'Someone'}</span>
                    <span className="dim">{p ? handle(p) : ''}</span>
                  </span>
                  <AsyncButton className="btn line sm" run={() => api.removeFriend(f.user_id)} done={refresh}>Cancel</AsyncButton>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* What friends share lives on the Collection page's Shared view; this is the way there. */}
      <SectionHeader title="Shared with you" />
      <button type="button" className="person-row press" onClick={() => navigate('/collections?tab=shared')}>
        <span className="avatar-stack">
          {sharers.slice(0, 3).map((m) => <Avatar key={m} profile={person(m)} size={30} />)}
          {sharers.length === 0 && <Icon name="collections" style={{ color: 'var(--gold)' }} />}
        </span>
        <span className="person-main">
          <span className="person-name">See what friends share</span>
          <span className="dim">{sharers.length === 0 ? 'Nothing shared with you yet' : `${sharers.length} ${sharers.length === 1 ? 'friend shares' : 'friends share'} with you — in Collection`}</span>
        </span>
        <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
      </button>

      {podDialog && <PodDialog overview={overview} pod={podDialog === 'new' ? null : podDialog} onClose={() => setPodDialog(null)} />}
    </>
  )
}

/**
 * Trades: the trade inbox (TradesPage.tsx's TradeInboxList) — Your turn, Waiting on them, What
 * friends want from you and Done — then the way to your cards for trade and to loans.
 */
function TradesTab({ overview, more }: { overview: api.Overview; more: boolean }) {
  const navigate = useNavigate()
  // What friends have lent the user (supabase/migrations/20261006010000_loans.sql) — nothing if the
  // server can't say.
  const [borrowed, setBorrowed] = useState(0)
  useEffect(() => {
    api.myBorrowedLoans().then((l) => setBorrowed(l.reduce((n, x) => n + x.cards.reduce((m, c) => m + c.qty, 0), 0))).catch(() => {})
  }, [])
  const wants = useWantsFromYou(overview)
  return (
    <TradeInboxList
      overview={overview}
      wants={wants.length > 0 && (
        <>
          <SectionHeader title="What friends want from you" />
          <WantsFromYouCard
            overview={overview}
            wants={wants}
            onOpen={(m) => navigate(`/trades/new?to=${m.friend}`, { state: { want: m.they_have.map(matchAsTrade), give: m.they_want.map(matchAsTrade) } })}
          />
        </>
      )}
      footer={(
        <div className="friends-links" style={{ marginTop: 18 }}>
          {more && (
            <button type="button" className="banner press" onClick={() => navigate('/for-trade')}>
              <Icon name="sell" />
              <span style={{ flex: 1 }}>Your cards for trade</span>
              <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
            </button>
          )}
          <button type="button" className="banner press" onClick={() => navigate('/loans?tab=borrowed')}>
            <Icon name="handshake" />
            <span style={{ flex: 1 }}>{borrowed > 0 ? `Borrowed / Lent · ${borrowed} ${borrowed === 1 ? 'card' : 'cards'} borrowed` : 'Borrowed / Lent'}</span>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        </div>
      )}
    />
  )
}

/** The user's own profile: how others see them, their QR code, editing it, and notifications. */
function ProfileTab({ me }: { me: api.Profile }) {
  const [editing, setEditing] = useState(false)
  return (
    <>
      {editing ? (
        <div className="panel rise" style={rise(1)}>
          <div className="p-h" style={{ marginTop: 0 }}><h3>Edit profile</h3></div>
          <ProfileEditor onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="panel profile-hero rise" style={rise(1)}>
          <Avatar profile={me} size={112} />
          <div className="profile-name" style={{ marginTop: 12 }}>{me.display_name}</div>
          <div className="dim">{handle(me)}</div>
          <button type="button" className="btn line sm" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>
            <Icon name="edit" aria-hidden />Edit profile
          </button>
        </div>
      )}
      <div className="panel qr-box rise" style={{ ...rise(2), marginTop: 12 }}>
        <div className="p-h" style={{ marginTop: 0, alignSelf: 'stretch' }}><h3>Add me as a friend</h3></div>
        <QrCode text={api.friendLink(me.username)} size={200} label={`QR code to add ${handle(me)}`} />
        <p className="dim" style={{ fontSize: 12.5, margin: '10px 0 0', maxWidth: 360 }}>
          Friends scan this with their phone’s camera or the app’s scanner — or add {handle(me)}.
        </p>
      </div>
      <NotificationsPanel />
    </>
  )
}

export function SharedRow({ item, owner }: { item: api.SharedSummary; owner: api.Profile | null }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="brow press" onClick={() => navigate(`/shared/${item.owner}/${item.kind}/${encodeURIComponent(item.item_id)}`)}>
      {item.cover
        ? <ArtImage src={toArtCrop(item.cover)} seed={item.name ?? item.item_id} />
        : <div className="icon-tile"><Icon name={item.kind === 'deck' ? 'style' : 'collections'} /></div>}
      <div style={{ minWidth: 0 }}>
        <div className="brow-name">{item.name ?? 'Untitled'}</div>
        <div className="brow-meta">
          <span className="badge soft">{item.kind === 'deck' ? 'Deck' : 'Binder'}</span>
          <span><b>{item.cards}</b>cards</span>
          {owner && <span className="dim">{owner.display_name}</span>}
        </div>
      </div>
      <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
    </button>
  )
}

/** A friend's collection as a whole — every binder they share with the user — opened as one. */
export function WholeCollectionRow({ owner, name, binders, whole }: { owner: string; name: string; binders: api.SharedSummary[]; whole: boolean }) {
  const navigate = useNavigate()
  const cards = binders.reduce((n, b) => n + b.cards, 0)
  return (
    <button type="button" className="brow press unsorted-row" onClick={() => navigate(`/shared/${owner}/collection`)}>
      <div className="icon-tile"><Icon name="collections_bookmark" /></div>
      <div style={{ minWidth: 0 }}>
        <div className="brow-name">{whole ? `${name}'s collection` : `Everything ${name} shares`}</div>
        <div className="brow-meta">
          <span className="badge soft">{whole ? 'Whole collection' : 'All shared binders'}</span>
          <span><b>{binders.length}</b>{binders.length === 1 ? 'binder' : 'binders'}</span>
          <span><b>{cards}</b>cards</span>
        </div>
      </div>
      <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
    </button>
  )
}

function AddFriend({ onAdded, onShowQr }: { onAdded: () => Promise<void>; onShowQr: () => void }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const add = async () => {
    const name = username.trim().replace(/^@/, '').toLowerCase()
    if (!name) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.requestFriend(name)
      setMessage({
        ok: true,
        text: result === 'accepted' ? `You and @${name} are now friends.` : result === 'already' ? `You've already asked @${name}.` : `Asked @${name} — they'll see your request.`,
      })
      setUsername('')
      await onAdded()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel rise" style={{ ...rise(1), marginTop: 12 }}>
      <div className="p-h" style={{ marginTop: 0 }}><h3>Add a friend</h3></div>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void add() }}>
        <div className="input-prefix" style={{ flex: 1 }}>
          <span aria-hidden>@</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="their username" aria-label="Friend's username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </div>
        <button type="submit" className="btn gold" disabled={busy || !username.trim()}>Add</button>
      </form>
      {message && <div className={`dim${message.ok ? '' : ' field-error'}`} style={{ marginTop: 8, fontSize: 13 }} aria-live="polite">{message.text}</div>}
      {/* Or their QR code, with the camera — the Scan page reads the app's codes as well as cards. */}
      <button type="button" className="btn line block" style={{ marginTop: 10 }} onClick={() => navigate('/scan')}>
        <Icon name="qr_code_scanner" aria-hidden />Scan their QR code
      </button>
      <button type="button" className="link" style={{ marginTop: 8 }} onClick={onShowQr}>Show my QR code</button>
    </div>
  )
}

function RequestRow({ profile, userId, onDone }: { profile: api.Profile | null; userId: string; onDone: () => Promise<void> }) {
  return (
    <div className="person-row">
      <Avatar profile={profile} size={44} />
      <span className="person-main">
        <span className="person-name">{profile?.display_name ?? 'Someone'}</span>
        <span className="dim">{profile ? handle(profile) : ''}</span>
      </span>
      <AsyncButton className="btn line sm" run={() => api.respondFriend(userId, false)} done={onDone}>Decline</AsyncButton>
      <AsyncButton className="btn gold sm" run={() => api.respondFriend(userId, true)} done={onDone}>Accept</AsyncButton>
    </div>
  )
}

/** A button that runs a server call, showing it's busy and any error, then [done]. */
export function AsyncButton({ run, done, className, children, disabled }: { run: () => Promise<unknown>; done?: () => unknown; className: string; children: ReactNode; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy || disabled}
        title={error ?? undefined}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await run()
            await done?.()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {children}
      </button>
      {error && <span className="field-error" role="alert" style={{ fontSize: 12 }}>{error}</span>}
    </>
  )
}

function PodDialog({ overview, pod, onClose }: { overview: api.Overview; pod: api.Pod | null; onClose: () => void }) {
  const { refresh } = useOverview()
  const me = overview.me!
  const mine = !pod || pod.owner === me.user_id
  const [name, setName] = useState(pod?.name ?? '')
  const [members, setMembers] = useState<string[]>(pod?.members.filter((m) => m !== me.user_id) ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const friends = overview.friends.filter((f) => f.status === 'accepted').map((f) => f.user_id)
  // Anyone already in the pod stays listed even if no longer a friend.
  const choices = [...new Set([...friends, ...members])]
  const person = (id: string) => (id === me.user_id ? me : overview.people[id] ?? null)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (!mine && pod) {
    return (
      <Dialog
        title={pod.name}
        onDismiss={onClose}
        actions={
          <>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void run(() => api.leavePod(pod.id))}>Leave pod</button>
            <button type="button" className="btn line" onClick={onClose}>Close</button>
          </>
        }
      >
        <p className="dim" style={{ marginTop: 0 }}>Made by {person(pod.owner)?.display_name ?? 'someone'}.</p>
        <div className="list">
          {pod.members.map((m) => (
            <div key={m} className="person-row compact">
              <Avatar profile={person(m)} size={34} />
              <span className="person-main"><span className="person-name">{person(m)?.display_name ?? 'Someone'}</span></span>
            </div>
          ))}
        </div>
        {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
      </Dialog>
    )
  }

  return (
    <Dialog
      title={pod ? 'Edit pod' : 'New pod'}
      onDismiss={onClose}
      actions={
        <>
          {pod && !confirmLeave && <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirmLeave(true)}>Delete</button>}
          {pod && confirmLeave && <button type="button" className="btn danger" disabled={busy} onClick={() => void run(() => api.leavePod(pod.id))}>Delete for everyone</button>}
          <button type="button" className="btn line" onClick={onClose}>Cancel</button>
          <button type="button" className="btn gold" disabled={busy || !name.trim()} onClick={() => void run(() => api.savePod(pod?.id ?? null, name.trim(), members))}>
            {pod ? 'Save' : 'Create pod'}
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="pod-name">Name</label>
      <input id="pod-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday night Commander" autoFocus={!pod} />
      <div className="field-label" style={{ marginTop: 14 }}>Who's in it</div>
      {choices.length === 0 ? (
        <div className="dim">Add some friends first.</div>
      ) : (
        <div className="list pick-list">
          {choices.map((id) => {
            const on = members.includes(id)
            return (
              <button
                key={id}
                type="button"
                className={`person-row compact press${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => setMembers((list) => (on ? list.filter((m) => m !== id) : [...list, id]))}
              >
                <Avatar profile={person(id)} size={34} />
                <span className="person-main"><span className="person-name">{person(id)?.display_name ?? 'Someone'}</span></span>
                <Icon name={on ? 'check_circle' : 'radio_button_unchecked'} style={{ color: on ? 'var(--gold)' : 'var(--t2)' }} />
              </button>
            )
          })}
        </div>
      )}
      {confirmLeave && <div className="notice warn" style={{ marginTop: 10 }}>Deleting the pod removes it for everyone in it, and stops sharing with it.</div>}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}
