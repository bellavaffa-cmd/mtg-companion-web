import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal } from '../components/CardZoomModal'
import { ArtImage, SearchPill, SectionHeader, StatFigure, TYPE_GROUPS, TYPE_PLURALS, primaryTypeOf, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { GAME_MODE_LABELS, normalizeDeck, type Collection, type CollectionEntry, type Deck, type DeckCardEntry, type GameMode } from '../types/models'
import * as api from '../social/api'
import { BinderPicker } from '../social/CardPicker'
import { useSocial } from '../social/SocialContext'
import { Avatar, handle } from '../social/ui'

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'error'; message: string } | { state: 'ok'; item: api.SharedItem }

/**
 * A deck or binder someone shared, view only: reached from Friends (/shared/owner/kind/id) or from a
 * share link (/s/token), which works without an account. A friend's binder can start a trade.
 */
export function SharedItemPage() {
  const params = useParams<{ owner?: string; kind?: string; itemId?: string; token?: string }>()
  const back = useBack(params.token ? '/' : '/friends')
  const { account } = useSync()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const byLink = !!params.token

  useEffect(() => {
    let cancelled = false
    setLoaded({ state: 'loading' })
    const load = params.token
      ? api.getSharedByLink(params.token)
      : api.getSharedItem(params.owner ?? '', params.kind === 'deck' ? 'deck' : 'collection', params.itemId ?? '')
    load
      .then((item) => { if (!cancelled) setLoaded(item ? { state: 'ok', item } : { state: 'missing' }) })
      .catch((e: unknown) => { if (!cancelled) setLoaded({ state: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' }) })
    return () => { cancelled = true }
    // A signed-in viewer may see more than a signed-out one.
  }, [params.token, params.owner, params.kind, params.itemId, account?.userId])

  const title = loaded.state === 'ok' ? String(loaded.item.data.name ?? 'Shared') : 'Shared'
  return (
    <>
      <TopBar title={title} onBack={back} />
      <div className="content-scroll">
        {loaded.state === 'loading' && <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>}
        {loaded.state === 'error' && <div className="empty-state"><Icon name="cloud_off" />{loaded.message}</div>}
        {loaded.state === 'missing' && (
          <div className="empty-state">
            <Icon name="link_off" />
            <div>{byLink ? 'This link no longer works — it may have been turned off, or the deck or binder deleted.' : "This isn't shared with you any more."}</div>
          </div>
        )}
        {loaded.state === 'ok' && (
          loaded.item.kind === 'deck'
            ? <SharedDeck item={loaded.item} />
            : <SharedBinder item={loaded.item} canTrade={!byLink && !!account} ownerId={params.owner ?? ''} />
        )}
      </div>
    </>
  )
}

function OwnerLine({ owner }: { owner: api.Profile }) {
  return (
    <div className="owner-line">
      <Avatar profile={owner} size={28} />
      <span>Shared by <b>{owner.display_name}</b> <span className="dim">{handle(owner)}</span></span>
    </div>
  )
}

function SharedDeck({ item }: { item: api.SharedItem }) {
  const navigate = useNavigate()
  const { account, createDeckWithCards, setGameMode } = useSync()
  const deck = normalizeDeck({ ...(item.data as Partial<Deck>), id: String(item.data.id ?? ''), name: String(item.data.name ?? 'Deck') })
  const [zoom, setZoom] = useState<DeckCardEntry | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const count = deck.cards.reduce((n, c) => n + c.quantity, 0)
  const groups = new Map<string, DeckCardEntry[]>()
  for (const card of [...deck.cards].sort((a, b) => a.name.localeCompare(b.name))) {
    const type = TYPE_GROUPS.includes(primaryTypeOf(card.typeLine)) ? primaryTypeOf(card.typeLine) : 'Other'
    groups.set(type, [...(groups.get(type) ?? []), card])
  }
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)

  const copy = () => {
    const mine = createDeckWithCards(`${deck.name}`, deck.cards.map((c) => ({ ...c })), deck.commander, deck.partnerCommander)
    if (deck.gameMode !== 'COMMANDER') setGameMode(mine.id, deck.gameMode as GameMode)
    setCopied(mine.id)
  }

  return (
    <>
      <div className="shared-hero rise" style={rise(0)}>
        <ArtImage className="shared-hero-art" src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} />
        <div className="shared-hero-text">
          <div className="eyebrow">{GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode} deck</div>
          <h1>{deck.name}</h1>
          <OwnerLine owner={item.owner} />
        </div>
      </div>
      <div className="stats rise" style={{ ...rise(1), marginTop: 12, maxWidth: 720 }}>
        <StatFigure value={count} label="Cards" />
        <StatFigure value={deck.cards.length} label="Unique" />
      </div>
      {account && (
        copied ? (
          <button type="button" className="banner press" style={{ marginTop: 12 }} onClick={() => navigate(`/decks/${copied}`)}>
            <Icon name="check_circle" /><span style={{ flex: 1 }}>Copied to your decks — open your copy</span><Icon name="chevron_right" />
          </button>
        ) : (
          <button type="button" className="btn line" style={{ marginTop: 12 }} onClick={copy}><Icon name="content_copy" aria-hidden />Copy to my decks</button>
        )
      )}
      {commanders.length > 0 && (
        <>
          <SectionHeader title={commanders.length > 1 ? 'Commanders' : 'Commander'} />
          <div className="list wide-list">{commanders.map((c) => <ReadOnlyCard key={c.scryfallId} card={c} onZoom={() => setZoom(c)} />)}</div>
        </>
      )}
      {[...groups.entries()].map(([type, cards]) => (
        <div key={type}>
          <SectionHeader title={`${TYPE_PLURALS[type] ?? type} · ${cards.reduce((n, c) => n + c.quantity, 0)}`} />
          <div className="list wide-list">{cards.map((c) => <ReadOnlyCard key={c.scryfallId} card={c} onZoom={() => setZoom(c)} />)}</div>
        </div>
      ))}
      {deck.cards.length === 0 && <div className="empty-state">This deck has no cards yet.</div>}
      {zoom && <CardZoomModal imageUrl={zoom.imageUrl} name={zoom.name} typeLine={zoom.typeLine} backImageUrl={zoom.backImageUrl} onClose={() => setZoom(null)} />}
    </>
  )
}

function ReadOnlyCard({ card, onZoom, foil, detail }: {
  card: { name: string; imageUrl: string | null; quantity: number; backImageUrl?: string | null }
  onZoom: () => void
  foil?: number
  detail?: string
}) {
  return (
    <button type="button" className="crow read-only press" onClick={onZoom}>
      <ArtImage className="thumb" src={toArtCrop(card.imageUrl)} seed={card.name} />
      <div className="cmain">
        <div className="cname">{card.name}</div>
        <div className="cmeta">
          {foil ? <span className="badge gold"><Icon name="auto_awesome" />{foil} foil</span> : null}
          {detail ? <span className="dim">{detail}</span> : null}
          {!foil && !detail ? <span /> : null}
        </div>
      </div>
      <span className="ro-qty">{card.quantity > 0 ? `${card.quantity}×` : ''}</span>
    </button>
  )
}

/** One card across a friend's binders: copies owned in all of them, and which binders. */
interface OwnedCard {
  scryfallId: string
  name: string
  imageUrl: string | null
  backImageUrl?: string | null
  quantity: number
  foilQuantity: number
  binders: string[]
}

/** How many cards the collection page lists before asking for a search. */
const COLLECTION_LIST_LIMIT = 300

/**
 * A friend's collection as a whole (/shared/owner/collection): every card across the binders they
 * share with the user — all of them when they share their whole collection — searchable, with the
 * binders themselves below. Wishlists are listed but their cards aren't counted as owned.
 */
export function SharedCollectionPage() {
  const { owner = '' } = useParams<{ owner: string }>()
  const back = useBack(`/friends/${owner}`)
  const navigate = useNavigate()
  const { account } = useSync()
  const [loaded, setLoaded] = useState<{ state: 'loading' } | { state: 'missing' } | { state: 'error'; message: string } | { state: 'ok'; data: api.SharedCollection }>({ state: 'loading' })
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState<OwnedCard | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded({ state: 'loading' })
    api.getSharedCollection(owner)
      .then((data) => { if (!cancelled) setLoaded(data ? { state: 'ok', data } : { state: 'missing' }) })
      .catch((e: unknown) => { if (!cancelled) setLoaded({ state: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' }) })
    return () => { cancelled = true }
  }, [owner, account?.userId])

  const name = loaded.state === 'ok' ? loaded.data.owner.display_name : null
  let body: ReactNode
  if (loaded.state === 'loading') body = <div className="empty-state"><Icon name="hourglass_empty" />Loading…</div>
  else if (loaded.state === 'error') body = <div className="empty-state"><Icon name="cloud_off" />{loaded.message}</div>
  else if (loaded.state === 'missing') body = <div className="empty-state"><Icon name="link_off" />Nothing of theirs is shared with you any more.</div>
  else {
    const binders = loaded.data.binders.map((b) => b as unknown as Partial<Collection>)
    const owned = binders.filter((b) => b.type !== 'WISHLIST')
    const byCard = new Map<string, OwnedCard>()
    for (const b of owned) {
      for (const e of Array.isArray(b.entries) ? b.entries : []) {
        const card = byCard.get(e.scryfallId) ?? { scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, backImageUrl: e.backImageUrl, quantity: 0, foilQuantity: 0, binders: [] }
        card.quantity += e.quantity
        card.foilQuantity += e.foilQuantity
        card.binders.push(b.name ?? 'Binder')
        byCard.set(e.scryfallId, card)
      }
    }
    const cards = [...byCard.values()].sort((a, b) => a.name.localeCompare(b.name))
    const total = cards.reduce((n, c) => n + c.quantity + c.foilQuantity, 0)
    const q = query.trim().toLowerCase()
    const shown = q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards
    body = (
      <>
        <div className="binder-head rise" style={rise(0)}>
          <div className="eyebrow">{loaded.data.whole ? 'Whole collection' : 'Everything shared with you'}</div>
          <h1>{loaded.data.owner.display_name}'s collection</h1>
          <OwnerLine owner={loaded.data.owner} />
        </div>
        <div className="stats rise" style={{ ...rise(1), marginTop: 12, maxWidth: 720 }}>
          <StatFigure value={total} label="Cards" />
          <StatFigure value={cards.length} label="Unique" />
          <StatFigure value={binders.length} label="Binders" />
        </div>
        {account && total > 0 && (
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" className="btn gold" onClick={() => navigate(`/trades/new?to=${owner}`)}>
              <Icon name="swap_horiz" aria-hidden />Propose a trade
            </button>
          </div>
        )}
        <div style={{ marginTop: 14, maxWidth: 480 }}>
          <SearchPill value={query} onChange={setQuery} placeholder={`Search ${cards.length} cards`} />
        </div>
        <div className="list wide-list" style={{ marginTop: 14 }}>
          {shown.slice(0, COLLECTION_LIST_LIMIT).map((c) => (
            <ReadOnlyCard
              key={c.scryfallId}
              card={{ ...c, quantity: c.quantity + c.foilQuantity }}
              foil={c.foilQuantity}
              detail={c.binders.join(', ')}
              onZoom={() => setZoom(c)}
            />
          ))}
          {shown.length === 0 && <div className="empty-state">{q ? `No cards match “${query}”.` : 'No cards yet.'}</div>}
          {shown.length > COLLECTION_LIST_LIMIT && (
            <div className="dim" style={{ padding: '8px 4px' }}>Showing {COLLECTION_LIST_LIMIT} of {shown.length} — search to find a card.</div>
          )}
        </div>
        <SectionHeader title={`Binders · ${binders.length}`} />
        <div className="list wide-list">
          {binders.map((b) => {
            const entries = Array.isArray(b.entries) ? b.entries : []
            return (
              <button key={b.id} type="button" className="brow press" onClick={() => navigate(`/shared/${owner}/collection/${encodeURIComponent(String(b.id ?? ''))}`)}>
                {entries[0] ? <ArtImage src={toArtCrop(entries[0].imageUrl)} seed={b.name ?? ''} /> : <div className="icon-tile"><Icon name={b.type === 'WISHLIST' ? 'star' : 'collections'} /></div>}
                <div style={{ minWidth: 0 }}>
                  <div className="brow-name">{b.name ?? 'Binder'}</div>
                  <div className="brow-meta">
                    {b.type === 'WISHLIST' && <span className="badge soft">Wishlist</span>}
                    <span><b>{entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0)}</b>cards</span>
                  </div>
                </div>
                <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
              </button>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar title={name ? `${name}'s collection` : 'Collection'} onBack={back} />
      <div className="content-scroll">{body}</div>
      {zoom && <CardZoomModal imageUrl={zoom.imageUrl} name={zoom.name} backImageUrl={zoom.backImageUrl} onClose={() => setZoom(null)} />}
    </>
  )
}

function SharedBinder({ item, canTrade, ownerId }: { item: api.SharedItem; canTrade: boolean; ownerId: string }) {
  const navigate = useNavigate()
  const { overview } = useSocial()
  const collection = item.data as unknown as Partial<Collection>
  const entries: CollectionEntry[] = Array.isArray(collection.entries) ? collection.entries : []
  const [zoom, setZoom] = useState<CollectionEntry | null>(null)
  const [trading, setTrading] = useState(false)
  const [picked, setPicked] = useState<api.TradeCard[]>([])
  const cards = entries.reduce((n, e) => n + e.quantity, 0)
  const foils = entries.reduce((n, e) => n + e.foilQuantity, 0)
  const isFriend = !!overview?.friends.some((f) => f.user_id === ownerId && f.status === 'accepted')
  const pickedCount = picked.reduce((n, c) => n + c.quantity, 0)
  const itemId = String(collection.id ?? '')

  return (
    <>
      <div className="binder-head rise" style={rise(0)}>
        <div className="eyebrow">{collection.type === 'WISHLIST' ? 'Wishlist' : 'Binder'}</div>
        <h1>{collection.name ?? 'Binder'}</h1>
        <OwnerLine owner={item.owner} />
      </div>
      <div className="stats rise" style={{ ...rise(1), marginTop: 12, maxWidth: 720 }}>
        <StatFigure value={cards} label="Cards" />
        <StatFigure value={foils} label="Foils" />
        <StatFigure value={entries.length} label="Unique" />
      </div>
      {canTrade && isFriend && collection.type !== 'WISHLIST' && entries.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button type="button" className={`btn ${trading ? 'line' : 'gold'}`} onClick={() => { setTrading((t) => !t); setPicked([]) }}>
            <Icon name={trading ? 'close' : 'swap_horiz'} aria-hidden />{trading ? 'Stop picking' : 'Ask to trade for cards'}
          </button>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        {trading ? (
          <BinderPicker collectionId={itemId} entries={entries} picked={picked} onChange={setPicked} emptyText="This binder is empty." />
        ) : entries.length === 0 ? (
          <div className="empty-state">This binder is empty.</div>
        ) : (
          <div className="list wide-list">
            {[...entries].sort((a, b) => a.name.localeCompare(b.name)).map((e) => (
              <ReadOnlyCard key={e.scryfallId} card={e} foil={e.foilQuantity} onZoom={() => setZoom(e)} />
            ))}
          </div>
        )}
      </div>
      {trading && pickedCount > 0 && (
        <div className="trade-bar">
          <span><b>{pickedCount}</b> {pickedCount === 1 ? 'card' : 'cards'} picked</span>
          <button type="button" className="btn gold" onClick={() => navigate(`/trades/new?to=${ownerId}`, { state: { want: picked } })}>
            Next<Icon name="arrow_forward" aria-hidden />
          </button>
        </div>
      )}
      {zoom && <CardZoomModal imageUrl={zoom.imageUrl} name={zoom.name} backImageUrl={zoom.backImageUrl} onClose={() => setZoom(null)} />}
    </>
  )
}
