// The Collection page's Cards tab: every card owned, in binders and decks, with the collection's
// totals, the header's search by name or tag, quick filters (Lent out, For sale, No place yet, Graded),
// Group by (set, binder, place), each row saying where its copies are, a list or a grid, and — press
// and hold to pick — gathering cards into a binder, adding them to a deck, exporting or removing them. Mirrors the Android app's
// CollectionsScreen (AllCardsTab).

import { allUserTags, userTagIndex } from '../collection/userTags'
import { biggerImageUrl } from '../types/scryfall'
import { PrintingPicker, printingName } from '../components/PrintingPicker'
import { useEffect, useMemo, useRef, useState } from 'react'
import { knownCards, useCardData } from './cardData'
import { BreakdownPanel } from './BreakdownPanel'
import { collectionBreakdown } from './breakdown'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { AddToSheet, type AddTarget } from '../components/AddToSheet'
import { useUndoBar } from '../components/useUndoBar'
import { useAddCheck } from '../components/useAddCheck'
import { cardsLabel, deckPlace, doneMessage } from './addTo'
import { CardZoomModal, zoomSteps } from '../components/CardZoomModal'
import { Dialog } from '../components/Dialog'
import { ManaSymbol } from '../components/ManaSymbols'
import { useLongPress } from '../components/useLongPress'
import { ArtImage, PillChip, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { getCardsByIds } from '../api/scryfall'
import { buyCardUrl } from '../api/buy'
import { isUnsorted, type Collection } from '../types/models'
import { isWishlist } from './wishlist'
import { allCardsOf, allCardTags, searchAllCards, copiesInBinders, gatherCounts, csvExportEntries, dashboardOf, exportEntries, type AllCard, type CollectionDashboard } from './allCards'
import { spares } from './spares'
import { spreadThin } from './spreadThin'
import { TradeOfferSheet } from '../social/TradeOffer'
import { ExportCollectionDialog } from './CardListDialogs'
import { useMoney } from '../money/currency'
import { matchedTags, tagLabel, useRoleTags } from '../tags/roleTags'
import { cardFactsOf, filterActive, filterCount, filterMatches, filterMatchesTags, NO_COLLECTION_FILTER, type CardFacts, type CollectionFilter } from './cardFilter'
import { ActiveFilterChips, CollectionFilterPanel } from './CollectionFilterPanel'
import {
  advancedActive, advancedCount, advancedFactsOf, advancedMatches, copyFactsOf, filterChips, NO_ADVANCED_FILTER, removeChip,
  type AdvancedFacts, type AdvancedFilter,
} from './advancedFilter'
import { AdvancedFilterPage } from './AdvancedFilterPage'
import { placeTree, placesOf } from './storagePlaces'
import { useCardViewMode } from '../settings/settings'
import { noteAllCardsOpened } from '../settings/perfStats'
import { useProgressiveList } from '../components/useProgressiveList'
import type { ReactNode } from 'react'
import type { ScryfallCard } from '../types/scryfall'
import {
  binderKeys, chipDescription, chipText, GROUP_BY_LABELS, GROUP_BYS, groupLayout, locationIndex, NO_PLACE_TITLE, passesQuick, placeKeys, QUICK_FILTERS,
  QUICK_LABELS, QUICK_MANAGE, quickCount, quickSets, setGroupDetail, setKeys, type CardGroupBy, type LayoutGroup, type LocationChip, type QuickFilter,
} from './collectionLayout'
import { LocationChips, PutAwayCard, type ChipActions } from './LocationChips'
import { SearchEverywhereRow } from './StorageTab'
import { getSets } from '../api/scryfall'
import { setProgress, type SetInfo } from './setCompletion'


// Scryfall's data for the cards owned, kept for this visit (see cardData.ts).
const known = knownCards

export interface CardsTabProps {
  onImport: () => void
  /** The header's search, and setting it (a tag tapped in a zoom). */
  query: string
  onQueryChange: (q: string) => void
  /** The header's filter button: the panel open, and how many filters are on (for its badge). */
  filterOpen: boolean
  onFiltersOn: (n: number) => void
  group: CardGroupBy
  onGroup: (g: CardGroupBy) => void
  quick: QuickFilter | null
  onQuick: (q: QuickFilter | null) => void
  onSearchEverywhere: () => void
}

export function AllCardsTab({ onImport, query, onQueryChange: setQuery, filterOpen, onFiltersOn, group, onGroup, quick, onQuick, onSearchEverywhere }: CardsTabProps) {
  const { collections, decks, gatherIntoBinder, removeFromCollection, addCardsToDeck, changePrintingEverywhere, setCardTags, recordUndo } = useSync()
  const showUndo = useUndoBar()
  const confirmAdd = useAddCheck()
  // A card whose printing is being changed, in every binder and deck that holds it.
  const [changing, setChanging] = useState<{ scryfallId: string; name: string } | null>(null)
  const navigate = useNavigate()
  const size = useLayoutSize()
  // When the tab started to draw, for "Opening All cards" in Settings › Data and speed.
  const [openedAt] = useState(() => performance.now())
  const cards = useMemo(() => allCardsOf(collections, decks), [collections, decks])
  const cardIds = useMemo(() => cards.map((c) => c.scryfallId), [cards])
  const cardNames = useMemo(() => cards.map((c) => c.name), [cards])
  const cardsById = useCardData(cardIds)
  const dashboard = useMemo(() => (cardsById ? dashboardOf(cards, cardsById) : null), [cards, cardsById])
  const { tags: roleTags, loading: tagging } = useRoleTags(cardNames)
  // Null until the cards' details have loaded.
  const breakdown = useMemo(() => {
    if (!cardsById || !dashboard || cards.length === 0) return null
    return collectionBreakdown(cards.map((c) => {
      const card = cardsById.get(c.scryfallId)
      return {
        id: c.scryfallId,
        name: c.name,
        imageUrl: c.imageUrl,
        // Proxies are print-outs: held, but worth nothing.
        copies: c.total - c.proxies,
        usd: dashboard.prices.get(c.scryfallId) ?? null,
        setCode: card?.set?.toLowerCase() ?? '',
        setName: card?.set_name ?? '',
        colors: new Set((card?.color_identity ?? card?.colors ?? []).map((x) => x.charAt(0).toUpperCase())),
        rarity: card?.rarity ?? '',
        typeLine: card?.type_line ?? card?.card_faces?.[0]?.type_line ?? '',
      }
    }))
  }, [cards, cardsById, dashboard])

  // Color, type and rarity, as in Search — narrowing the same list the search field does.
  const [cardFilter, setCardFilter] = useState<CollectionFilter>(NO_COLLECTION_FILTER)
  // The Advanced filters (a page of their own), on top of the panel's.
  const [advFilter, setAdvFilter] = useState<AdvancedFilter>(NO_ADVANCED_FILTER)
  const [advOpen, setAdvOpen] = useState(false)
  const filtering = filterActive(cardFilter) || advancedActive(advFilter)
  const filtersOn = filterCount(cardFilter) + advancedCount(advFilter)
  useEffect(() => { onFiltersOn(filtersOn) }, [filtersOn, onFiltersOn])
  // Where every printing's copies are (collectionLayout.ts), worked out once, not per row.
  const chipIndex = useMemo(() => locationIndex(collections, decks), [collections, decks])
  const quickIds = useMemo(() => quickSets(collections, chipIndex), [collections, chipIndex])
  const [puttingAway, setPuttingAway] = useState<AllCard | null>(null)
  const facts = useMemo(() => {
    const m = new Map<string, CardFacts>()
    if (cardsById) for (const [id, c] of cardsById) m.set(id, cardFactsOf(c))
    return m
  }, [cardsById])
  const advFacts = useMemo(() => {
    const m = new Map<string, AdvancedFacts>()
    if (cardsById) for (const [id, c] of cardsById) m.set(id, advancedFactsOf(c))
    return m
  }, [cardsById])
  const copyFacts = useMemo(() => copyFactsOf(collections, decks), [collections, decks])
  const ownedBinders = useMemo(() => collections.filter((c) => !isWishlist(c) && c.type !== 'WISHLIST').map((c) => ({ id: c.id, name: c.name })).sort((x, y) => x.name.localeCompare(y.name)), [collections])
  const ownedSets = useMemo(() => {
    const m = new Map<string, string>()
    if (cardsById) for (const c of cards) { const k = cardsById.get(c.scryfallId); if (k?.set) m.set(k.set.toLowerCase(), k.set_name ?? k.set.toUpperCase()) }
    return [...m].map(([code, name]) => ({ code, name })).sort((x, y) => x.name.localeCompare(y.name))
  }, [cards, cardsById])
  const clearFilters = () => { setCardFilter(NO_COLLECTION_FILTER); setAdvFilter(NO_ADVANCED_FILTER) }
  // Group by set says how much of each set you have: "41/92" (setCompletion.ts, Scryfall's sets).
  const setSizes = useSetSizes(group === 'set', cards, cardsById)
  const setSizesKey = setSizes.size
  // Opens as Settings → Card Display says; the toggle changes that default.
  const [view] = useCardViewMode('allCards')
  const [zoomId, setZoomId] = useState<string | null>(null)
  // Spares: binder cards no deck of yours plays — the obvious things to trade away.
  const [sparesOnly, setSparesOnly] = useState(false)
  const spareCards = useMemo(() => spares(collections, decks), [collections, decks])
  const spareIds = useMemo(() => new Set(spareCards.map((s) => s.entry.scryfallId)), [spareCards])
  // Spread thin: cards your decks use more copies of than you own — its own page.
  const thinCount = useMemo(() => spreadThin(collections, decks).length, [collections, decks])
  const [offering, setOffering] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(t)
  }, [notice])

  const money = useMoney()
  const q = query.trim().toLowerCase()
  const inSpares = (c: AllCard) => spareIds.has(c.scryfallId)
  // "proxy" reads as a tag of its own, so a search finds the cards standing in for real ones.
  // Every printing's own tags, found in one pass rather than card by card (thousands of cards).
  const userTags = useMemo(() => userTagIndex(decks, collections), [decks, collections])
  // The user's own tags offered in the filter's Tags row, most used first.
  const userTagOptions = useMemo(() => allUserTags(decks, collections).slice(0, 12), [decks, collections])
  const tagsFor = (c: AllCard) => allCardTags(c, roleTags, userTags)
  // The panel's filters and the advanced ones; a card whose data hasn't loaded is left out while either is on.
  const passes = (c: AllCard, basic: CollectionFilter, adv: AdvancedFilter) =>
    filterMatches(basic, facts.get(c.scryfallId)) &&
    filterMatchesTags(basic, roleTags.get(c.name.trim().toLowerCase()), userTags.get(c.scryfallId) ?? []) &&
    advancedMatches(adv, advFacts.get(c.scryfallId), copyFacts.get(c.scryfallId), (n) => money.toUsd(n))
  const named = useMemo(() => searchAllCards(cards, q, (c) => allCardTags(c, roleTags, userTags)), [cards, q, roleTags, userTags])
  const unquick = useMemo(
    () => named.filter((c) => (!filtering || passes(c, cardFilter, advFilter)) && (!sparesOnly || inSpares(c))),
    // passes and inSpares read only what's listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [named, filtering, cardFilter, advFilter, sparesOnly, spareIds, facts, advFacts, copyFacts, money, roleTags, userTags],
  )
  const shown = useMemo(() => unquick.filter((c) => passesQuick(quick, c.scryfallId, c.name, quickIds)), [unquick, quick, quickIds])
  // Group by: each group's header, then its cards — as one list, so it still comes a screenful at a time.
  const rows = useMemo((): ({ kind: 'head'; group: LayoutGroup<AllCard> } | { kind: 'card'; card: AllCard; key: string })[] => {
    if (group === 'none') return shown.map((card) => ({ kind: 'card', card, key: card.scryfallId }))
    const groups = group === 'set'
      ? groupLayout(shown, (c) => { const k = cardsById?.get(c.scryfallId); return setKeys(k?.set ? { code: k.set, name: k.set_name ?? '' } : null) }, 'Set not known yet', (code) => {
        const p = setSizes.get(code)
        return p ? setGroupDetail(p.owned, p.total) : null
      })
      : group === 'binder'
      ? groupLayout(shown, (c) => binderKeys(c.sources.map((s) => ({ kind: s.kind === 'deck' ? 'deck' as const : 'binder' as const, id: s.id, name: s.name }))), 'No binder')
      : groupLayout(shown, (c) => placeKeys(chipIndex.get(c.scryfallId) ?? []), NO_PLACE_TITLE)
    return groups.flatMap((g) => [{ kind: 'head' as const, group: g }, ...g.items.map((card) => ({ kind: 'card' as const, card, key: `${g.key}|${card.scryfallId}` }))])
    // setSizes is read when grouping by set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, group, cardsById, chipIndex, setSizesKey])
  // A screenful at a time: thousands of rows at once is what made a big collection slow to open.
  const list = useProgressiveList(rows.length, rows)
  const noted = useRef(false)
  useEffect(() => {
    if (noted.current || cards.length === 0) return
    noted.current = true
    noteAllCardsOpened(performance.now() - openedAt, cards.length)
  }, [cards.length, openedAt])
  // Live, for the Advanced page's "Show N cards".
  const countFor = (basic: CollectionFilter, adv: AdvancedFilter) =>
    named.filter((c) => passes(c, basic, adv) && (!sparesOnly || inSpares(c))).length
  const shownValue = shown.reduce((n, c) => n + (dashboard?.prices.get(c.scryfallId) ?? 0) * (c.total - c.proxies), 0)
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
  const [bulk, setBulk] = useState<'add' | 'export' | 'remove' | null>(null)
  const pickedLabel = cardsLabel(picked.map((c) => c.name))
  const done = () => { setBulk(null); setSelected(new Set()) }
  /**
   * The picked cards where the "Add to…" sheet said: a binder gathers every copy from your other
   * binders; a deck (or its Considering list) gets one copy of each, unless it has the card already.
   */
  const addTo = async (target: AddTarget) => {
    const ids = [...pickedIds]
    const label = pickedLabel
    done()
    if (target.kind === 'binder') {
      // Deck-only cards stay in their decks, so say what actually moved (tester report, build 19).
      const { moving, deckOnly, there } = gatherCounts(collections, target.id, ids)
      const undo = recordUndo(() => gatherIntoBinder(ids, target.id))
      const notes = [
        deckOnly > 0 ? `${deckOnly} ${deckOnly === 1 ? 'is' : 'are'} only in decks and stayed there.` : '',
        there > 0 && moving < ids.length ? `${there} ${there === 1 ? 'was' : 'were'} already there.` : '',
      ].filter(Boolean).join(' ')
      const head = moving === ids.length ? doneMessage('move', label, target.name)
        : moving === 0 ? `Nothing moved to ${target.name}`
        : `Moved ${moving} ${moving === 1 ? 'card' : 'cards'} to ${target.name}`
      const message = notes ? `${head}. ${notes}` : head
      showUndo(undo ? { message, undo } : { message })
      return
    }
    const have = ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : []))
    const fetched = have.length < ids.length ? await getCardsByIds(ids.filter((id) => !known.has(id))) : []
    for (const c of fetched) known.set(c.id, c)
    let going = [...have, ...fetched]
    if (!target.considering) {
      // Asked first when a card breaks the deck's rules. Cards the deck has already are skipped anyway.
      const inDeck = new Set((decks.find((d) => d.id === target.id)?.cards ?? []).map((c) => c.name.toLowerCase()))
      const ok = await confirmAdd(target, going.filter((c) => !inDeck.has(c.name.toLowerCase())), (c) => ({ scryfallId: c.id, name: c.name, quantity: 1, card: c }))
      if (!ok) return
      going = ok
    }
    let added = 0
    const undo = recordUndo(() => { added = addCardsToDeck(target.id, going, target.considering) })
    showUndo(added === 0
      ? { message: `${target.name} already has ${ids.length === 1 ? 'it' : 'them'}` }
      : { message: doneMessage('add', added === ids.length ? label : `${added} ${added === 1 ? 'card' : 'cards'}`, deckPlace(target.name, target.considering)), undo })
  }

  const unsorted = collections.find(isUnsorted)
  const unsortedCards = unsorted?.entries.reduce((n, e) => n + e.quantity + e.foilQuantity, 0) ?? 0
  const zoomCard = cards.find((c) => c.scryfallId === zoomId) ?? null

  if (cards.length === 0) {
    return (
      <EmptyState
        className="rise"
        style={rise(1)}
        icon="playing_cards"
        text="No cards yet. Every card in your binders and physical decks shows here."
        actions={[
          { label: 'Import your collection', icon: 'playlist_add', onClick: onImport },
          { label: 'Scan cards', icon: 'photo_camera', to: '/scan' },
        ]}
      />
    )
  }

  return (
    <>
      {unsorted && unsortedCards > 0 && !q && !quick && (
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

      {!q && !quick && group === 'none' && (
        <>
          <DashboardPanel dashboard={dashboard} loading={cardsById === undefined} />
          {/* Where the value sits — by set, colour, rarity, type — and the dearest cards. */}
          <BreakdownPanel breakdown={breakdown} onViewCard={(c) => navigate(`/card/${encodeURIComponent(c.name)}?id=${c.id}`)} />
        </>
      )}

      {filterOpen && (
        <div className="rise" style={{ maxWidth: size === 'phone' ? undefined : 560 }}>
          <CollectionFilterPanel filter={cardFilter} onChange={setCardFilter} onAdvanced={() => setAdvOpen(true)} onClear={clearFilters} anyOn={filtering} userTagOptions={userTagOptions} />
        </div>
      )}
      {!filterOpen && filtering && (
        <div style={{ marginTop: 10, maxWidth: size === 'phone' ? undefined : 560 }}>
          <ActiveFilterChips
            chips={filterChips(cardFilter, advFilter, {
              binderName: (id) => collections.find((c) => c.id === id)?.name,
              placeName: (id) => placesOf(collections).find((p) => p.id === id)?.name,
              formatLocal: (n) => money.formatLocal(n),
            })}
            onRemove={(key) => { const next = removeChip(cardFilter, advFilter, key); setCardFilter(next.basic); setAdvFilter(next.advanced) }}
            onClear={clearFilters}
          />
        </div>
      )}
      {advOpen && (
        <AdvancedFilterPage
          basic={cardFilter}
          advanced={advFilter}
          countFor={countFor}
          binders={ownedBinders}
          places={placeTree(placesOf(collections)).map((n) => ({ id: n.place.id, name: n.place.name, depth: n.depth }))}
          sets={ownedSets}
          onApply={(basic, adv) => { setCardFilter(basic); setAdvFilter(adv); setAdvOpen(false) }}
          onClose={() => setAdvOpen(false)}
        />
      )}
      {/* Quick filters: one at a time; each has its full screen behind "Manage…". */}
      <div className="ctabs-row" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map((qf) => (
          <PillChip key={qf} label={QUICK_LABELS[qf]} count={quickCount(qf, unquick, quickIds)} selected={quick === qf} onClick={() => onQuick(quick === qf ? null : qf)} />
        ))}
      </div>
      {quick && (
        <button type="button" className="link" style={{ marginTop: 8 }} onClick={() => navigate(QUICK_ROUTES[quick])}>Manage… · {QUICK_MANAGE[quick]}</button>
      )}
      <div className="ctabs-row" role="group" aria-label="Group by">
        <span className="lbl">Group by</span>
        {GROUP_BYS.map((g) => <PillChip key={g} label={GROUP_BY_LABELS[g]} selected={group === g} onClick={() => onGroup(g)} />)}
      </div>
      {(spareCards.length > 0 || decks.length > 0) && !quick && (
        <div className="chips" style={{ marginTop: 10 }}>
          {spareCards.length > 0 && (
            <PillChip
              label={`Spares · ${spareCards.length}`}
              icon="swap_horiz"
              selected={sparesOnly}
              onClick={() => setSparesOnly((v) => !v)}
            />
          )}
          {decks.length > 0 && (
            <PillChip
              label={thinCount > 0 ? `Spread thin · ${thinCount}` : 'Spread thin'}
              icon="call_split"
              onClick={() => navigate('/collections/thin')}
            />
          )}
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
          : filtering || quick
            ? <>{shown.length} {shown.length === 1 ? 'card' : 'cards'}{dashboard && ` · ${money.format(shownValue)}`}{tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}</>
          : q
            ? <>{shown.length} of {cards.length} unique match{tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}</>
            : <>{cards.reduce((n, c) => n + c.total, 0)} cards · {cards.length} unique (across all binders &amp; decks)</>}
        {tagging && ' · finding tags…'}
      </div>
      {notice && <div className="notice" style={{ marginTop: 10 }}><Icon name="check_circle" style={{ color: 'var(--ok)', fontSize: 18, marginRight: 6 }} />{notice}</div>}

      {shown.length === 0 ? (
        <EmptyState icon="search_off" text={quick && !q && !filtering ? `Nothing ${QUICK_LABELS[quick].toLowerCase()}.` : filtering || quick ? 'No cards match these filters.' : <>No cards match “{query}”.</>} />
      ) : (
        <CardRows
          rows={rows.slice(0, list.count)}
          grid={view === 'grid'}
          setGroup={group === 'set'}
          onOpenSet={(code) => navigate(`/collections/set/${encodeURIComponent(code)}`)}
          render={(c, key) => view === 'grid'
            ? <CardTile key={key} card={c} selecting={selecting} selected={pickedIds.has(c.scryfallId)} onToggle={() => toggle(c.scryfallId)} onZoom={() => setZoomId(c.scryfallId)} />
            : (
              <CardRow
                key={key}
                card={c}
                chips={chipIndex.get(c.scryfallId) ?? []}
                chipActions={{
                  onPlace: (id, section, page) => navigate(placeLink(id, section, page)),
                  onDeck: (id) => navigate(`/decks/${id}`),
                  onLent: () => navigate('/loans'),
                  onPutAway: () => setPuttingAway(c),
                  onMore: () => navigate(`/card/${encodeURIComponent(c.name)}?id=${c.scryfallId}`),
                }}
                price={dashboard?.prices.get(c.scryfallId)}
                selecting={selecting}
                selected={pickedIds.has(c.scryfallId)}
                onToggle={() => toggle(c.scryfallId)}
                onZoom={() => setZoomId(c.scryfallId)}
              />
            )}
        />
      )}
      {rows.length > 0 && list.more && <div ref={list.ref} className="list-more dim">Showing {Math.min(list.count, rows.length)} of {rows.length}…</div>}
      {q && <SearchEverywhereRow query={query} onClick={onSearchEverywhere} />}
      {puttingAway && (
        <PutAwayCard
          name={puttingAway.name}
          scryfallId={puttingAway.scryfallId}
          count={(chipIndex.get(puttingAway.scryfallId) ?? []).find((x) => x.kind === 'none')?.qty ?? 1}
          onClose={() => setPuttingAway(null)}
        />
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
          <button type="button" className="btn line sm" onClick={() => setBulk('add')}><Icon name="add" aria-hidden />Add to…</button>
          <button type="button" className="btn line sm" onClick={() => setBulk('export')}><Icon name="ios_share" aria-hidden />Export</button>
          <button type="button" className="btn line sm danger-text" onClick={() => setBulk('remove')}><Icon name="delete" aria-hidden />Remove</button>
        </div>
      )}

      {bulk === 'add' && selecting && (
        <AddToSheet
          verb="add"
          what={pickedLabel}
          subtitle="A binder gathers every copy · a deck gets one of each it doesn't have"
          imageUrl={picked[0]?.imageUrl}
          binders={(c: Collection) => !isWishlist(c) && c.type !== 'WISHLIST'}
          create
          quantity={null}
          onPick={(target) => { void addTo(target) }}
          onClose={() => setBulk((b) => (b === 'add' ? null : b))}
        />
      )}
      {bulk === 'export' && selecting && (
        <ExportCollectionDialog
          collection={{ id: 'all-cards', name: 'All cards', createdAt: 0, type: 'OWNED', entries: exportEntries(collections, cards, pickedIds) }}
          csvEntries={csvExportEntries(collections, cards, pickedIds)}
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
          userTags={userTags.get(zoomCard.scryfallId) ?? []}
          knownUserTags={allUserTags(decks, collections)}
          onUserTags={(next) => setCardTags(zoomCard.scryfallId, next)}
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
            {/* Where its copies are kept: every place, deck and loan. */}
            {(chipIndex.get(zoomCard.scryfallId) ?? []).length > 0 && (
              <div className="loc-chips" style={{ marginTop: 8 }} aria-label="Where it is">
                {(chipIndex.get(zoomCard.scryfallId) ?? []).map((chip, i) => (
                  <span key={i} className={`loc-chip${chip.kind === 'none' ? ' amber' : ''}`}><span aria-hidden="true">{chip.kind === 'none' ? `No place yet ×${chip.qty}` : chipText(chip)}</span><span className="sr-only">{chipDescription(chip)}</span></span>
                ))}
              </div>
            )}
            <button type="button" className="btn line sm" style={{ marginTop: 10 }} onClick={() => setChanging({ scryfallId: zoomCard.scryfallId, name: zoomCard.name })}>
              <Icon name="swap_horiz" aria-hidden />Change printing
            </button>
          </div>
        </CardZoomModal>
      )}

      {changing && (
        <PrintingPicker
          name={changing.name}
          currentId={changing.scryfallId}
          prompt="Pick the printing these should be — in every binder and deck that holds them. The copies stay as they are."
          onPick={(card) => {
            changePrintingEverywhere(changing.scryfallId, card)
            setNotice(`${card.name} is now ${printingName(card)}.`)
            // Stay on the card, now under its new printing.
            if (zoomId === changing.scryfallId) setZoomId(card.id)
            setChanging(null)
          }}
          onClose={() => setChanging(null)}
        />
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

function CardRow({ card, chips, chipActions, price, selecting, selected, onToggle, onZoom }: {
  card: AllCard; chips: LocationChip[]; chipActions: ChipActions; price?: number; selecting: boolean; selected: boolean; onToggle: () => void; onZoom: () => void
}) {
  const money = useMoney()
  const longPress = useLongPress({ onLongPress: onToggle, onClick: selecting ? onToggle : onZoom, selected: selecting ? selected : undefined })
  const where = card.sources.map((s) => s.name)
  return (
    <div className={`crow no-qty${selected ? ' picked' : ''}`} style={{ gridTemplateColumns: '56px minmax(0, 1fr) auto', cursor: 'pointer' }} {...longPress}>
      <div className="thumb-wrap">
        {selecting && <span className={`pick-mark${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Icon name="check" />}</span>}
        <ArtImage className="thumb" src={toArtCrop(card.imageUrl)} seed={card.name} />
        {card.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain">
        <div className="cname">{card.name}</div>
        <div className="cmeta">
          <span><b>{card.total}</b> total</span>
          {card.proxies > 0 && <span className="badge soft">{card.proxies === card.total ? 'proxy' : `${card.proxies} proxy`}</span>}
          {chips.length === 0 && <span>in {where.slice(0, 2).join(', ')}{where.length > 2 ? ` +${where.length - 2} more` : ''}</span>}
        </div>
        {/* Where its copies are: "Blue box › Instants ×2", "Talrand deck ×1", "No place yet · Put away". */}
        {!selecting && <LocationChips chips={chips} actions={chipActions} />}
      </div>
      {price != null ? <span className="cprice">{money.format(price)}</span> : <span />}
    </div>
  )
}

function CardTile({ card, selecting, selected, onToggle, onZoom }: {
  card: AllCard; selecting: boolean; selected: boolean; onToggle: () => void; onZoom: () => void
}) {
  const longPress = useLongPress({ onLongPress: onToggle, onClick: selecting ? onToggle : onZoom, selected: selecting ? selected : undefined })
  return (
    <div className={`card-cell press${selected ? ' picked' : ''}`} {...longPress}>
      <div className="card-cell-img">
        {card.imageUrl ? <img src={card.imageUrl} alt={card.name} loading="lazy" data-card-preview={biggerImageUrl(card.imageUrl) ?? undefined} /> : <ArtImage src={null} seed={card.name} />}
        {selecting && <span className={`pick-mark${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Icon name="check" />}</span>}
        <span className="card-cell-count"><span aria-hidden="true">×</span>{card.total}<span className="sr-only"> copies</span></span>
        {card.proxies > 0 && <span className="card-cell-proxy">proxy</span>}
        {card.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="card-cell-name" aria-hidden={card.imageUrl ? true : undefined}>{card.name}</div>
    </div>
  )
}

/** A place's page, at a box's section or a binder's page (a card row's place chip). */
const placeLink = (id: string, section?: string, page?: number) => {
  const p = new URLSearchParams()
  if (section) p.set('section', section)
  if (page) p.set('page', String(page))
  const qs = p.toString()
  return `/collections/place/${id}${qs ? `?${qs}` : ''}`
}

/** The full screen behind each quick filter's "Manage…". */
const QUICK_ROUTES: Record<QuickFilter, string> = { lent: '/loans', sale: '/collections/sell', noplace: '/collections/upkeep', graded: '/collections/graded-list' }

/** The Cards list: rows (or tiles) under their group headers; a set's header opens the set. */
function CardRows({ rows, grid, setGroup, onOpenSet, render }: {
  rows: ({ kind: 'head'; group: LayoutGroup<AllCard> } | { kind: 'card'; card: AllCard; key: string })[]
  grid: boolean
  setGroup: boolean
  onOpenSet: (code: string) => void
  render: (card: AllCard, key: string) => ReactNode
}) {
  // Runs of cards between headers, so a grid stays a grid under each header.
  const blocks: ({ head: LayoutGroup<AllCard> } | { cards: { card: AllCard; key: string }[] })[] = []
  for (const r of rows) {
    if (r.kind === 'head') blocks.push({ head: r.group })
    else {
      const last = blocks[blocks.length - 1]
      if (last && 'cards' in last) last.cards.push(r)
      else blocks.push({ cards: [r] })
    }
  }
  return (
    <div style={{ marginTop: 14 }}>
      {blocks.map((b, i) => {
        if ('head' in b) {
          const g = b.head
          const inner = (
            <>
              <h3>{g.title}</h3>
              {g.detail && <span className="detail" aria-label={`${g.detail} of the set`}>{g.detail}</span>}
              <span className="n">{g.items.length} {g.items.length === 1 ? 'card' : 'cards'}</span>
            </>
          )
          return setGroup && g.key
            ? <button key={`h${i}`} type="button" className="cgroup-h press" onClick={() => onOpenSet(g.key)}>{inner}<Icon name="chevron_right" aria-hidden /></button>
            : <div key={`h${i}`} className="cgroup-h">{inner}</div>
        }
        return (
          <div key={`b${i}`} className={grid ? 'card-grid' : 'list wide-list'}>
            {b.cards.map((r) => render(r.card, r.key))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * How much of each set the user has, by set code — Scryfall's set list fetched when [on] (grouping by
 * set), with the owned printings counted as the Sets page did (setCompletion.ts).
 */
function useSetSizes(on: boolean, cards: AllCard[], cardsById: Map<string, ScryfallCard> | null | undefined): Map<string, { owned: number; total: number }> {
  const [sets, setSets] = useState<Map<string, SetInfo> | null>(null)
  useEffect(() => {
    if (!on || sets) return
    let cancelled = false
    getSets().then((found) => { if (!cancelled && found.size > 0) setSets(found) }).catch(() => { /* the headers just say the count */ })
    return () => { cancelled = true }
  }, [on, sets])
  return useMemo(() => {
    const out = new Map<string, { owned: number; total: number }>()
    if (!on || !sets || !cardsById) return out
    const owned = new Map<string, string>()
    for (const c of cards) {
      if (c.total - c.proxies <= 0) continue
      const set = cardsById.get(c.scryfallId)?.set
      if (set) owned.set(c.scryfallId, set)
    }
    for (const p of setProgress(owned, sets)) out.set(p.set.code.toLowerCase(), { owned: p.owned, total: p.set.cardCount })
    return out
  }, [on, sets, cards, cardsById])
}
