import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { SectionHeader } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { isUnsorted } from '../types/models'
import * as api from './api'
import { ShareSwitch } from './ShareDialog'
import { useOverview } from './SocialContext'

/** Whether the user shares every [kind] with [viewer] (a friend's id; null: all friends). */
export function sharesAll(overview: api.Overview, kind: api.ShareKind, viewer: string | null): boolean {
  return (overview.my_share_all ?? []).some((a) => a.kind === kind && a.viewer === viewer)
}

/**
 * Why one deck or binder is already visible to [friendId] other than one by one — shared with all
 * friends, or with a pod they're in — or null when it isn't.
 */
function sharedBroadly(overview: api.Overview, share: api.Share | undefined, friendId: string): string | null {
  if (!share) return null
  if (share.all_friends) return 'Shared with all your friends'
  const pod = overview.pods.find((p) => share.pod_ids.includes(p.id) && p.members.includes(friendId))
  return pod ? `Shared with ${pod.name}` : null
}

/**
 * On a friend's page: what the user shares with them — their whole collection, all their decks,
 * or binders and decks one by one. Each switch saves straight away.
 */
export function ShareWithFriend({ overview, friendId, friendName }: { overview: api.Overview; friendId: string; friendName: string }) {
  const { collections, decks, syncNow } = useSync()
  const { refresh } = useOverview()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      // New binders and decks have to reach the server before they can be shared.
      await syncNow()
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof api.SocialError && e.code === 'no_such_item'
        ? "That hasn't synced yet — check your connection and try again."
        : e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const share = (kind: api.ShareKind, id: string) => overview.my_shares.find((s) => s.kind === kind && s.item_id === id)
  const itemSwitch = (kind: api.ShareKind, id: string, name: string, detail: string) => {
    const s = share(kind, id)
    const broad = sharedBroadly(overview, s, friendId)
    const on = !!broad || !!s?.friend_ids?.includes(friendId)
    return (
      <ShareSwitch
        key={`${kind}:${id}`}
        label={name}
        detail={broad ?? detail}
        on={on}
        disabled={!!broad || busy !== null}
        onChange={(next) => void run(`${kind}:${id}`, () => api.setItemFriendShare(kind, id, friendId, next))}
      />
    )
  }

  const wholeCollection = sharesAll(overview, 'collection', friendId)
  const allDecks = sharesAll(overview, 'deck', friendId)
  const collectionToAll = sharesAll(overview, 'collection', null)
  const decksToAll = sharesAll(overview, 'deck', null)
  const binders = [...collections].sort((a, b) => Number(isUnsorted(b)) - Number(isUnsorted(a)) || a.name.localeCompare(b.name))
  const sortedDecks = [...decks].sort((a, b) => a.name.localeCompare(b.name))
  const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

  return (
    <>
      <SectionHeader title={`What you share with ${friendName}`} />
      <p className="dim" style={{ marginTop: 0, fontSize: 12.5 }}>They can look, not change anything. It stays up to date as you edit.</p>
      <ShareSwitch
        label="My whole collection"
        detail={collectionToAll ? 'Shared with all your friends' : 'Every binder and wishlist — including ones you make later'}
        on={wholeCollection || collectionToAll}
        disabled={collectionToAll || busy !== null}
        onChange={(next) => void run('all:collection', () => api.setShareAll('collection', friendId, next))}
      />
      {!wholeCollection && !collectionToAll && binders.length > 0 && (
        <div className="share-group">
          {binders.map((c) => itemSwitch('collection', c.id, c.name,
            `${isUnsorted(c) ? 'Not in a binder' : c.type === 'WISHLIST' ? 'Wishlist' : 'Binder'} · ${count(c.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0), 'card')}`))}
        </div>
      )}
      <ShareSwitch
        label="All my decks"
        detail={decksToAll ? 'Shared with all your friends' : 'Every deck — including ones you make later'}
        on={allDecks || decksToAll}
        disabled={decksToAll || busy !== null}
        onChange={(next) => void run('all:deck', () => api.setShareAll('deck', friendId, next))}
      />
      {!allDecks && !decksToAll && sortedDecks.length > 0 && (
        <div className="share-group">
          {sortedDecks.map((d) => itemSwitch('deck', d.id, d.name, `Deck · ${count(d.cards.reduce((n, c) => n + c.quantity, 0), 'card')}`))}
        </div>
      )}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </>
  )
}

/** From the Collection page: the user's whole collection, shared with all friends or chosen ones. */
export function ShareCollectionDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { account, syncNow } = useSync()
  const { overview, refresh, error: loadError } = useOverview()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = <button type="button" className="btn line" onClick={onClose}>Close</button>

  if (!account || !overview || !overview.me) {
    return (
      <Dialog title="Share my collection" onDismiss={onClose} actions={close}>
        {!account ? (
          <p className="muted" style={{ margin: 0 }}>Sign in to share your collection with friends.</p>
        ) : !overview ? (
          <p className="muted" style={{ margin: 0 }}>{loadError ?? 'Loading…'}</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Make your profile first — friends see your name on what you share.</p>
            <button type="button" className="btn gold" onClick={() => { onClose(); navigate('/friends') }}>Make my profile</button>
          </>
        )}
      </Dialog>
    )
  }

  const set = async (viewer: string | null, on: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await syncNow()
      await api.setShareAll('collection', viewer, on)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const toAll = sharesAll(overview, 'collection', null)
  const friends = overview.friends
    .filter((f) => f.status === 'accepted')
    .map((f) => overview.people[f.user_id])
    .filter((p): p is api.Profile => !!p)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  return (
    <Dialog title="Share my collection" onDismiss={onClose} actions={close}>
      <p className="muted" style={{ marginTop: 0 }}>
        Every binder and wishlist — including ones you make later. Friends can look, not change anything. To share only some binders, open a friend in Friends.
      </p>
      <ShareSwitch
        label="All my friends"
        detail={friends.length === 0 ? 'You have no friends added yet' : `${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}, and anyone you add later`}
        on={toAll}
        disabled={busy}
        onChange={(on) => void set(null, on)}
      />
      {!toAll && friends.map((p) => (
        <ShareSwitch
          key={p.user_id}
          label={p.display_name}
          detail={`@${p.username}`}
          on={sharesAll(overview, 'collection', p.user_id)}
          disabled={busy}
          onChange={(on) => void set(p.user_id, on)}
        />
      ))}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}
