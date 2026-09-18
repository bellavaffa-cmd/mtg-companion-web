import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { ArtImage, SearchPill, SectionHeader, rise, toArtCrop, useBack } from '../components/kit'
import { UNSORTED_COLLECTION_ID } from '../types/models'
import * as api from './api'
import { useOverview } from './SocialContext'
import { Avatar, handle } from './ui'
import { SocialGate } from '../pages/FriendsPage'

// What friends share, as the Collection page's Shared view: a tile per friend, "who has a card?"
// across all of it, and each friend's shared things as folders. Mirrors the Android app's
// ui/social/SharedTab.kt.

const SEEN_KEY = 'mtgweb_shared_seen'

/** The newest edit the user had seen from each friend, so tiles can mark what's changed since. */
function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function markSeen(owner: string, editedMs: number) {
  try {
    const seen = loadSeen()
    if ((seen[owner] ?? 0) >= editedMs) return
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen, [owner]: editedMs }))
  } catch {
    // Storage unavailable: the dot just stays.
  }
}

interface FriendShares {
  owner: string
  profile: api.Profile | null
  binders: api.SharedSummary[]
  wishlists: api.SharedSummary[]
  decks: api.SharedSummary[]
  whole: boolean
  cards: number
  latest: number
  /** Art for a friend without a picture: a commander's, else a binder's first card. */
  cover: string | null
}

const isWishlist = (s: api.SharedSummary) => s.type === 'WISHLIST'
const byName = (a: api.SharedSummary, b: api.SharedSummary) => (a.name ?? '').localeCompare(b.name ?? '')
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

function friendShares(overview: api.Overview): FriendShares[] {
  const byOwner = new Map<string, api.SharedSummary[]>()
  for (const s of overview.shared_with_me) byOwner.set(s.owner, [...(byOwner.get(s.owner) ?? []), s])
  return [...byOwner.entries()].map(([owner, items]) => {
    const binders = items.filter((s) => s.kind === 'collection' && !isWishlist(s))
      .sort((a, b) => Number(b.item_id === UNSORTED_COLLECTION_ID) - Number(a.item_id === UNSORTED_COLLECTION_ID) || byName(a, b))
    const decks = items.filter((s) => s.kind === 'deck').sort(byName)
    return {
      owner,
      profile: overview.people[owner] ?? null,
      binders,
      wishlists: items.filter((s) => s.kind === 'collection' && isWishlist(s)).sort(byName),
      decks,
      whole: (overview.shared_all_with_me ?? []).some((w) => w.owner === owner && w.kind === 'collection'),
      cards: [...binders, ...decks].reduce((n, s) => n + s.cards, 0),
      latest: Math.max(0, ...items.map((s) => s.edited_ms)),
      cover: decks.find((d) => d.cover)?.cover ?? binders.find((b) => b.cover)?.cover ?? null,
    }
  }).sort((a, b) => b.latest - a.latest || (a.profile?.display_name ?? '').localeCompare(b.profile?.display_name ?? ''))
}

/** The Collection page's Shared view. */
export function SharedFriendsView() {
  const navigate = useNavigate()
  return (
    <SocialGate>
      {(overview) => <SharedFriendsGrid overview={overview} onAddFriend={() => navigate('/friends')} />}
    </SocialGate>
  )
}

