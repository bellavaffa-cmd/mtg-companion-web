import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, SectionHeader, SegmentedTabs, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import * as api from '../social/api'
import { useOverview } from '../social/SocialContext'
import { ProfileEditor } from '../social/ProfileEditor'
import { NotificationsPanel } from '../social/NotificationsPanel'
import { Avatar, handle, QrCode } from '../social/ui'

/**
 * Friends: the user's profile, adding friends by username or QR code, requests, pods, what friends
 * have shared, and trades.
 */
export function FriendsPage() {
  const back = useBack('/')
  return (
    <>
      <TopBar title="Friends" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>{(overview) => <FriendsContent overview={overview} />}</SocialGate>
        </div>
      </div>
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
  const navigate = useNavigate()
  const { refresh, inbox } = useOverview()
  const me = overview.me!
  // Friends, or the user's own profile; kept in the address so Back and links land on the right one.
  const [params, setParams] = useSearchParams()
  const profileTab = params.get('tab') === 'profile'
  const [podDialog, setPodDialog] = useState<api.Pod | 'new' | null>(null)
  const person = (id: string) => overview.people[id] ?? null

  const incoming = overview.friends.filter((f) => f.status === 'pending' && f.incoming)
  const outgoing = overview.friends.filter((f) => f.status === 'pending' && !f.incoming)
  const friends = overview.friends
    .filter((f) => f.status === 'accepted')
    .sort((a, b) => (person(a.user_id)?.display_name ?? '').localeCompare(person(b.user_id)?.display_name ?? ''))
  const sharedDecks = overview.shared_with_me.length
  // A friend's whole collection is one row here (it opens all of it); its binders are on their page.
  const wholeOwners = (overview.shared_all_with_me ?? []).filter((w) => w.kind === 'collection').map((w) => w.owner)
  const sharedRows = overview.shared_with_me.filter((s) => !(s.kind === 'collection' && s.whole && wholeOwners.includes(s.owner)))

  const tabs = (
    <div className="rise" style={{ ...rise(0), marginBottom: 14 }}>
      <SegmentedTabs
        labels={['Friends', 'Profile']}
        selected={profileTab ? 1 : 0}
        counts={incoming.length + inbox.trades > 0 ? { 0: incoming.length + inbox.trades } : {}}
        onSelect={(i) => setParams(i === 1 ? { tab: 'profile' } : {}, { replace: true })}
      />
    </div>
  )
  if (profileTab) {
    return <>{tabs}<ProfileTab me={me} /></>
  }

  return (
    <>
      {tabs}
      <AddFriend onAdded={refresh} />

      <button type="button" className="banner press rise" style={{ ...rise(1), marginTop: 12 }} onClick={() => navigate('/trades')}>
        <Icon name="swap_horiz" />
        <span style={{ flex: 1 }}>Trades</span>
        {inbox.trades > 0 && <span className="count-badge">{inbox.trades}</span>}
        <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
      </button>

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

      <SectionHeader title={`Friends${friends.length ? ` · ${friends.length}` : ''}`} />
      {friends.length === 0 ? (
        <div className="notice">No friends yet. Add someone by their username, or let them scan your QR code.</div>
      ) : (
        <div className="list">
          {friends.map((f, i) => {
            const p = person(f.user_id)
            const shares = overview.shared_with_me.filter((s) => s.owner === f.user_id).length
            return (
              <button key={f.user_id} type="button" className="person-row press rise" style={rise(Math.min(i, 8))} onClick={() => navigate(`/friends/${f.user_id}`)}>
                <Avatar profile={p} size={44} />
                <span className="person-main">
                  <span className="person-name">{p?.display_name ?? 'Someone'}</span>
                  <span className="dim">{p ? handle(p) : ''}{shares > 0 ? ` · shares ${shares}` : ''}</span>
                </span>
                <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
              </button>
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

      <SectionHeader title="Pods" action="New pod" onAction={() => setPodDialog('new')} />
      {overview.pods.length === 0 ? (
        <div className="notice">A pod is a group of friends — your playgroup. Share a deck with a whole pod at once.</div>
      ) : (
        <div className="list">
          {overview.pods.map((pod) => (
            <button key={pod.id} type="button" className="person-row press" onClick={() => setPodDialog(pod)}>
              <span className="avatar-stack">
                {pod.members.slice(0, 3).map((m) => <Avatar key={m} profile={m === me.user_id ? me : person(m)} size={30} />)}
              </span>
              <span className="person-main">
                <span className="person-name">{pod.name}</span>
                <span className="dim">{pod.members.length} {pod.members.length === 1 ? 'person' : 'people'}{pod.owner === me.user_id ? '' : ` · ${person(pod.owner)?.display_name ?? ''}’s pod`}</span>
              </span>
              <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
            </button>
          ))}
        </div>
      )}

      <SectionHeader title={`Shared with you${sharedDecks ? ` · ${wholeOwners.length + sharedRows.length}` : ''}`} />
      {sharedDecks === 0 ? (
        <div className="notice">Decks and binders friends share with you show up here.</div>
      ) : (
        <div className="list">
          {wholeOwners.map((owner) => (
            <WholeCollectionRow
              key={`whole:${owner}`}
              owner={owner}
              name={person(owner)?.display_name ?? 'A friend'}
              binders={overview.shared_with_me.filter((s) => s.owner === owner && s.kind === 'collection')}
              whole
            />
          ))}
          {sharedRows.map((s) => (
            <SharedRow key={`${s.owner}:${s.kind}:${s.item_id}`} item={s} owner={person(s.owner)} />
          ))}
        </div>
      )}

      {podDialog && <PodDialog overview={overview} pod={podDialog === 'new' ? null : podDialog} onClose={() => setPodDialog(null)} />}
    </>
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
          Friends scan this with their phone’s camera or the Android app’s scanner — or add {handle(me)}.
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

function AddFriend({ onAdded }: { onAdded: () => Promise<void> }) {
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
