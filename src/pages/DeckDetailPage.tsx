import { useEffect, useMemo, useState } from 'react'
import { TokensPanel } from '../components/TokensPanel'
import { allUserTags, userTagsOf } from '../collection/userTags'
import { PrintingPicker, printingName } from '../components/PrintingPicker'
import { useMoney } from '../money/currency'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal, zoomSteps } from '../components/CardZoomModal'
import { ActionSheet } from '../components/ActionSheet'
import type { SheetAction } from '../components/ActionSheet'
import { AddToDeckSection, DeckCardRow, DeckCardTile } from '../components/DeckCardViews'
import { useAddSearch, useComboPieces, useDeckCombos } from '../components/useDeckCardSearch'
import { ComboPieceWarningDialog, DeckImportDialog, SwapPickerDialog } from '../components/DeckBuildingDialogs'
import { combosWithCard } from '../decks/considering'
import { deckPlace } from '../collection/addTo'
import { addableCards } from '../decks/addSearch'
import { CARD_FILTERS, CARD_FILTER_LABELS, filterCounts, noMatchMessage, passesFilter, type CardFilter } from '../decks/comboPieces'
import { ExportDeckDialog } from '../components/ExportDeckDialog'
import { ShareDialog } from '../social/ShareDialog'
import { WhoHasItSheet } from '../social/WhoHasIt'
import { missingCards } from '../decks/missing'
import { canPair, secondCommanderKind, SECOND_COMMANDER_NOUN, type SecondCommanderKind } from '../decks/pairing'
import { buyCardUrl, buyListUrl } from '../api/buy'
import { deckProxyCopies, proxiesHeldElsewhere, proxySwaps } from '../decks/proxies'
import { realCopiesOf } from '../collection/unsorted'
import { matchedTags, matchesNameOrTag, tagLabel, tagsOf, useRoleTags } from '../tags/roleTags'
import { useAddCardTo } from '../components/useAddCardTo'
import { useUndoBar } from '../components/useUndoBar'
import { doneMessage } from '../collection/addTo'
import { backImageUrl, cardTags, displayImageUrl, displayManaCost, displayOracleText, entryCanBeCommander, type ScryfallCard } from '../types/scryfall'
import { DeckSuggestions } from '../components/DeckSuggestions'
import { DeckSwaps } from '../components/DeckSwaps'
import { DeckStats, deckFigures, useDeckCardData } from '../components/DeckStats'
import { MatchRecordPanel } from '../components/MatchRecordPanel'
import { GoldfishDialog } from '../components/GoldfishDialog'
import { Dialog } from '../components/Dialog'
import {
  ArtImage, CountUp, IconButton, ManaPips, PillChip, SearchPill, SegmentedTabs, TYPE_GROUPS, TYPE_PLURALS,
  primaryTypeOf, rise, toArtCrop, useBack, useLayoutSize, useScrollProgress,
} from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { LAST_DECK_KEY } from '../components/Layout'
import {
  GAME_MODES, GAME_MODES_USING_COMMANDER, GAME_MODE_LABELS,
  DECK_OWNERSHIP_OPTIONS, DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_DESCRIPTIONS,
} from '../types/models'
import type { Deck, DeckCardEntry, DeckOwnership, GameMode } from '../types/models'

/** Whether the deck's Cards tab shows a list or a grid of card images, remembered in this browser. */
const DECK_VIEW_KEY = 'mtgweb_deck_cards_view'

