import { useEffect, useMemo, useRef, useState } from 'react'
import { useMoney } from '../money/currency'
import { searchCards } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import { backImageUrl, cardTags, displayImageUrl, displayManaCost, displayOracleText, hasFlipSides } from '../types/scryfall'
import { useSync } from '../sync/SyncContext'
import { isUnsorted } from '../types/models'
import { ActionSheet } from './ActionSheet'
import type { SheetAction } from './ActionSheet'
import { Icon } from './Icon'
import { useLongPress } from './useLongPress'
import { CardZoomModal, zoomSteps } from './CardZoomModal'
import { buyCardUrl } from '../api/buy'
import { useAddWarning } from './useAddWarning'
import { ArtImage, PillChip, SearchPill, toArtCrop } from './kit'
import { SearchFiltersPanel } from './SearchFiltersPanel'
import { buildScryfallQuery, DEFAULT_SORT, NO_FILTERS, type SearchFilters, type SearchSort } from '../search/filters'
import { kindDetail, kindsToChoose, type TargetKind } from '../collection/addTargets'
import { appendPage } from '../search/pages'

interface Props {
  /** Inside a deck or binder: adding goes straight there. Omitted on the Search tab, where the
   * action sheet lists every deck and binder to add into. */
  onAdd?: (card: ScryfallCard) => void
  placeholder?: string
  /** Example queries shown before anything is typed. */
  examples?: { label: string; query: string }[]
  autoFocus?: boolean
  /** Starting query, e.g. from the desktop Home search box. */
  initialQuery?: string
  /** Lay results out in several columns when the screen is wide enough. */
  wide?: boolean
  /** Offer structured filters and a sort order (the Search tab). */
  filterable?: boolean
}

