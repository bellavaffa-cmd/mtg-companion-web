import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, SectionHeader, rise, toArtCrop, useBack } from '../components/kit'
import * as api from '../social/api'
import { useOverview } from '../social/SocialContext'
import { Avatar, handle } from '../social/ui'
import { ShareWithFriend } from '../social/ShareWithFriend'
import { SharedRow, SocialGate, WholeCollectionRow } from './FriendsPage'
import * as more from '../social/more'
import { BlockReportButton, ReputationLine } from '../social/MoreUi'

/** One friend: what they've shared with the user, trading with them, and unfriending. */
export function FriendPage() {
  const { id = '' } = useParams<{ id: string }>()
  const back = useBack('/friends')
  const navigate = useNavigate()
  const { refresh } = useOverview()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available = more.useSocialMore()
  // What they've marked for trade (they show it to all friends).
  const [forTrade, setForTrade] = useState<more.ForTradeCard[]>([])
  useEffect(() => {
    if (!available || !id) return
    let cancelled = false
    more.forTradeList(id).then((l) => { if (!cancelled) setForTrade(l ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [available, id])

  return (
    <>
      <TopBar title="Friend" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <SocialGate>
            {(overview) => {
              const friend = overview.people[id] ?? null
              const link = overview.friends.find((f) => f.user_id === id)
              if (!friend || link?.status !== 'accepted') {
                return <div className="empty-state"><Icon name="person_off" />You're not friends with this person.</div>
              }
              const shared = overview.shared_with_me.filter((s) => s.owner === id)
              const binders = shared.filter((s) => s.kind === 'collection')
              const wholeCollection = (overview.shared_all_with_me ?? []).some((w) => w.owner === id && w.kind === 'collection')
              const pods = overview.pods.filter((p) => p.members.includes(id))
              return (
                <>
                  <div className="friend-hero rise" style={rise(0)}>
                    <Avatar profile={friend} size={112} />
                    <h1>{friend.display_name}</h1>
                    <div className="dim">{handle(friend)}</div>
                    {pods.length > 0 && <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>In {pods.map((p) => p.name).join(', ')}</div>}
                    <ReputationLine userId={id} />
                  </div>

                  {available && (
                    <button type="button" className="btn line block rise" style={{ ...rise(1), marginTop: 16 }} onClick={() => navigate(`/messages/${id}`)}>
                      <Icon name="chat" aria-hidden />Message
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn gold block rise"
                    style={{ ...rise(1), marginTop: available ? 8 : 16 }}
                    disabled={binders.length === 0 && forTrade.length === 0}
                    onClick={() => navigate(`/trades/new?to=${id}`)}
                  >
                    <Icon name="swap_horiz" aria-hidden />Propose a trade
                  </button>
                  {binders.length === 0 && forTrade.length === 0 && <div className="dim" style={{ fontSize: 12.5, marginTop: 6, textAlign: 'center' }}>Trading needs a binder they've shared with you, or cards they've marked for trade.</div>}

                  {forTrade.length > 0 && (
                    <>
                      <SectionHeader title={`For trade · ${forTrade.reduce((n, c) => n + c.for_trade, 0)}`} />
                      <div className="list wide-list">
                        {forTrade.slice(0, 12).map((c) => (
                          <button key={`${c.item_id}:${c.scryfall_id}`} type="button" className="crow read-only press" onClick={() => navigate(`/trades/new?to=${id}`, { state: { want: [more.forTradeAsTrade(c)] } })}>
                            <ArtImage className="thumb" src={toArtCrop(c.image_url)} seed={c.name} />
                            <div className="cmain">
                              <div className="cname">{c.name}</div>
                              <div className="cmeta"><span className="dim">{c.item_name ?? 'Binder'}{c.condition ? ` · ${c.condition}` : ''}</span></div>
                            </div>
                            <span className="ro-qty">{c.for_trade}×</span>
                          </button>
                        ))}
                      </div>
                      {forTrade.length > 12 && <div className="dim" style={{ marginTop: 8 }}>…and {forTrade.length - 12} more — pick them when you propose a trade.</div>}
                    </>
                  )}

                  <SectionHeader title="Shared with you" />
                  {shared.length === 0 ? (
                    <div className="notice">{friend.display_name} hasn't shared any decks or binders with you yet.</div>
                  ) : (
                    <div className="list">
                      {(wholeCollection || binders.length > 1) && <WholeCollectionRow owner={id} name={friend.display_name} binders={binders} whole={wholeCollection} />}
                      {shared.map((s) => <SharedRow key={`${s.kind}:${s.item_id}`} item={s} owner={null} />)}
                    </div>
                  )}

                  <ShareWithFriend overview={overview} friendId={id} friendName={friend.display_name} />

                  <button type="button" className="btn line block" style={{ marginTop: 28 }} onClick={() => setConfirmRemove(true)}>
                    <Icon name="person_remove" aria-hidden />Remove friend
                  </button>
                  <div style={{ marginTop: 8 }}>
                    <BlockReportButton userId={id} name={friend.display_name} item={{ kind: 'profile', id }} onBlocked={() => navigate('/friends', { replace: true })} />
                  </div>

                  {confirmRemove && (
                    <Dialog
                      title={`Remove ${friend.display_name}?`}
                      onDismiss={() => setConfirmRemove(false)}
                      actions={
                        <>
                          <button type="button" className="btn line" onClick={() => setConfirmRemove(false)}>Cancel</button>
                          <button
                            type="button"
                            className="btn danger"
                            onClick={async () => {
                              try {
                                await api.removeFriend(id)
                                await refresh()
                                navigate('/friends', { replace: true })
                              } catch (e) {
                                setError(e instanceof Error ? e.message : 'Something went wrong.')
                              }
                            }}
                          >
                            Remove
                          </button>
                        </>
                      }
                    >
                      <p className="muted" style={{ margin: 0 }}>You'll stop seeing what they share with all their friends, and they'll stop seeing yours. Pods you're both in stay as they are.</p>
                      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
                    </Dialog>
                  )}
                </>
              )
            }}
          </SocialGate>
        </div>
      </div>
    </>
  )
}
