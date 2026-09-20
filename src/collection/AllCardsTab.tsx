// The Collection page's All cards tab: every card owned, in binders and decks, with the collection's
// totals, a search by name or tag, a list or a grid, and — press and hold to pick — gathering cards
// into a binder, adding them to a deck, exporting or removing them. Mirrors the Android app's
// CollectionsScreen (AllCardsTab).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { ActionSheet } from '../components/ActionSheet'
import { CardZoomModal, zoomSteps } from '../components/CardZoomModal'
import { Dialog } from '../components/Dialog'
import { ManaSymbol } from '../components/ManaSymbols'
import { useLongPress } from '../components/useLongPress'
import { ArtImage, IconButton, PillChip, SearchPill, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { getCardsByIds } from '../api/scryfall'
import { buyCardUrl } from '../api/buy'
import type { ScryfallCard } from '../types/scryfall'
import { isUnsorted, type Collection } from '../types/models'
import { isWishlist } from './wishlist'
import { allCardsOf, copiesInBinders, dashboardOf, exportEntries, type AllCard, type CollectionDashboard } from './allCards'
import { spares } from './spares'
import { TradeOfferSheet } from '../social/TradeOffer'
import { ExportCollectionDialog } from './CardListDialogs'
import { useMoney } from '../money/currency'
import { matchedTags, matchesNameOrTag, tagLabel, tagsOf, useRoleTags } from '../tags/roleTags'

type ViewMode = 'list' | 'grid'
const VIEW_KEY = 'mtgweb_all_cards_view'

// Scryfall's data for the cards owned (price, colours, type), kept for this visit: a card added
// later is fetched on its own, not the whole collection again.
const known = new Map<string, ScryfallCard>()

/** Scryfall's data for [ids], as it comes: undefined while the first batch loads. */
function useCardData(ids: string[]): Map<string, ScryfallCard> | undefined {
  const key = [...ids].sort().join(',')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length === 0) return
    let cancelled = false
    void getCardsByIds(missing).then((cards) => {
      for (const c of cards) known.set(c.id, c)
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return useMemo(() => (ids.length === 0 || ids.some((id) => known.has(id)) ? new Map(known) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, version])
}

export function AllCardsTab({ onImport }: { onImport: () => void }) {
  const { collections, decks, gatherIntoBinder, removeFromCollection, createCollection, addCardsToDeck } = useSync()
  const navigate = useNavigate()
  const size = useLayoutSize()
  const cards = useMemo(() => allCardsOf(collections, decks), [collections, decks])
  const cardsById = useCardData(cards.map((c) => c.scryfallId))
  const dashboard = useMemo(() => (cardsById ? dashboardOf(cards, cardsById) : null), [cards, cardsById])
  const { tags: roleTags, loading: tagging } = useRoleTags(cards.map((c) => c.name))

  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const switchView = () => {
    const next = view === 'list' ? 'grid' : 'list'
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* this visit only */ }
  }
  const [zoomId, setZoomId] = useState<string | null>(null)
  // Spares: binder cards no deck of yours plays — the obvious things to trade away.
  const [sparesOnly, setSparesOnly] = useState(false)
  const spareCards = useMemo(() => spares(collections, decks), [collections, decks])
  const spareIds = useMemo(() => new Set(spareCards.map((s) => s.entry.scryfallId)), [spareCards])
  const [offering, setOffering] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(t)
  }, [notice])

  const q = query.trim().toLowerCase()
  const inSpares = (c: AllCard) => spareIds.has(c.scryfallId)
  // "proxy" reads as a tag of its own, so a search finds the cards standing in for real ones.
  const tagsFor = (c: AllCard) => (c.proxies > 0 ? [...tagsOf(roleTags, c.name), 'proxy'] : tagsOf(roleTags, c.name))
  const shown = cards.filter((c) => matchesNameOrTag(c.name, tagsFor(c), q)).filter((c) => !sparesOnly || inSpares(c))
  const tagHits = q ? [...new Set(shown.filter((c) => !c.name.toLowerCase().includes(q)).flatMap((c) => matchedTags(tagsFor(c), q)))] : []

  // Cards picked by pressing and holding (scryfall ids); ones no longer owned drop from the pick.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const picked = cards.filter((c) => selected.has(c.scryfallId))
  const pickedIds = new Set(picked.map((c) => c.scryfallId))
  const selecting = picked.length > 0
  const toggle = (id: string) => {
    const next = new Set(pickedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])
  const [bulk, setBulk] = useState<'binder' | 'deck' | 'export' | 'remove' | 'name' | null>(null)
  const [newName, setNewName] = useState('')
  const pickedLabel = picked.length === 1 ? picked[0].name : `${picked.length} cards`
  const done = (message?: string) => { setBulk(null); setSelected(new Set()); if (message) setNotice(message) }
  const intoNewBinder = () => {
    if (!newName.trim()) return
    const binder = createCollection(newName.trim(), 'OWNED')
    gatherIntoBinder([...pickedIds], binder.id)
    done(`Moved ${pickedLabel} into ${binder.name}.`)
  }
  const toDeck = async (deckId: string, deckName: string) => {
    const ids = [...pickedIds]
    setBulk(null)
    const have = ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : []))
    const fetched = have.length < ids.length ? await getCardsByIds(ids.filter((id) => !known.has(id))) : []
    for (const c of fetched) known.set(c.id, c)
    const added = addCardsToDeck(deckId, [...have, ...fetched], false)
    done(added === 0 ? `${deckName} already has ${picked.length === 1 ? 'it' : 'them'}.` : `Added ${added} ${added === 1 ? 'card' : 'cards'} to ${deckName}.`)
  }

  const unsorted = collections.find(isUnsorted)
  const unsortedCards = unsorted?.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0) ?? 0
  const binderTargets = collections.filter((c) => !isWishlist(c) && c.type !== 'WISHLIST')
  const zoomCard = cards.find((c) => c.scryfallId === zoomId) ?? null
  const money = useMoney()

  if (cards.length === 0) {
    return (
      <div className="empty-state rise" style={rise(1)}>
        <Icon name="playing_cards" />
        <div>No cards owned yet. Cards you add to any binder or deck appear here.</div>
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button type="button" className="btn line" onClick={onImport}><Icon name="playlist_add" />Import your collection</button>
        </div>
      </div>
    )
  }

  return (
    <>
      {unsorted && unsortedCards > 0 && (
        <div className="list wide-list rise" style={{ ...rise(1), marginBottom: 14 }}>
          <button type="button" className="brow press unsorted-row" onClick={() => navigate(`/collections/${unsorted.id}`)}>
            <div className="icon-tile"><Icon name="inbox" /></div>
            <div style={{ minWidth: 0 }}>
              <div className="brow-name">Unsorted</div>
              <div className="brow-meta"><span><b>{unsortedCards}</b>{unsortedCards === 1 ? 'card' : 'cards'} not in a binder yet — open to sort them</span></div>
            </div>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </button>
        </div>
      )}

      <DashboardPanel dashboard={dashboard} loading={cardsById === undefined} />

      <div className="row rise" style={{ ...rise(3), gap: 8, marginTop: 14, maxWidth: size === 'phone' ? undefined : 560 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchPill value={query} onChange={setQuery} placeholder="Name or tag, e.g. ramp" />
        </div>
        <IconButton icon={view === 'list' ? 'grid_view' : 'view_list'} label={view === 'list' ? 'Show as a grid' : 'Show as a list'} onClick={switchView} />
      </div>
      {spareCards.length > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          <PillChip
            label={`Spares · ${spareCards.length}`}
            icon="swap_horiz"
            selected={sparesOnly}
            onClick={() => setSparesOnly((v) => !v)}
          />
          {sparesOnly && (
            <button type="button" className="btn gold sm" onClick={() => setOffering(true)}>
              <Icon name="handshake" aria-hidden />Offer in a trade
            </button>
          )}
        </div>
      )}
      <div className="dim search-note">
        {sparesOnly
          ? <>{shown.length} spare {shown.length === 1 ? 'card' : 'cards'} — in your binders, in none of your decks</>
          : q
            ? <>{shown.length} of {cards.length} unique match{tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}</>
            : <>{cards.reduce((n, c) => n + c.total, 0)} cards · {cards.length} unique (across all binders &amp; decks)</>}
        {tagging && ' · finding tags…'}
      </div>
      {notice && <div className="notice" style={{ marginTop: 10 }}><Icon name="check_circle" style={{ color: 'var(--ok)', fontSize: 18, marginRight: 6 }} />{notice}</div>}

      {shown.length === 0 ? (
        <div className="empty-state">No cards match “{query}”.</div>
      ) : view === 'grid' ? (
        <div className="card-grid" style={{ marginTop: 14 }}>
          {shown.map((c) => (
            <CardTile key={c.scryfallId} card={c} selecting={selecting} selected={pickedIds.has(c.scryfallId)} onToggle={() => toggle(c.scryfallId)} onZoom={() => setZoomId(c.scryfallId)} />
          ))}
        </div>
      ) : (
        <div className="list wide-list" style={{ marginTop: 14 }}>
          {shown.map((c) => (
            <CardRow
              key={c.scryfallId}
              card={c}
              price={dashboard?.prices.get(c.scryfallId)}
              selecting={selecting}
              selected={pickedIds.has(c.scryfallId)}
              onToggle={() => toggle(c.scryfallId)}
              onZoom={() => setZoomId(c.scryfallId)}
            />
          ))}
        </div>
      )}

      {selecting && (
        <div className="select-bar" role="toolbar" aria-label="Selected cards">
          <button type="button" className="icon-btn" aria-label="Stop selecting" onClick={() => setSelected(new Set())}><Icon name="close" /></button>
          <span className="select-count"><b>{picked.length}</b> selected</span>
          {picked.length < cards.length && (
            <button type="button" className="btn line sm" onClick={() => setSelected(new Set([...pickedIds, ...shown.map((c) => c.scryfallId)]))}>
              <Icon name="select_all" aria-hidden />All
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn line sm" onClick={() => setBulk('binder')}><Icon name="drive_file_move" aria-hidden />To binder</button>
          <button type="button" className="btn line sm" onClick={() => setBulk('deck')}><Icon name="style" aria-hidden />To deck</button>
          <button type="button" className="btn line sm" onClick={() => setBulk('export')}><Icon name="ios_share" aria-hidden />Export</button>
          <button type="button" className="btn line sm danger-text" onClick={() => setBulk('remove')}><Icon name="delete" aria-hidden />Remove</button>
        </div>
      )}

      {bulk === 'binder' && selecting && (
        <ActionSheet
          title={`Move ${pickedLabel} into`}
          subtitle="Every copy in your other binders"
          imageUrl={picked[0]?.imageUrl}
          actions={[
            { label: 'New binder…', icon: 'add', tone: 'gold' as const, onClick: () => { setNewName(''); setBulk('name') } },
            ...binderTargets.map((c: Collection) => ({
              label: c.name,
              icon: isUnsorted(c) ? 'inbox' : 'collections',
              detail: isUnsorted(c) ? 'Not in a binder' : 'Binder',
              onClick: () => { gatherIntoBinder([...pickedIds], c.id); done(`Moved ${pickedLabel} into ${c.name}.`) },
            })),
          ]}
          onClose={() => setBulk((b) => (b === 'binder' ? null : b))}
        />
      )}
      {bulk === 'name' && selecting && (
        <Dialog
          title={`Move ${pickedLabel} to a new binder`}
          onDismiss={() => setBulk(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setBulk(null)}>Cancel</button>
              <button type="button" className="btn gold" disabled={!newName.trim()} onClick={intoNewBinder}>Create &amp; move</button>
            </>
          }
        >
          <label className="field-label" htmlFor="all-new-binder" style={{ marginTop: 0 }}>Binder name</label>
          <input id="all-new-binder" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && intoNewBinder()} autoFocus />
        </Dialog>
      )}
      {bulk === 'deck' && selecting && (
        <ActionSheet
          title={`Add ${pickedLabel} to`}
          subtitle="One copy of each, unless the deck has it already"
          imageUrl={picked[0]?.imageUrl}
          actions={decks.length === 0
            ? [{ label: 'No decks yet', icon: 'style', onClick: () => setBulk(null) }]
            : decks.map((d) => ({ label: d.name, icon: 'style', onClick: () => { void toDeck(d.id, d.name) } }))}
          onClose={() => setBulk((b) => (b === 'deck' ? null : b))}
        />
      )}
      {bulk === 'export' && selecting && (
        <ExportCollectionDialog
          collection={{ id: 'all-cards', name: 'All cards', createdAt: 0, type: 'OWNED', entries: exportEntries(collections, cards, pickedIds) }}
          title={`Export ${pickedLabel}`}
          onDismiss={() => setBulk(null)}
        />
      )}
      {bulk === 'remove' && selecting && (() => {
        const copies = copiesInBinders(collections, pickedIds)
        return (
          <Dialog
            title={picked.length === 1 ? 'Remove from collection?' : `Remove ${picked.length} cards from collection?`}
            onDismiss={() => setBulk(null)}
            actions={
              <>
                <button type="button" className="btn line" onClick={() => setBulk(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => { removeFromCollection([...pickedIds]); done() }}>Remove</button>
              </>
            }
          >
            <p className="muted" style={{ margin: 0 }}>
              Removes {pickedLabel} ({copies} {copies === 1 ? 'copy' : 'copies'}) from all your binders. Copies in decks and the Wishlist stay.
            </p>
          </Dialog>
        )
      })()}

      {offering && (
        <TradeOfferSheet
          cards={spareCards}
          prices={dashboard?.prices}
          onClose={() => setOffering(false)}
        />
      )}

      {zoomCard && (
        <CardZoomModal
          imageUrl={zoomCard.imageUrl}
          name={zoomCard.name}
          scryfallId={zoomCard.scryfallId}
          typeLine={known.get(zoomCard.scryfallId)?.type_line}
          priceUsd={known.get(zoomCard.scryfallId)?.prices?.usd}
          priceUsdFoil={known.get(zoomCard.scryfallId)?.prices?.usd_foil}
          buyUrl={buyCardUrl(known.get(zoomCard.scryfallId), zoomCard.name)}
          backImageUrl={zoomCard.backImageUrl}
          tags={tagsFor(zoomCard).map(tagLabel)}
          tagsLoading={!!tagging && !roleTags.has(zoomCard.name.trim().toLowerCase())}
          onTagClick={(label) => { setZoomId(null); setQuery(label) }}
          onClose={() => setZoomId(null)}
          {...zoomSteps(shown, zoomCard, (card) => setZoomId(card.scryfallId))}
        >
          <div className="panel">
            <div className="row-between">
              <div>
                <div className="p-h" style={{ margin: 0 }}><h3>{zoomCard.total} owned</h3></div>
                <div className="dim">
                  In your binders and decks{zoomCard.proxies > 0 && ` · ${zoomCard.proxies} ${zoomCard.proxies === 1 ? 'is a proxy' : 'are proxies'}`}
                </div>
              </div>
              {dashboard?.prices.has(zoomCard.scryfallId) && (
                <div style={{ textAlign: 'right' }}>
                  <div className="p-h" style={{ margin: 0 }}><h3>{money.format(dashboard.prices.get(zoomCard.scryfallId)! * zoomCard.total)}</h3></div>
                  <div className="dim">All copies</div>
                </div>
              )}
            </div>
          </div>
        </CardZoomModal>
      )}
    </>
  )
}

const TYPE_COLORS: Record<string, string> = {
  Creature: '#4E9A57', Instant: '#3B82C4', Sorcery: '#7E5AC4', Artifact: '#9AA0A6', Enchantment: '#E0A84E',
  Planeswalker: '#D3402F', Land: '#8A6D3B', Battle: '#B5651D', Other: '#6B6473',
}

/** Value, mana colours and a card-type pie over the whole collection. */
function DashboardPanel({ dashboard, loading }: { dashboard: CollectionDashboard | null; loading: boolean }) {
  const money = useMoney()
  if (!dashboard) {
    return <div className="panel rise all-dash" style={rise(2)}><div className="dim">{loading ? 'Calculating totals…' : "Couldn't load prices. Check your connection."}</div></div>
  }
  const total = Math.max(1, dashboard.typeCounts.reduce((n, [, c]) => n + c, 0))
  let at = 0
  const stops = dashboard.typeCounts.map(([type, n]) => {
    const from = at
    at += (n / total) * 360
    return `${TYPE_COLORS[type] ?? TYPE_COLORS.Other} ${from}deg ${at}deg`
  })
  return (
    <div className="panel rise all-dash" style={rise(2)}>
      <div className="all-dash-top">
        <div className="all-dash-value">
          <span className="num">{money.format(dashboard.totalUsd)}</span>
          <span className="dim">{dashboard.pricedCount} cards</span>
        </div>
        <div className="all-dash-colors">
          {dashboard.colorCounts.map(([color, n]) => (
            <span key={color}><ManaSymbol code={color === 'Colorless' ? 'C' : color} size={16} />{n}</span>
          ))}
        </div>
      </div>
      <div className="all-dash-types">
        <div className="all-dash-pie" style={{ background: `conic-gradient(${stops.join(', ')})` }} aria-hidden />
        <div className="all-dash-legend">
          {dashboard.typeCounts.map(([type, n]) => (
            <div key={type}>
              <span className="dot" style={{ background: TYPE_COLORS[type] ?? TYPE_COLORS.Other }} />
              <span className="grow">{type}</span>
              <b>{n}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CardRow({ card, price, selecting, selected, onToggle, onZoom }: {
  card: AllCard; price?: number; selecting: boolean; selected: boolean; onToggle: () => void; onZoom: () => void
}) {
  const money = useMoney()
  const longPress = useLongPress({ onLongPress: onToggle, onClick: selecting ? onToggle : onZoom })
  const where = card.sources.map((s) => s.name)
  return (
    <div className={`crow no-qty${selected ? ' picked' : ''}`} style={{ gridTemplateColumns: '56px minmax(0, 1fr) auto', cursor: 'pointer' }} {...longPress}>
      <div className="thumb-wrap">
        {selecting && <span className={`pick-mark${selected ? ' on' : ''}`} aria-label={selected ? 'Selected' : 'Not selected'}>{selected && <Icon name="check" />}</span>}
        <ArtImage className="thumb" src={toArtCrop(card.imageUrl)} seed={card.name} />
        {card.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain">
        <div className="cname">{card.name}</div>
        <div className="cmeta">
          <span><b>{card.total}</b> total</span>
          {card.proxies > 0 && <span className="badge soft">{card.proxies === card.total ? 'proxy' : `${card.proxies} proxy`}</span>}
          <span>in {where.slice(0, 2).join(', ')}{where.length > 2 ? ` +${where.length - 2} more` : ''}</span>
        </div>
      </div>
      {price != null ? <span className="cprice">{money.format(price)}</span> : <span />}
    </div>
  )
}

function CardTile({ card, selecting, selected, onToggle, onZoom }: {
  card: AllCard; selecting: boolean; selected: boolean; onToggle: () => void; onZoom: () => void
}) {
  const longPress = useLongPress({ onLongPress: onToggle, onClick: selecting ? onToggle : onZoom })
  return (
    <div className={`card-cell press${selected ? ' picked' : ''}`} {...longPress}>
      <div className="card-cell-img">
        {card.imageUrl ? <img src={card.imageUrl} alt={card.name} loading="lazy" /> : <ArtImage src={null} seed={card.name} />}
        {selecting && <span className={`pick-mark${selected ? ' on' : ''}`} aria-label={selected ? 'Selected' : 'Not selected'}>{selected && <Icon name="check" />}</span>}
        <span className="card-cell-count">×{card.total}</span>
        {card.proxies > 0 && <span className="card-cell-proxy">proxy</span>}
        {card.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="card-cell-name">{card.name}</div>
    </div>
  )
}