export function CardSearchResults({ onAdd, placeholder = 'Search Scryfall, e.g. c:g t:creature', examples, autoFocus, initialQuery = '', wide, filterable }: Props) {
  const money = useMoney()
  const { decks, collections, addCardToDeck, addEntryToCollection } = useSync()
  const [query, setQuery] = useState(initialQuery)
  const [cards, setCards] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Paging: the last page showing, whether Scryfall has another, and that next page's request.
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  // Counts searches, so a page that answers after the query or filters changed is dropped rather
  // than landing in the new results.
  const searchId = useRef(0)
  const [zoomCard, setZoomCard] = useState<ScryfallCard | null>(null)
  const [sheetCard, setSheetCard] = useState<ScryfallCard | null>(null)
  // Binders or decks, once picked on the sheet's first step; null shows that first step.
  const [sheetKind, setSheetKind] = useState<TargetKind | null>(null)
  const [addWarning, setAddWarning] = useAddWarning()
  const [added, setAdded] = useState<string | null>(null)
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS)
  const [sort, setSort] = useState<SearchSort>(DEFAULT_SORT)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // What's actually sent to Scryfall: the typed query plus the filters, like the phone app.
  const effective = useMemo(() => buildScryfallQuery(query, filters), [query, filters])

  useEffect(() => {
    const trimmed = effective.trim()
    const id = ++searchId.current
    setPage(1)
    setHasMore(false)
    setLoadingMore(false)
    setMoreError(null)
    if (!trimmed) {
      setCards([])
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      searchCards(trimmed, 1, sort.order ?? undefined, sort.dir)
        .then((first) => {
          if (cancelled || id !== searchId.current) return
          setCards(first.cards)
          setHasMore(first.hasMore)
          setError(null)
        })
        .catch((e) => {
          if (cancelled || id !== searchId.current) return
          setError(e instanceof Error ? e.message : 'Search failed')
          setCards([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [effective, sort])

  const loadMore = () => {
    const id = searchId.current
    const next = page + 1
    setLoadingMore(true)
    setMoreError(null)
    searchCards(effective.trim(), next, sort.order ?? undefined, sort.dir)
      .then((more) => {
        if (id !== searchId.current) return
        setCards((shown) => appendPage(shown, more.cards))
        setPage(next)
        setHasMore(more.hasMore)
      })
      .catch((e) => {
        if (id !== searchId.current) return
        setMoreError(e instanceof Error ? e.message : 'Search failed')
      })
      .finally(() => {
        if (id === searchId.current) setLoadingMore(false)
      })
  }

  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(null), 2500)
    return () => clearTimeout(t)
  }, [added])

  function add(card: ScryfallCard) {
    onAdd?.(card)
    setAdded(`Added ${card.name}`)
  }

  function actionsFor(card: ScryfallCard): SheetAction[] {
    const view: SheetAction = { label: 'View card', icon: 'visibility', onClick: () => setZoomCard(card) }
    if (onAdd) return [{ label: 'Add', icon: 'add', tone: 'gold', onClick: () => add(card) }, view]
    const toDecks = decks.map((d): SheetAction => ({
      label: `Add to ${d.name}`, icon: 'style', detail: 'Deck',
      onClick: () => { setAddWarning(addCardToDeck(d.id, card)); setAdded(`Added to ${d.name}`) },
    }))
    const toBinders = collections.map((c): SheetAction => ({
      label: `Add to ${c.name}`,
      icon: isUnsorted(c) ? 'inbox' : c.type === 'WISHLIST' ? 'star' : 'collections',
      detail: isUnsorted(c) ? 'Not in a binder' : c.type === 'WISHLIST' ? 'Wishlist' : 'Binder',
      onClick: () => { addEntryToCollection(c.id, card); setAdded(`Added to ${c.name}`) },
    }))
    const kinds = kindsToChoose(toBinders.length, toDecks.length)
    if (!kinds) return [view, ...toDecks, ...toBinders]
    // The sheet closes before an action runs, so a step within it opens it again.
    const step = (kind: TargetKind | null) => () => { setSheetCard(card); setSheetKind(kind) }
    if (sheetKind) {
      return [
        { label: 'Back', icon: 'arrow_back', detail: 'Binder or deck', onClick: step(null) },
        ...(sheetKind === 'deck' ? toDecks : toBinders),
      ]
    }
    return [
      view,
      ...kinds.map((kind): SheetAction => ({
        label: kind === 'deck' ? 'Add to a deck' : 'Add to a binder',
        icon: kind === 'deck' ? 'style' : 'collections',
        tone: 'gold',
        detail: kindDetail(kind, kind === 'deck' ? toDecks.length : toBinders.length),
        onClick: step(kind),
      })),
    ]
  }

  return (
    <div>
      <SearchPill value={query} onChange={setQuery} placeholder={placeholder} autoFocus={autoFocus} />
      {filterable && (
        <SearchFiltersPanel
          filters={filters}
          onChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          open={filtersOpen}
          onToggle={() => setFiltersOpen((o) => !o)}
        />
      )}
      {filterable && effective.trim() && effective.trim() !== query.trim() && (
        <div className="sf-query" title="The Scryfall query these filters make">{effective}</div>
      )}
      {addWarning && <div className="add-warning" style={{ marginTop: 10 }}>{addWarning}</div>}
      {added && !addWarning && <div className="notice" style={{ marginTop: 10 }}><Icon name="check_circle" style={{ color: 'var(--ok)', fontSize: 18, marginRight: 6 }} />{added}</div>}

      {!effective.trim() && examples && (
        <div className="chips">
          {examples.map((e) => <PillChip key={e.query} label={e.label} onClick={() => setQuery(e.query)} />)}
        </div>
      )}

      {loading && <div className="muted" style={{ padding: '12px 4px 0' }}>Searching…</div>}
      {error && <div className="muted" style={{ color: 'var(--error)', padding: '12px 4px 0' }}>{error}</div>}
      {!loading && !error && effective.trim() && cards.length === 0 && <div className="empty-state">No cards match.</div>}
      <div className={`list${wide ? ' wide-list' : ''}`} style={{ marginTop: 12 }}>
        {cards.map((card) => (
          <ResultRow key={card.id} card={card} onZoom={() => setZoomCard(card)} onMore={() => setSheetCard(card)} onAdd={onAdd ? () => add(card) : undefined} />
        ))}
      </div>
      {!loading && !error && hasMore && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          {moreError && <div className="muted" style={{ color: 'var(--error)', marginBottom: 8 }}>{moreError}</div>}
          <button type="button" className="btn line" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : moreError ? 'Try again' : `Load more (showing ${cards.length})`}
          </button>
        </div>
      )}

      {sheetCard && (
        <ActionSheet
          title={sheetCard.name}
          subtitle={[sheetCard.type_line, money.formatPrice(sheetCard.prices?.usd)].filter(Boolean).join(' · ')}
          imageUrl={displayImageUrl(sheetCard)}
          actions={actionsFor(sheetCard)}
          onClose={() => { setSheetCard(null); setSheetKind(null) }}
        />
      )}

      {zoomCard && (
        <CardZoomModal
          imageUrl={displayImageUrl(zoomCard)}
          name={zoomCard.name}
          typeLine={zoomCard.type_line}
          priceUsd={zoomCard.prices?.usd}
          priceUsdFoil={zoomCard.prices?.usd_foil}
          scryfallId={zoomCard.id}
          backImageUrl={backImageUrl(zoomCard)}
          tags={cardTags(zoomCard)}
          oracleText={displayOracleText(zoomCard)}
          manaCost={displayManaCost(zoomCard)}
          onSelectSimilar={setZoomCard}
          buyUrl={buyCardUrl(zoomCard)}
          onClose={() => setZoomCard(null)}
          {...zoomSteps(cards, zoomCard, setZoomCard, (card) => card.id)}
        >
          {onAdd ? (
            <button type="button" className="btn gold block" onClick={() => { add(zoomCard); setZoomCard(null) }}>
              <Icon name="add" />Add
            </button>
          ) : (
            <button type="button" className="btn gold block" onClick={() => { setSheetCard(zoomCard); setZoomCard(null) }}>
              <Icon name="add" />Add to a deck or binder
            </button>
          )}
        </CardZoomModal>
      )}
    </div>
  )
}

function ResultRow({ card, onZoom, onMore, onAdd }: { card: ScryfallCard; onZoom: () => void; onMore: () => void; onAdd?: () => void }) {
  const money = useMoney()
  const longPress = useLongPress({ onLongPress: onMore, onClick: onZoom })
  return (
    <div className="crow no-qty" style={{ gridTemplateColumns: '56px minmax(0, 1fr) auto auto' }}>
      <div className="thumb-wrap" onClick={onZoom} style={{ cursor: 'pointer' }}>
        <ArtImage className="thumb" src={toArtCrop(displayImageUrl(card))} seed={card.name} colors={card.color_identity} />
        {hasFlipSides(card) && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain" {...longPress}>
        <div className="cname">{card.name}</div>
        <div className="cmeta"><span>{card.type_line ?? ''}</span></div>
      </div>
      {card.prices?.usd ? <span className="cprice">{money.formatPrice(card.prices.usd)}</span> : <span />}
      {onAdd ? (
        <button type="button" className="more" onClick={onAdd} aria-label={`Add ${card.name}`} style={{ color: 'var(--gold)' }}>
          <Icon name="add_circle" style={{ fontSize: 24 }} />
        </button>
      ) : (
        <button type="button" className="more" onClick={onMore} aria-label={`Actions for ${card.name}`}>
          <Icon name="more_vert" style={{ fontSize: 20 }} />
        </button>
      )}
    </div>
  )
}