function SharedFriendsGrid({ overview, onAddFriend }: { overview: api.Overview; onAddFriend: () => void }) {
  const navigate = useNavigate()
  const friends = useMemo(() => friendShares(overview), [overview])
  const [seen] = useState(loadSeen)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<api.SharedCardHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wanted, setWanted] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    api.wishlistMatches()
      .then((matches) => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const m of matches) counts[m.owner] = (counts[m.owner] ?? 0) + 1
        setWanted(counts)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [overview])

  const q = query.trim()
  useEffect(() => {
    setHits(null)
    setError(null)
    if (q.length < 2) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      api.searchSharedCards(q)
        .then((found) => { if (!cancelled) setHits(found) })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.') })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [q])

  const openItem = (owner: string, kind: api.ShareKind, id: string) => navigate(`/shared/${owner}/${kind}/${encodeURIComponent(id)}`)

  return (
    <>
      {friends.length > 0 && (
        <div className="rise" style={{ ...rise(1), marginBottom: 14, maxWidth: 520 }}>
          <SearchPill value={query} onChange={setQuery} placeholder="Who has a card? e.g. Sol Ring" />
        </div>
      )}
      {q.length >= 2 ? (
        error ? <div className="notice warn">{error}</div>
          : !hits ? <div className="empty-state"><Icon name="hourglass_empty" />Searching…</div>
          : hits.length === 0 ? <div className="notice">None of your friends' shared cards is called “{q}”.</div>
          : <HitList hits={hits} overview={overview} onOpen={openItem} />
      ) : (
        <>
          {friends.length === 0 && (
            <div className="notice" style={{ marginBottom: 12 }}>
              When friends share their collection, binders or decks with you, they show up here — and you can search them all for a card you need.
            </div>
          )}
          <div className="tiles">
            {friends.map((f, i) => (
              <FriendTile key={f.owner} f={f} index={i} updated={f.latest > (seen[f.owner] ?? 0)} wanted={wanted[f.owner] ?? 0} onOpen={() => navigate(`/shared/${f.owner}`)} />
            ))}
            <button type="button" className="tile add-tile press rise" style={rise(Math.min(friends.length, 8) + 3)} onClick={onAddFriend}>
              <span className="add-icon"><Icon name="person_add" /></span>
              <b>Add a friend</b>
              <span className="dim">See what they share</span>
            </button>
          </div>
        </>
      )}
    </>
  )
}

function HitList({ hits, overview, onOpen }: { hits: api.SharedCardHit[]; overview: api.Overview; onOpen: (owner: string, kind: api.ShareKind, id: string) => void }) {
  const groups = new Map<string, api.SharedCardHit[]>()
  for (const h of hits) groups.set(h.name, [...(groups.get(h.name) ?? []), h])
  return (
    <>
      {[...groups.entries()].map(([name, copies]) => (
        <div key={name}>
          <SectionHeader title={`${name} · ${plural(copies.reduce((n, c) => n + c.quantity + c.foil_quantity, 0), 'copy', 'copies')}`} />
          <div className="list wide-list">
            {copies.map((h) => {
              const owner = overview.people[h.owner] ?? null
              return (
                <button key={`${h.owner}:${h.kind}:${h.item_id}:${h.scryfall_id}`} type="button" className="crow read-only press hit-row" onClick={() => onOpen(h.owner, h.kind, h.item_id)}>
                  <div className="thumb-wrap">
                    <ArtImage className="thumb" src={toArtCrop(h.image_url)} seed={h.name} />
                    <span className="hit-avatar"><Avatar profile={owner} size={22} /></span>
                  </div>
                  <div className="cmain">
                    <div className="cname">{owner?.display_name ?? 'A friend'}</div>
                    <div className="cmeta"><span className="dim">{[h.kind === 'deck' ? 'Deck' : 'Binder', h.item_name, h.foil_quantity > 0 ? `${h.foil_quantity} foil` : null].filter(Boolean).join(' · ')}</span></div>
                  </div>
                  <span className="ro-qty">{h.quantity + h.foil_quantity}×</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {hits.length >= 200 && <div className="dim" style={{ marginTop: 10 }}>Showing the first 200 — type more of the name to narrow it down.</div>}
    </>
  )
}

/** A friend, the way the Decks page shows a deck: their picture full-size, what they share over it. */
function FriendTile({ f, index, updated, wanted, onOpen }: { f: FriendShares; index: number; updated: boolean; wanted: number; onOpen: () => void }) {
  const photo = api.avatarUrl(f.profile?.avatar_path)
  const name = f.profile?.display_name ?? 'A friend'
  const what = [
    f.binders.length ? plural(f.binders.length, 'binder') : null,
    f.decks.length ? plural(f.decks.length, 'deck') : null,
    f.wishlists.length ? plural(f.wishlists.length, 'wishlist') : null,
  ].filter(Boolean).join(' · ')
  const flag = f.whole ? 'Whole collection' : f.binders.length === 0 && f.wishlists.length === 0 ? 'Decks only' : null
  return (
    <button type="button" className="tile press rise" style={rise(Math.min(index, 8) + 3)} onClick={onOpen}>
      {photo ? (
        <div className="art"><img src={photo} alt="" loading="lazy" /></div>
      ) : (
        <>
          <ArtImage src={toArtCrop(f.cover)} seed={f.owner} />
          <div className="initial">{(name.trim()[0] ?? '?').toUpperCase()}</div>
        </>
      )}
      <div className="shade" />
      {flag && <span className="flag">{flag}</span>}
      {updated && <span className="new-dot" aria-label="Updated since you last looked" />}
      <div className="meta">
        <div className="t-name">{name}</div>
        {f.profile && <div className="t-cmd">{handle(f.profile)}</div>}
        <div className="t-cmd">{what}</div>
        {wanted > 0 && <div className="t-cmd wanted">{wanted} on your wishlist</div>}
        <div className="t-row"><span /><span className="t-val">{f.cards.toLocaleString()}<small>{f.cards === 1 ? 'card' : 'cards'}</small></span></div>
      </div>
    </button>
  )
}

/** One friend's shared things as folders (/shared/owner). */
export function FriendSharedPage() {
  const { owner = '' } = useParams<{ owner: string }>()
  const back = useBack('/collections?tab=shared')
  const { overview } = useOverview()
  const name = overview?.people[owner]?.display_name
  return (
    <>
      <TopBar title={name ? `${name}'s shared` : 'Shared'} onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width" style={{ maxWidth: 820 }}>
          <SocialGate>{(o) => <FriendFolders overview={o} owner={owner} />}</SocialGate>
        </div>
      </div>
    </>
  )
}

function FriendFolders({ overview, owner }: { overview: api.Overview; owner: string }) {
  const navigate = useNavigate()
  const f = useMemo(() => friendShares(overview).find((x) => x.owner === owner) ?? null, [overview, owner])
  const [wanted, setWanted] = useState<api.SharedCardHit[]>([])
  useEffect(() => { if (f) markSeen(owner, f.latest) }, [f, owner])
  useEffect(() => {
    let cancelled = false
    api.wishlistMatches().then((m) => { if (!cancelled) setWanted(m.filter((x) => x.owner === owner)) }).catch(() => {})
    return () => { cancelled = true }
  }, [overview, owner])
  if (!f) return <div className="empty-state"><Icon name="person_off" />Nothing of theirs is shared with you any more.</div>

  const name = f.profile?.display_name ?? 'A friend'
  const open = (kind: api.ShareKind, id: string) => navigate(`/shared/${owner}/${kind}/${encodeURIComponent(id)}`)
  const folders = [...f.binders, ...f.wishlists]
  return (
    <>
      <div className="row rise" style={{ ...rise(0), gap: 14, alignItems: 'center', margin: '4px 0 14px' }}>
        <Avatar profile={f.profile} size={64} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{name}</h1>
          <div className="dim">{[f.profile ? handle(f.profile) : null, plural(f.cards, 'card')].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {f.binders.length > 0 && (
        <button type="button" className="btn gold block rise" style={rise(1)} onClick={() => navigate(`/trades/new?to=${owner}`)}>
          <Icon name="swap_horiz" aria-hidden />Propose a trade
        </button>
      )}
      {wanted.length > 0 && (
        <>
          <SectionHeader title={`On your wishlist · ${wanted.length}`} />
          <div className="list wide-list">
            {wanted.slice(0, 6).map((h) => (
              <button key={`${h.item_id}:${h.scryfall_id}`} type="button" className="crow read-only press" onClick={() => open('collection', h.item_id)}>
                <ArtImage className="thumb" src={toArtCrop(h.image_url)} seed={h.name} />
                <div className="cmain">
                  <div className="cname">{h.name}</div>
                  <div className="cmeta"><span className="dim">In {h.item_name}{h.foil_quantity > 0 ? ` · ${h.foil_quantity} foil` : ''}</span></div>
                </div>
                <span className="ro-qty">{h.quantity + h.foil_quantity}×</span>
              </button>
            ))}
          </div>
          {wanted.length > 6 && <div className="dim" style={{ marginTop: 8 }}>…and {wanted.length - 6} more in their binders.</div>}
        </>
      )}
      {f.binders.length > 0 && (
        <>
          <SectionHeader title="All cards" />
          <button type="button" className="brow press unsorted-row" onClick={() => navigate(`/shared/${owner}/collection`)}>
            <div className="icon-tile"><Icon name="collections_bookmark" /></div>
            <div style={{ minWidth: 0 }}>
              <div className="brow-name">Everything {name} shares</div>
              <div className="brow-meta"><span><b>{f.binders.reduce((n, b) => n + b.cards, 0).toLocaleString()}</b>cards · searchable</span></div>
            </div>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        </>
      )}
      {folders.length > 0 && (
        <>
          <SectionHeader title={`Binders · ${folders.length}`} />
          <div className="folders">
            {folders.map((b) => (
              <button key={b.item_id} type="button" className="folder press" onClick={() => open('collection', b.item_id)}>
                <span className="folder-tab" />
                <Icon name={isWishlist(b) ? 'star' : b.item_id === UNSORTED_COLLECTION_ID ? 'inbox' : 'folder'} />
                <b>{b.name ?? 'Binder'}</b>
                <span className="dim">{isWishlist(b) ? 'Wishlist · ' : ''}{plural(b.cards, 'card')}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {f.decks.length > 0 && (
        <>
          <SectionHeader title={`Decks · ${f.decks.length}`} />
          <div className="tiles">
            {f.decks.map((d) => (
              <button key={d.item_id} type="button" className="tile press" onClick={() => open('deck', d.item_id)}>
                <ArtImage src={toArtCrop(d.cover)} seed={d.name ?? d.item_id} />
                <div className="shade" />
                <div className="meta">
                  <div className="t-name">{d.name ?? 'Deck'}</div>
                  <div className="t-row"><span /><span className="t-val">{d.cards}<small>{d.cards === 1 ? 'card' : 'cards'}</small></span></div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
