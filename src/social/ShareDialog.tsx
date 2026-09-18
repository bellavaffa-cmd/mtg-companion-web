import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useSync } from '../sync/SyncContext'
import * as api from './api'
import { useOverview } from './SocialContext'
import { QrCode } from './ui'

/** Who can see one of the user's decks or binders: all friends, some pods, and/or anyone with a link. View only. */
export function ShareDialog({ kind, itemId, name, onClose }: { kind: api.ShareKind; itemId: string; name: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { account, syncNow } = useSync()
  const { overview, refresh, error: loadError } = useOverview()
  const current = overview?.my_shares.find((s) => s.kind === kind && s.item_id === itemId) ?? null
  const [allFriends, setAllFriends] = useState<boolean | null>(null)
  const [pods, setPods] = useState<string[] | null>(null)
  const [link, setLink] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const what = kind === 'deck' ? 'deck' : 'binder'

  // Until the user changes something, the switches show what's saved.
  const friendsOn = allFriends ?? current?.all_friends ?? false
  const podsOn = pods ?? current?.pod_ids ?? []
  const linkOn = link ?? !!current?.link_token
  const changed = allFriends !== null || pods !== null || link !== null

  if (!account || !overview || !overview.me) {
    return (
      <Dialog title={`Share this ${what}`} onDismiss={onClose} actions={<button type="button" className="btn line" onClick={onClose}>Close</button>}>
        {!account ? (
          <p className="muted" style={{ margin: 0 }}>Sign in to share decks and binders with friends.</p>
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

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      // A new deck or binder has to reach the server before it can be shared.
      await syncNow()
      await api.setShare(kind, itemId, friendsOn, podsOn, linkOn)
      await refresh()
      setAllFriends(null)
      setPods(null)
      setLink(null)
      if (!linkOn) onClose()
    } catch (e) {
      setError(e instanceof api.SocialError && e.code === 'no_such_item'
        ? `This ${what} hasn't synced yet — check your connection and try again.`
        : e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const url = current?.link_token && linkOn && !changed ? api.shareLink(current.link_token) : null
  // Phones offer their share sheet; elsewhere the link is copied.
  const canShare = typeof navigator.share === 'function'
  const friendCount = overview.friends.filter((f) => f.status === 'accepted').length
  // Friends who see it anyway: everything of this kind is shared with them, or this one by one.
  const everything = (overview.my_share_all ?? []).filter((a) => a.kind === kind)
  const everyoneSees = everything.some((a) => a.viewer === null)
  const alsoWith = [...new Set([...everything.map((a) => a.viewer), ...(current?.friend_ids ?? [])])]
    .filter((id): id is string => !!id)
    .map((id) => overview.people[id]?.display_name ?? 'a friend')

  return (
    <Dialog
      title={`Share “${name}”`}
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="btn line" onClick={onClose}>{changed ? 'Cancel' : 'Close'}</button>
          {changed && <button type="button" className="btn gold" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>}
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>People you share with can look, not change anything. It stays up to date as you edit.</p>
      <ShareSwitch
        label="All my friends"
        detail={friendCount === 0 ? 'You have no friends added yet' : `${friendCount} ${friendCount === 1 ? 'friend' : 'friends'}, and anyone you add later`}
        on={friendsOn}
        onChange={setAllFriends}
      />
      {overview.pods.map((pod) => (
        <ShareSwitch
          key={pod.id}
          label={pod.name}
          detail={`Pod · ${pod.members.length} ${pod.members.length === 1 ? 'person' : 'people'}`}
          on={podsOn.includes(pod.id)}
          onChange={(on) => setPods(on ? [...podsOn, pod.id] : podsOn.filter((id) => id !== pod.id))}
        />
      ))}
      <ShareSwitch label="Anyone with the link" detail="Works without an account — turn it off to stop the link working" on={linkOn} onChange={setLink} />
      {everyoneSees ? (
        <p className="dim" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          {kind === 'deck' ? 'All your decks are' : 'Your whole collection is'} shared with all your friends, so they see this {what} anyway.
        </p>
      ) : alsoWith.length > 0 && (
        <p className="dim" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          Also shared with {alsoWith.join(', ')} — change that on their page in Friends.
        </p>
      )}
      {url && (
        <div className="share-link">
          <QrCode text={url} size={160} label={`QR code for the link to ${name}`} />
          <div className="share-link-row">
            <input className="input" readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn line sm"
              onClick={async () => {
                try {
                  if (canShare) await navigator.share({ title: name, url })
                  else { await navigator.clipboard.writeText(url); setCopied(true) }
                } catch {
                  // Share sheet dismissed.
                }
              }}
            >
              <Icon name={canShare ? 'share' : copied ? 'check' : 'content_copy'} aria-hidden />{canShare ? 'Share' : copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

export function ShareSwitch({ label, detail, on, onChange, disabled }: { label: string; detail: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="share-switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="txt"><b>{label}</b><span>{detail}</span></span>
      <span className={`sw${on ? ' on' : ''}`}><i /></span>
    </button>
  )
}