export function DeckDetailPage() {
  const money = useMoney()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/decks')
  const size = useLayoutSize()
  const {
    decks, collections, setCardQuantity, removeCardFromDeck, setCommander, setPartnerCommander, deleteDeck, addToWishlist,
    setDeckOwnership, swapInProxy, changeDeckPrinting, stopConsidering, considerIntoDeck, setCardTags, setReplaceable, recordUndo,
    moveToConsidering, swapConsidered, importIntoDeck,
  } = useSync()
  const addCardTo = useAddCardTo()
  const showUndo = useUndoBar()
  // Tags the user has written on their own copies: shown in the zoom, and searchable with the rest.
  const knownTags = useMemo(() => allUserTags(decks, collections), [decks, collections])
  const deck = decks.find((d) => d.id === id)
  const deckColors = useDeckColors(deck ? [deck] : [])
  const cardData = useDeckCardData(deck)
  // What each card does (mana ramp, removal…): searched with the name, shown in the zoom and Stats.
  const { tags: roleTags, loading: tagging } = useRoleTags(deck ? [...deck.cards, ...(deck.considering ?? [])].map((c) => c.name) : [])
  // A deck just made from scratch opens where its next step is (see landingTab in decks/newDeck.ts).
  const opening = (useLocation().state as { tab?: 'Cards' | 'Suggestions' } | null)?.tab
  const [tabName, setTabName] = useState<'Cards' | 'Considering' | 'Stats' | 'Suggestions' | 'Details'>(opening ?? 'Cards')
  const [filter, setFilter] = useState('')
  // The chips under the search: every card, only the cut candidates, or only the combo pieces.
  const [cardFilter, setCardFilter] = useState<CardFilter>('ALL')
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try { return localStorage.getItem(DECK_VIEW_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const switchView = () => {
    const next = view === 'list' ? 'grid' : 'list'
    setView(next)
    try { localStorage.setItem(DECK_VIEW_KEY, next) } catch { /* this visit only */ }
  }
  // Cards from all of Magic for what's typed in the search, offered under the deck's own matches.
  const addResults = useAddSearch(filter)
  const combo = useComboPieces(deck)
  // The deck's combos, for the warning before a combo piece is marked as a cut candidate.
  const deckCombos = useDeckCombos(deck)
  // Swaps: a deck card choosing what replaces it, or a considered card choosing what it replaces.
  const [swapOut, setSwapOut] = useState<DeckCardEntry | null>(null)
  const [swapIn, setSwapIn] = useState<DeckCardEntry | null>(null)
  // A combo piece the user asked to mark as a cut candidate, waiting for a yes.
  const [comboWarningFor, setComboWarningFor] = useState<DeckCardEntry | null>(null)
  const [importing, setImporting] = useState(false)
  const [zoomId, setZoomId] = useState<string | null>(null)
  // A suggestion opened to read: it belongs to neither list, so it zooms on its own.
  const [zoomSuggestion, setZoomSuggestion] = useState<ScryfallCard | null>(null)
  const [cardSheet, setCardSheet] = useState<DeckCardEntry | null>(null)
  const [deckSheet, setDeckSheet] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [whoHas, setWhoHas] = useState(false)
  const [goldfish, setGoldfish] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // A commander (or partner) about to come out of the deck, waiting for a yes.
  const [removingCommander, setRemovingCommander] = useState<DeckCardEntry | null>(null)
  // Taking the last copy out removes the card, which is easy to do by accident on a small − button:
  // it's asked about first. The card being asked about, while the question is up.
  const [removingLast, setRemovingLast] = useState<DeckCardEntry | null>(null)
  // What the deck asks for that your binders and the decks you hold don't cover — for
  // "Who has it?", buying, and the Wishlist. Copies in another deck of yours count.
  const missing = useMemo(() => (deck ? missingCards(deck, collections, decks) : []), [deck, collections, decks])
  const [notice, setNotice] = useState<string | null>(null)
  // A card whose printing is being changed: another art, another set.
  const [changingPrinting, setChangingPrinting] = useState<DeckCardEntry | null>(null)
  // A deck built with proxies: how many are left, and which you already own a real copy of.
  const proxiesLeft = deck ? deckProxyCopies(deck) : 0
  const swaps = useMemo(
    () => (deck ? proxySwaps(collections, [deck]) : []),
    [collections, deck],
  )
  // Proxies you own a real copy of, but only in another deck: pointed out, never moved for you.
  const elsewhere = useMemo(
    () => (deck ? proxiesHeldElsewhere(collections, decks, deck) : []),
    [collections, decks, deck],
  )
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(t)
  }, [notice])
  const progress = useScrollProgress(200)

  useEffect(() => {
    if (deck) localStorage.setItem(LAST_DECK_KEY, deck.id)
  }, [deck?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop shows stats beside the cards, so its tabs have no Stats tab.
  const tabs: ('Cards' | 'Considering' | 'Stats' | 'Suggestions' | 'Details')[] =
    size === 'desktop' ? ['Cards', 'Considering', 'Suggestions', 'Details'] : ['Cards', 'Considering', 'Stats', 'Suggestions', 'Details']
  const tab = tabs.includes(tabName) ? tabName : 'Cards'

  if (!deck) {
    return (
      <>
        <TopBar title="Deck" onBack={back} />
        <div className="content-scroll">
          <div className="empty-state"><Icon name="style" />Deck not found. It may have been deleted.</div>
        </div>
      </>
    )
  }

  const colors = deckColors[deck.id] ?? []
  const usesCommander = GAME_MODES_USING_COMMANDER.has(deck.gameMode as GameMode)
  const commanderIds = new Set([deck.commander?.scryfallId, deck.partnerCommander?.scryfallId].filter(Boolean))
  const totalCards = deck.cards.reduce((s, c) => s + c.quantity, 0)
  const considering = deck.considering ?? []
  const zoomEntry = deck.cards.find((c) => c.scryfallId === zoomId) ?? considering.find((c) => c.scryfallId === zoomId) ?? null
  // A card that's only being thought about: the zoom offers to add it rather than counting copies.
  const zoomConsidered = !!zoomEntry && !deck.cards.some((c) => c.scryfallId === zoomEntry.scryfallId)
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
  const figures = deckFigures(deck, cardData)
  const q = filter.trim().toLowerCase()
  const matches = (c: DeckCardEntry) =>
    passesFilter(c, cardFilter, combo) &&
    (!q || matchesNameOrTag(c.name, [...tagsOf(roleTags, c.name), ...(c.userTags ?? [])], q) || (c.typeLine ?? '').toLowerCase().includes(q))
  const counts = filterCounts(deck.cards, combo)
  // Scryfall's matches the deck doesn't have yet, by name.
  const addable = addableCards(addResults, deck.cards.map((c) => c.name))
  // A search that found cards by their tag says which, since tags only show in the zoom.
  const tagHits = q ? [...new Set(deck.cards.filter((c) => matches(c) && !c.name.toLowerCase().includes(q)).flatMap((c) => matchedTags(tagsOf(roleTags, c.name), q)))] : []
  const shownCount = q ? deck.cards.filter(matches).length : 0

  const groups = TYPE_GROUPS.map((type) => {
    const cards = deck.cards
      .filter((c) => !commanderIds.has(c.scryfallId) && primaryTypeOf(c.typeLine) === type && matches(c))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { type, cards, count: cards.reduce((s, c) => s + c.quantity, 0) }
  }).filter((g) => g.cards.length > 0)
  const shownCommanders = commanders.filter(matches)
  // The cards as the list shows them, which the zoom swipes along.
  const listed = [...shownCommanders, ...groups.flatMap((g) => g.cards)]

  // The second commander this card could be next to the main one (decks/pairing.ts): a partner, a
  // Background, a Doctor… Null when the two can't lead together.
  function pairsAs(entry: DeckCardEntry): SecondCommanderKind | null {
    const main = deck!.commander
    if (!main || entry.scryfallId === main.scryfallId || !canPair(main, entry)) return null
    return secondCommanderKind(main) ?? 'PARTNER'
  }

  function cardActions(entry: DeckCardEntry): SheetAction[] {
    const isCommander = commanderIds.has(entry.scryfallId)
    const actions: SheetAction[] = [{ label: 'View card', icon: 'visibility', onClick: () => setZoomId(entry.scryfallId) }]
    // A cut candidate stays in the deck, flagged as the first thing to take out for something better.
    if (!isCommander) {
      actions.push(entry.replaceable
        ? { label: 'Not a cut candidate', icon: 'swap_horiz', onClick: () => setReplaceable(deck!.id, entry.scryfallId, false) }
        : { label: 'Mark as cut candidate', icon: 'swap_horiz', onClick: () => markCut(entry) })
      // Swapping and moving keep the card on Considering, so either can be taken back.
      if (considering.length > 0) {
        actions.push({ label: 'Swap with a considered card', icon: 'swap_horiz', onClick: () => setSwapOut(entry) })
      }
      actions.push({ label: 'Move to Considering', icon: 'drive_file_move', detail: 'Out of the deck, still on your list', onClick: () => toConsidering(entry) })
    }
    if (usesCommander && !isCommander && entryCanBeCommander(entry, deck!.gameMode)) {
      actions.push({ label: 'Set as commander', icon: 'star', tone: 'gold', detail: deck!.commander ? `Replaces ${deck!.commander.name}` : undefined, onClick: () => setCommander(deck!.id, entry) })
    }
    const pairKind = usesCommander && !isCommander ? pairsAs(entry) : null
    if (pairKind) {
      actions.push({ label: `Set as ${SECOND_COMMANDER_NOUN[pairKind]}`, icon: 'star_half', tone: 'gold', onClick: () => setPartnerCommander(deck!.id, entry) })
    }
    if (isCommander) {
      actions.push({
        label: 'Remove as commander',
        icon: 'star_outline',
        detail: 'Stays in the deck',
        onClick: () => (deck!.partnerCommander?.scryfallId === entry.scryfallId ? setPartnerCommander(deck!.id, null) : setCommander(deck!.id, null)),
      })
    }
    actions.push({ label: 'Change printing', icon: 'swap_horiz', detail: 'Another art or set — the copies stay', onClick: () => setChangingPrinting(entry) })
    actions.push({
      label: 'Remove from deck',
      icon: 'delete',
      tone: 'danger',
      onClick: () => (isCommander ? setRemovingCommander(entry) : removeCardFromDeck(deck!.id, entry.scryfallId)),
    })
    return actions
  }

  /** Flags a cut candidate — asking first when it's a piece of one of the deck's combos. */
  const markCut = (entry: DeckCardEntry) => {
    if (deckCombos && combosWithCard(deckCombos.included, entry.name).length > 0) setComboWarningFor(entry)
    else setReplaceable(deck.id, entry.scryfallId, true)
  }
  const toConsidering = (entry: DeckCardEntry) => {
    const undo = recordUndo(() => moveToConsidering(deck.id, entry.scryfallId))
    showUndo({ message: doneMessage('move', entry.name, deckPlace(deck.name, true)), undo })
  }
  const swap = (outgoing: DeckCardEntry, incoming: DeckCardEntry) => {
    const undo = recordUndo(() => swapConsidered(deck.id, outgoing.scryfallId, incoming.scryfallId))
    showUndo({ message: `Swapped in ${incoming.name} for ${outgoing.name}.`, undo })
  }
  const cutCount = deck.cards.filter((c) => c.replaceable).length

  /** One copy fewer; the last copy is asked about first (a commander, with the commander's question). */
  const fewer = (entry: DeckCardEntry) => {
    if (entry.quantity > 1) setCardQuantity(deck.id, entry.scryfallId, entry.quantity - 1)
    else if (commanderIds.has(entry.scryfallId)) setRemovingCommander(entry)
    else setRemovingLast(entry)
  }

  /** A card from anywhere on the page into the deck, or onto its Considering list — said on the Undo bar. */
  const addToDeck = (card: ScryfallCard, considering = false) =>
    addCardTo(card, { kind: 'deck', id: deck.id, name: deck.name, quantity: 1, considering })
  const addFromSearch = (card: ScryfallCard) => addToDeck(card)
  /** A card on Considering, into the deck after all. */
  const intoDeck = (entry: DeckCardEntry) => {
    const undo = recordUndo(() => considerIntoDeck(deck.id, entry.scryfallId))
    showUndo({ message: doneMessage('add', entry.name, deck.name), undo })
  }
  const notConsidering = (entry: DeckCardEntry) => {
    const undo = recordUndo(() => stopConsidering(deck.id, entry.scryfallId))
    showUndo({ message: `Stopped considering ${entry.name}`, undo })
  }

  // One box finds the deck's cards and, under them, cards to add; list or grid beside it.
  const cardSearch = (
    <div className="deck-search">
      <SearchPill value={filter} onChange={setFilter} placeholder="Find or add a card" />
      <IconButton icon={view === 'list' ? 'grid_view' : 'view_list'} label={view === 'list' ? 'Show as a grid' : 'Show as a list'} onClick={switchView} />
    </div>
  )

  const filterChips = (counts.cut > 0 || counts.combo > 0 || cardFilter !== 'ALL') && (
    <div className="chips" style={{ marginTop: 10 }}>
      {CARD_FILTERS.map((f) => (
        <PillChip
          key={f} label={CARD_FILTER_LABELS[f]} selected={cardFilter === f} onClick={() => setCardFilter(f)}
          count={f === 'CUT' ? counts.cut : f === 'COMBO' ? counts.combo : undefined}
        />
      ))}
    </div>
  )

  const searchNote = q && deck.cards.length > 0 && (
    <div className="dim search-note">
      {shownCount} {shownCount === 1 ? 'card' : 'cards'}
      {tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}
      {tagging && ' · finding tags…'}
    </div>
  )

  const cardViews = (entries: DeckCardEntry[], commander?: boolean) => view === 'grid' ? (
    <div className="card-grid">
      {entries.map((entry) => (
        <DeckCardTile
          key={entry.scryfallId} entry={entry} combo={combo} commander={commander}
          onZoom={() => setZoomId(entry.scryfallId)} onMore={() => setCardSheet(entry)}
        />
      ))}
    </div>
  ) : (
    <div className="list">
      {entries.map((entry) => (
        <DeckCardRow
          key={entry.scryfallId} entry={entry} combo={combo} commander={commander}
          onZoom={() => setZoomId(entry.scryfallId)} onMore={() => setCardSheet(entry)}
          onIncrement={commander ? undefined : () => setCardQuantity(deck.id, entry.scryfallId, entry.quantity + 1)}
          onDecrement={commander ? undefined : () => fewer(entry)}
        />
      ))}
    </div>
  )

  const cardList = (
    <>
      {filterChips}
      {searchNote}
      {deck.cards.length === 0 ? (
        <div className="empty-state"><Icon name="playing_cards" />No cards yet. Type a card's name above to add it.</div>
      ) : groups.length === 0 && shownCommanders.length === 0 ? (
        <div className="empty-state">{noMatchMessage(filter.trim(), cardFilter)}</div>
      ) : (
        <div className={size === 'phone' || view === 'grid' ? '' : 'card-groups'}>
          {shownCommanders.length > 0 && (
            <div>
              <div className="grp">{shownCommanders.length > 1 ? 'Commanders' : 'Commander'}<span>{shownCommanders.length}</span></div>
              {cardViews(shownCommanders, true)}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.type}>
              <div className="grp">{TYPE_PLURALS[g.type]}<span>{g.count}</span></div>
              {cardViews(g.cards)}
            </div>
          ))}
        </div>
      )}
      <AddToDeckSection cards={addable} onAdd={addFromSearch} onZoom={setZoomSuggestion} />
    </>
  )

  const consideringList = (
    <div style={{ marginTop: 12 }}>
      <div className="dim" style={{ marginBottom: 10 }}>
        Cards you think might work but haven't committed to. They don't count towards this deck's size, curve, price or legality — and a card here that you don't own shows up on your Wishlist.
      </div>
      {cutCount > 0 && considering.length > 0 && (
        <div className="dim" style={{ marginBottom: 10, color: 'var(--cut)' }}>
          {cutCount} cut {cutCount === 1 ? 'candidate' : 'candidates'} in the deck — Swap in trades one out for a card here.
        </div>
      )}
      {considering.length === 0 ? (
        <div className="empty-state">
          <Icon name="lightbulb" />
          Nothing here yet. Add cards from a card's page (Add to… → Considering), from the Suggestions tab, or move a card out of the deck from its ⋮ menu.
        </div>
      ) : (
        <div className="list">
          {considering.map((entry) => (
            <div key={entry.scryfallId} className="crow no-qty" style={{ gridTemplateColumns: '56px minmax(0, 1fr) auto auto auto' }}>
              <button type="button" className="thumb-wrap" onClick={() => setZoomId(entry.scryfallId)} aria-label={`Look at ${entry.name}`}>
                <ArtImage className="thumb" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
              </button>
              <button type="button" className="cmain" style={{ textAlign: 'left' }} onClick={() => setZoomId(entry.scryfallId)}>
                <div className="cname">{entry.name}</div>
                <div className="cmeta">
                  {entry.typeLine && <span>{entry.typeLine}</span>}
                  {cardData?.get(entry.scryfallId)?.prices?.usd && <span>{money.format(Number(cardData.get(entry.scryfallId)!.prices!.usd))}</span>}
                </div>
              </button>
              <button
                type="button" className="btn gold sm"
                onClick={() => intoDeck(entry)}
              >
                {size === 'phone' ? 'Add' : 'Add to deck'}
              </button>
              <button
                type="button" className="btn line sm" disabled={deck.cards.length === 0}
                onClick={() => setSwapIn(entry)}
                style={{ color: deck.cards.length > 0 ? 'var(--cut)' : undefined }}
              >
                Swap in
              </button>
              <IconButton
                icon="close" label={`Stop considering ${entry.name}`}
                onClick={() => notConsidering(entry)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  /** A suggestion the user likes goes into Considering, not into the deck. */
  const consider = (card: ScryfallCard) => addToDeck(card, true)
  const suggestions = (
    <>
      <DeckSwaps deck={deck} cardsById={cardData} roleTags={roleTags} onExpand={setZoomSuggestion} onMarkCut={markCut} />
      <div className="p-h" style={{ marginTop: 18 }}><h3>EDHREC suggestions</h3></div>
      <DeckSuggestions deck={deck} onExpand={setZoomSuggestion} onConsider={consider} />
    </>
  )
  const details = <DeckDetails deck={deck} onDelete={() => setConfirmDelete(true)} />

  return (
    <>
      <TopBar
        title={deck.name}
        onBack={back}
        progress={progress}
        actions={
          <IconButton icon="more_horiz" label="Deck actions" variant={progress < 0.6 ? 'glass' : ''} onClick={() => setDeckSheet(true)} />
        }
      />

      <div className="hero" style={{ ['--p' as string]: progress }}>
        <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors} />
        <div className="hero-fade" />
        <div className="hero-body rise" style={rise(0)}>
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
            <div className="h-cmd">
              {colors.length > 0 && <ManaPips colors={colors} />}
              <span>{commanders.length > 0 ? commanders.map((c) => c.name).join(' & ') : GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode}</span>
            </div>
            <h1 className="deckname">{deck.name}</h1>
            <div className="h-stats">
              <span><b>{totalCards}</b>cards</span>
              {usesCommander && commanders.length > 0 && <span>{GAME_MODE_LABELS[deck.gameMode as GameMode]}</span>}
              <span className="bchip">{DECK_OWNERSHIP_LABELS[deck.ownership]}</span>
              {size === 'tablet' && figures && figures.value > 0 && <span><b>{money.format(figures.value, true)}</b>value</span>}
            </div>
          </div>
          {size === 'desktop' && (
            <div className="hero-figures">
              <div className="stat">
                <span className="lbl">Deck value</span>
                <span className="num">{figures ? <CountUp value={figures.value} format={(v) => money.format(v, true)} /> : '—'}</span>
              </div>
              <div className="stat">
                <span className="lbl">Avg. mana value</span>
                <span className="num">{figures ? <CountUp value={figures.avgMv} format={(v) => v.toFixed(2)} /> : '—'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="content-scroll">
        {size === 'desktop' ? (
          <div className="deck-columns">
            <div style={{ minWidth: 0 }}>
              <div className="deck-toolbar" style={{ position: 'sticky', top: 64, zIndex: 15, background: 'var(--g0)', padding: '10px 0 8px' }}>
                <SegmentedTabs
                  labels={tabs} selected={tabs.indexOf(tab)} onSelect={(i) => setTabName(tabs[i])}
                  counts={{ [tabs.indexOf('Considering')]: considering.length }}
                />
                {tab === 'Cards' && cardSearch}
              </div>
              {tab === 'Cards' ? cardList : tab === 'Considering' ? consideringList : tab === 'Suggestions' ? suggestions : details}
            </div>
            <aside className="deck-aside">
              <MatchRecordPanel deck={deck} />
              <DeckStats deck={deck} cardsById={cardData} roleTags={roleTags} tagging={!!tagging} onTag={(label) => { setTabName('Cards'); setFilter(label) }} />
              <TokensPanel deck={deck} cardsById={cardData} />
            </aside>
          </div>
        ) : (
          <>
            <div className={size === 'tablet' ? 'sticky-tabs deck-toolbar' : 'sticky-tabs'}>
              <SegmentedTabs
                labels={tabs} selected={tabs.indexOf(tab)} onSelect={(i) => setTabName(tabs[i])}
                counts={{ [tabs.indexOf('Considering')]: considering.length }}
              />
              {size === 'tablet' && tab === 'Cards' && cardSearch}
            </div>
            {tab === 'Cards' && (
              <>
                {size === 'phone' && <div style={{ marginTop: 12 }}>{cardSearch}</div>}
                {cardList}
              </>
            )}
            {tab === 'Considering' && consideringList}
            {tab === 'Stats' && (
              <div style={{ marginTop: 12 }}>
                <MatchRecordPanel deck={deck} />
                <DeckStats deck={deck} cardsById={cardData} roleTags={roleTags} tagging={!!tagging} onTag={(label) => { setTabName('Cards'); setFilter(label) }} />
                <TokensPanel deck={deck} cardsById={cardData} />
              </div>
            )}
            {tab === 'Suggestions' && <div style={{ marginTop: 12 }}>{suggestions}</div>}
            {tab === 'Details' && details}
          </>
        )}
      </div>

      {cardSheet && (
        <ActionSheet
          title={cardSheet.name}
          subtitle={[cardSheet.typeLine, commanderIds.has(cardSheet.scryfallId) ? 'Commander' : `${cardSheet.quantity} in deck`].filter(Boolean).join(' · ')}
          imageUrl={cardSheet.imageUrl}
          actions={cardActions(cardSheet)}
          onClose={() => setCardSheet(null)}
        />
      )}

      {(proxiesLeft > 0 || (deck.ownership === 'PROXY' && swaps.length === 0)) && (
        <div className="panel rise" style={{ ...rise(1), marginBottom: 12 }}>
          <div className="p-h">
            <h3>Proxies</h3>
            <span className="p-sub">Left<b>{proxiesLeft}</b></span>
          </div>
          {proxiesLeft === 0 ? (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <span className="dim" style={{ flex: 1, minWidth: 180 }}>Every card in here is the real thing now.</span>
              <button type="button" className="btn gold sm" onClick={() => { setDeckOwnership(deck.id, 'PHYSICAL'); setNotice('Marked as a physical deck.') }}>
                Mark it Physical
              </button>
            </div>
          ) : swaps.length === 0 ? (
            <div className="dim">None of these are sitting spare in your binders yet — the Wishlist is where to note the ones to buy.</div>
          ) : (
            <>
              <div className="dim" style={{ marginBottom: 8 }}>
                You already own {swaps.length === 1 ? 'one of these' : `${swaps.length} of these`} for real. Swapping one in takes the copy out of your binder and stops counting it as a proxy.
              </div>
              <div className="list">
                {swaps.map((s) => (
                  <div key={s.entry.scryfallId} className="crow no-qty" style={{ gridTemplateColumns: '56px minmax(0, 1fr) auto' }}>
                    <div className="thumb-wrap">
                      <ArtImage className="thumb" src={toArtCrop(s.entry.imageUrl)} seed={s.entry.name} />
                    </div>
                    <div className="cmain">
                      <div className="cname">{s.entry.name}</div>
                      <div className="cmeta"><span>{s.spare} spare in your binders</span></div>
                    </div>
                    <button type="button" className="btn gold sm" onClick={() => { swapInProxy(deck.id, s.entry.scryfallId); setNotice(`Swapped in ${s.entry.name}.`) }}>
                      Swap in
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {proxiesLeft > 0 && elsewhere.length > 0 && (
            <>
              <div className="dim" style={{ margin: '12px 0 8px' }}>
                In your other decks. Nothing here moves on its own — taking one out leaves that deck a card short, so it's your call which deck gets it.
              </div>
              <div className="list">
                {elsewhere.map((h) => (
                  <div key={h.entry.scryfallId} className="crow no-qty" style={{ gridTemplateColumns: '56px minmax(0, 1fr)' }}>
                    <div className="thumb-wrap">
                      <ArtImage className="thumb" src={toArtCrop(h.entry.imageUrl)} seed={h.entry.name} />
                    </div>
                    <div className="cmain">
                      <div className="cname">{h.entry.name}</div>
                      <div className="cmeta">
                        <span>Real copy in{' '}
                          {h.decks.map((d, i) => (
                            <span key={d.deck.id}>
                              {i > 0 && ', '}
                              <button type="button" className="link" style={{ padding: 0, fontSize: 'inherit' }} onClick={() => navigate(`/decks/${d.deck.id}`)}>{d.deck.name}</button>
                              {d.copies > 1 && ` (${d.copies})`}
                            </span>
                          ))}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {changingPrinting && (
        <PrintingPicker
          name={changingPrinting.name}
          currentId={changingPrinting.scryfallId}
          prompt="Pick the printing this card should be — its copies stay as they are."
          onPick={(card) => {
            changeDeckPrinting(deck.id, changingPrinting.scryfallId, card)
            setNotice(`${card.name} is now ${printingName(card)}.`)
            setChangingPrinting(null)
          }}
          onClose={() => setChangingPrinting(null)}
        />
      )}

      {notice && (
        <div className="notice" style={{ margin: '0 0 12px' }}>
          <Icon name="check_circle" style={{ color: 'var(--ok)', fontSize: 18, marginRight: 6 }} />{notice}
        </div>
      )}

      {deckSheet && (
        <ActionSheet
          title={deck.name}
          subtitle={`${totalCards} cards · ${DECK_OWNERSHIP_LABELS[deck.ownership]}`}
          imageUrl={deck.commander?.imageUrl ?? null}
          actions={[
            { label: 'Share with friends', icon: 'group', detail: 'View only — friends, pods or a link', onClick: () => setSharing(true) },
            { label: 'Goldfish (playtest)', icon: 'playing_cards', detail: 'Draw an opening hand, then a card at a time', onClick: () => setGoldfish(true) },
            { label: 'Who has it?', icon: 'person_search', detail: "Friends who own the cards you're missing", onClick: () => setWhoHas(true) },
            ...(missing.length > 0
              ? [{
                  label: 'Buy missing cards',
                  icon: 'shopping_cart',
                  detail: `${missing.length} ${missing.length === 1 ? 'card' : 'cards'} at TCGplayer`,
                  onClick: () => {
                    const url = buyListUrl(missing.map((c) => ({ name: c.name, quantity: c.quantity })))
                    if (url) window.open(url, '_blank', 'noopener,noreferrer')
                    setDeckSheet(false)
                  },
                }, {
                  label: 'Add missing to Wishlist',
                  icon: 'star',
                  tone: 'gold' as const,
                  detail: `${missing.length} ${missing.length === 1 ? 'card' : 'cards'} you don't own`,
                  onClick: () => {
                    addToWishlist(missing.map((c) => ({
                      scryfallId: c.scryfallId, name: c.name, imageUrl: c.imageUrl, backImageUrl: c.backImageUrl, tags: c.tags, quantity: c.quantity,
                    })))
                    setDeckSheet(false)
                    setNotice(`Added ${missing.length} ${missing.length === 1 ? 'card' : 'cards'} to your Wishlist.`)
                  },
                }]
              : []),
            { label: 'Import list', icon: 'upload_file', detail: 'Paste a decklist or choose a file', onClick: () => setImporting(true) },
            { label: 'Export list', icon: 'ios_share', detail: 'Copy it for Moxfield, Archidekt or Arena', onClick: () => setShowExport(true) },
            { label: 'Deck details', icon: 'tune', detail: 'Format, ownership, commander and tags', onClick: () => setTabName('Details') },
            { label: 'Delete deck', icon: 'delete', tone: 'danger', onClick: () => setConfirmDelete(true) },
          ]}
          onClose={() => setDeckSheet(false)}
        />
      )}

      {confirmDelete && (() => {
        // A physical deck holds real cards: they can go back to the Unsorted pile rather than out of
        // the collection with the deck. Proxies, and decks that hold no real cards, have nothing to keep.
        const real = realCopiesOf(deck).reduce((n, e) => n + e.quantity, 0)
        const remove = (keepCards: boolean) => { deleteDeck(deck.id, keepCards); navigate('/decks', { replace: true }) }
        return (
          <Dialog
            title="Delete deck?"
            onDismiss={() => setConfirmDelete(false)}
            actions={real > 0
              ? (
                <>
                  <button type="button" className="btn line" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button type="button" className="btn danger" onClick={() => remove(false)}>Delete deck and cards</button>
                  <button type="button" className="btn gold" onClick={() => remove(true)}>Delete deck, keep cards</button>
                </>
              )
              : (
                <>
                  <button type="button" className="btn line" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button type="button" className="btn danger" onClick={() => remove(false)}>Delete deck</button>
                </>
              )}
          >
            {real > 0 && (
              <p style={{ margin: '0 0 8px' }}>
                “{deck.name}” holds {real} of your cards. <b>Delete deck, keep cards</b> puts them in Unsorted; <b>Delete deck and cards</b> takes them out of your collection with the deck.
              </p>
            )}
            <p className="muted" style={{ margin: 0 }}>{real > 0 ? 'The deck' : `“${deck.name}”`} will be removed here and, if you're signed in, from your other devices too.</p>
          </Dialog>
        )
      })()}

      {removingCommander && (() => {
        const partner = deck.partnerCommander?.scryfallId === removingCommander.scryfallId
        return (
          <Dialog
            title={`Remove ${removingCommander.name}?`}
            onDismiss={() => setRemovingCommander(null)}
            actions={
              <>
                <button type="button" className="btn line" onClick={() => setRemovingCommander(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => { removeCardFromDeck(deck.id, removingCommander.scryfallId); setRemovingCommander(null) }}>Remove from deck</button>
              </>
            }
          >
            <p className="muted" style={{ margin: 0 }}>
              It's this deck's {partner ? 'partner commander' : 'commander'}, so the deck will be left without one. To keep the card but choose another commander, use “Remove as commander” instead.
            </p>
          </Dialog>
        )
      })()}

      {removingLast && (
        <Dialog
          title={`Remove ${removingLast.name}?`}
          onDismiss={() => setRemovingLast(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setRemovingLast(null)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { setCardQuantity(deck.id, removingLast.scryfallId, 0); setRemovingLast(null) }}>Remove</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>That was the last copy in this deck. Removing it takes the card out of the deck.</p>
        </Dialog>
      )}

      {swapOut && (considering.length === 0 ? (
        <SwapPickerDialog
          title="Nothing to swap in yet"
          message="Add cards to this deck's Considering list first — from a card's page, the Suggestions tab, or budget swaps."
          options={[]} onPick={() => {}} onDismiss={() => setSwapOut(null)}
        />
      ) : (
        <SwapPickerDialog
          title={`Replace ${swapOut.name} with…`}
          message={`${swapOut.name} moves to Considering, so you can swap it back later.`}
          options={considering}
          onPick={(incoming) => { swap(swapOut, incoming); setSwapOut(null) }}
          onDismiss={() => setSwapOut(null)}
        />
      ))}
      {swapIn && (
        <SwapPickerDialog
          title={`Swap ${swapIn.name} in for…`}
          message="The card you pick moves to Considering. Cut candidates are listed first."
          options={deck.cards.filter((c) => !commanderIds.has(c.scryfallId))}
          onPick={(outgoing) => { swap(outgoing, swapIn); setSwapIn(null) }}
          onDismiss={() => setSwapIn(null)}
        />
      )}
      {comboWarningFor && (
        <ComboPieceWarningDialog
          name={comboWarningFor.name}
          combos={combosWithCard(deckCombos?.included ?? [], comboWarningFor.name)}
          onConfirm={() => { setReplaceable(deck.id, comboWarningFor.scryfallId, true); setComboWarningFor(null) }}
          onDismiss={() => setComboWarningFor(null)}
        />
      )}
      {importing && (
        <DeckImportDialog
          onImport={(cards, side) => {
            const undo = recordUndo(() => importIntoDeck(deck.id, cards, side))
            const copies = cards.reduce((n, c) => n + c.quantity, 0)
            showUndo({ message: `Imported ${copies} ${copies === 1 ? 'card' : 'cards'} into ${deck.name}`, undo })
          }}
          onDismiss={() => setImporting(false)}
        />
      )}
      {showExport && <ExportDeckDialog deck={deck} onDismiss={() => setShowExport(false)} />}
      {sharing && <ShareDialog kind="deck" itemId={deck.id} name={deck.name} onClose={() => setSharing(false)} />}
      {whoHas && <WhoHasItSheet deck={deck} onClose={() => setWhoHas(false)} />}
      {goldfish && <GoldfishDialog deck={deck} onClose={() => setGoldfish(false)} />}

      {zoomSuggestion && (
        <CardZoomModal
          imageUrl={displayImageUrl(zoomSuggestion)}
          name={zoomSuggestion.name}
          typeLine={zoomSuggestion.type_line}
          priceUsd={zoomSuggestion.prices?.usd}
          priceUsdFoil={zoomSuggestion.prices?.usd_foil}
          scryfallId={zoomSuggestion.id}
          currentDeckId={deck.id}
          backImageUrl={backImageUrl(zoomSuggestion)}
          tags={cardTags(zoomSuggestion)}
          oracleText={displayOracleText(zoomSuggestion)}
          manaCost={displayManaCost(zoomSuggestion)}
          buyUrl={buyCardUrl(zoomSuggestion)}
          onSelectSimilar={setZoomSuggestion}
          similarActionLabel="Tap a card to read it"
          onClose={() => setZoomSuggestion(null)}
        >
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button" className="btn line block"
              onClick={() => { addToDeck(zoomSuggestion); setZoomSuggestion(null) }}
            >
              <Icon name="playing_cards" />Add to deck
            </button>
            <button
              type="button" className="btn gold block"
              onClick={() => { consider(zoomSuggestion); setZoomSuggestion(null) }}
            >
              <Icon name="add" />Consider it
            </button>
          </div>
        </CardZoomModal>
      )}

      {zoomEntry && (
        <CardZoomModal
          imageUrl={zoomEntry.imageUrl}
          name={zoomEntry.name}
          typeLine={zoomEntry.typeLine}
          buyUrl={buyCardUrl(cardData?.get(zoomEntry.scryfallId), zoomEntry.name)}
          priceUsd={cardData?.get(zoomEntry.scryfallId)?.prices?.usd}
          priceUsdFoil={cardData?.get(zoomEntry.scryfallId)?.prices?.usd_foil}
          oracleText={cardData?.get(zoomEntry.scryfallId)?.oracle_text}
          manaCost={cardData?.get(zoomEntry.scryfallId)?.mana_cost}
          scryfallId={zoomEntry.scryfallId}
          currentDeckId={deck.id}
          backImageUrl={zoomEntry.backImageUrl}
          tags={tagsOf(roleTags, zoomEntry.name).map(tagLabel)}
          tagsLoading={!!tagging && !roleTags.has(zoomEntry.name.trim().toLowerCase())}
          userTags={userTagsOf(decks, collections, zoomEntry.scryfallId)}
          knownUserTags={knownTags}
          onUserTags={(next) => setCardTags(zoomEntry.scryfallId, next)}
          onTagClick={(label) => { setZoomId(null); setTabName('Cards'); setFilter(label) }}
          onSelectSimilar={(similar) => addToDeck(similar)}
          similarActionLabel="Tap a card to add it to this deck"
          onClose={() => setZoomId(null)}
          {...zoomSteps(zoomConsidered ? considering : listed, zoomEntry, (card) => setZoomId(card.scryfallId))}
        >
          {zoomConsidered && (
            <div className="row-between panel" style={{ padding: '14px 16px' }}>
              <div>
                <div className="p-h" style={{ margin: 0 }}><h3>Considering</h3></div>
                <div className="dim">Not in the deck yet.</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button" className="btn line sm"
                  onClick={() => { notConsidering(zoomEntry); setZoomId(null) }}
                >
                  Not this one
                </button>
                <button
                  type="button" className="btn gold sm"
                  onClick={() => { intoDeck(zoomEntry); setZoomId(null) }}
                >
                  Add to deck
                </button>
              </div>
            </div>
          )}
          {!zoomConsidered && !commanderIds.has(zoomEntry.scryfallId) && (
            <div className="row-between panel" style={{ padding: '14px 16px' }}>
              <div>
                <div className="p-h" style={{ margin: 0 }}><h3>In this deck</h3></div>
                <div className="dim">{GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode}</div>
              </div>
              <div className="stepper-big">
                <button type="button" onClick={() => fewer(zoomEntry)} aria-label="One fewer">−</button>
                <span className="qn">{zoomEntry.quantity}</span>
                <button type="button" onClick={() => setCardQuantity(deck.id, zoomEntry.scryfallId, zoomEntry.quantity + 1)} aria-label="One more">+</button>
              </div>
            </div>
          )}
        </CardZoomModal>
      )}
    </>
  )
}

function DeckDetails({ deck, onDelete }: { deck: Deck; onDelete: () => void }) {
  const { setGameMode, setDeckOwnership, setDeckTags, setCommander, setPartnerCommander } = useSync()
  const [tagInput, setTagInput] = useState('')
  // A physical deck becoming one that holds no real cards: asked what happens to the cards it has.
  const [leaving, setLeaving] = useState<DeckOwnership | null>(null)
  const realCards = realCopiesOf(deck).reduce((n, e) => n + e.quantity, 0)
  const chooseOwnership = (o: DeckOwnership) => {
    if (o === deck.ownership) return
    if (deck.ownership === 'PHYSICAL' && o !== 'PHYSICAL' && realCards > 0) setLeaving(o)
    else setDeckOwnership(deck.id, o)
  }
  const usesCommander = GAME_MODES_USING_COMMANDER.has(deck.gameMode as GameMode)
  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !deck.tags.includes(tag)) setDeckTags(deck.id, [...deck.tags, tag])
    setTagInput('')
  }

  return (
    <div className="detail-grid" style={{ marginTop: 12 }}>
      <div className="panel rise" style={rise(0)}>
        <div className="p-h"><h3>Format</h3></div>
        <div className="chips wrap">
          {GAME_MODES.map((m) => (
            <PillChip key={m} label={GAME_MODE_LABELS[m]} selected={deck.gameMode === m} onClick={() => setGameMode(deck.id, m)} className="on-g2" />
          ))}
        </div>
      </div>

      <div className="panel rise" style={rise(1)}>
        <div className="p-h"><h3>Ownership</h3></div>
        <div className="chips wrap">
          {DECK_OWNERSHIP_OPTIONS.map((o) => (
            <PillChip key={o} label={DECK_OWNERSHIP_LABELS[o]} selected={deck.ownership === o} onClick={() => chooseOwnership(o)} className="on-g2" />
          ))}
        </div>
        <div className="dim" style={{ marginTop: 10 }}>{DECK_OWNERSHIP_DESCRIPTIONS[deck.ownership]}</div>
        {leaving && (
          <Dialog
            title={`Make it ${DECK_OWNERSHIP_LABELS[leaving].toLowerCase()}?`}
            onDismiss={() => setLeaving(null)}
            actions={
              <>
                <button type="button" className="btn line" onClick={() => setLeaving(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => { setDeckOwnership(deck.id, leaving, false); setLeaving(null) }}>Remove the cards</button>
                <button type="button" className="btn gold" onClick={() => { setDeckOwnership(deck.id, leaving, true); setLeaving(null) }}>Keep cards</button>
              </>
            }
          >
            <p style={{ margin: 0 }}>
              “{deck.name}” holds {realCards} of your cards, and a {DECK_OWNERSHIP_LABELS[leaving].toLowerCase()} deck doesn't count its cards as yours. <b>Keep cards</b> puts them in Unsorted; <b>Remove the cards</b> takes them out of your collection.
            </p>
          </Dialog>
        )}
      </div>

      {usesCommander && (
        <div className="panel rise" style={rise(2)}>
          <div className="p-h"><h3>Commander</h3></div>
          {deck.commander ? (
            <div className="chips wrap">
              <PillChip label={deck.commander.name} icon="star" className="on-g2" onClick={() => setCommander(deck.id, null)} />
              {deck.partnerCommander && (
                <PillChip label={deck.partnerCommander.name} icon="star_half" className="on-g2" onClick={() => setPartnerCommander(deck.id, null)} />
              )}
            </div>
          ) : (
            <div className="dim">None yet. Open a card's ⋮ menu in the Cards tab and choose “Set as commander”.</div>
          )}
          {deck.commander && <div className="dim" style={{ marginTop: 10 }}>Tap a commander to unset it. It stays in the deck.</div>}
        </div>
      )}

      <div className="panel rise" style={rise(3)}>
        <div className="p-h"><h3>Tags</h3></div>
        {deck.tags.length > 0 && (
          <div className="chips wrap" style={{ marginBottom: 12 }}>
            {deck.tags.map((tag) => (
              <PillChip key={tag} label={tag} icon="close" className="on-g2" onClick={() => setDeckTags(deck.id, deck.tags.filter((t) => t !== tag))} />
            ))}
          </div>
        )}
        <div className="row">
          <input
            className="input"
            placeholder="Add a tag, e.g. Tokens"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
          />
          <button type="button" className="btn" onClick={addTag} disabled={!tagInput.trim()}>Add</button>
        </div>
      </div>

      <div className="row rise" style={{ ...rise(4), marginTop: 4 }}>
        <button type="button" className="btn danger" style={{ flex: 1 }} onClick={onDelete}><Icon name="delete" />Delete deck</button>
      </div>
    </div>
  )
}
