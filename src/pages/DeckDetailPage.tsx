import { useEffect, useMemo, useState } from 'react'
import { PrintingPicker, printingName } from '../components/PrintingPicker'
import { useMoney } from '../money/currency'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal, zoomSteps } from '../components/CardZoomModal'
import { ActionSheet } from '../components/ActionSheet'
import type { SheetAction } from '../components/ActionSheet'
import { useLongPress } from '../components/useLongPress'
import { CardSearchResults } from '../components/CardSearchResults'
import { ExportDeckDialog } from '../components/ExportDeckDialog'
import { ShareDialog } from '../social/ShareDialog'
import { WhoHasItSheet } from '../social/WhoHasIt'
import { missingCards } from '../decks/missing'
import { buyCardUrl, buyListUrl } from '../api/buy'
import { deckProxyCopies, proxiesHeldElsewhere, proxySwaps } from '../decks/proxies'
import { realCopiesOf } from '../collection/unsorted'
import { matchedTags, matchesNameOrTag, tagLabel, tagsOf, useRoleTags } from '../tags/roleTags'
import { useAddWarning } from '../components/useAddWarning'
import { DeckSuggestions } from '../components/DeckSuggestions'
import { DeckStats, deckFigures, useDeckCardData } from '../components/DeckStats'
import { MatchRecordPanel } from '../components/MatchRecordPanel'
import { GoldfishDialog } from '../components/GoldfishDialog'
import { Dialog } from '../components/Dialog'
import {
  ArtImage, CountUp, IconButton, ManaPips, PillChip, SearchPill, SectionHeader, SegmentedTabs, TYPE_GROUPS, TYPE_PLURALS,
  primaryTypeOf, rise, toArtCrop, useBack, useLayoutSize, useScrollProgress,
} from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { LAST_DECK_KEY } from '../components/Layout'
import {
  GAME_MODES, GAME_MODES_USING_COMMANDER, GAME_MODE_LABELS,
  DECK_OWNERSHIP_OPTIONS, DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_DESCRIPTIONS,
} from '../types/models'
import type { Deck, DeckCardEntry, DeckOwnership, GameMode } from '../types/models'

export function DeckDetailPage() {
  const money = useMoney()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/decks')
  const size = useLayoutSize()
  const {
    decks, collections, setCardQuantity, removeCardFromDeck, addCardToDeck, setCommander, setPartnerCommander, deleteDeck, addToWishlist,
    setDeckOwnership, swapInProxy, changeDeckPrinting,
  } = useSync()
  const deck = decks.find((d) => d.id === id)
  const deckColors = useDeckColors(deck ? [deck] : [])
  const cardData = useDeckCardData(deck)
  // What each card does (mana ramp, removal…): searched with the name, shown in the zoom and Stats.
  const { tags: roleTags, loading: tagging } = useRoleTags(deck ? [...deck.cards, ...(deck.considering ?? [])].map((c) => c.name) : [])
  const [tabName, setTabName] = useState<'Cards' | 'Stats' | 'Suggestions' | 'Details'>('Cards')
  const [filter, setFilter] = useState('')
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [cardSheet, setCardSheet] = useState<DeckCardEntry | null>(null)
  const [deckSheet, setDeckSheet] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [whoHas, setWhoHas] = useState(false)
  const [goldfish, setGoldfish] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addWarning, setAddWarning] = useAddWarning()
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
  const tabs: ('Cards' | 'Stats' | 'Suggestions' | 'Details')[] =
    size === 'desktop' ? ['Cards', 'Suggestions', 'Details'] : ['Cards', 'Stats', 'Suggestions', 'Details']
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
  const zoomEntry = deck.cards.find((c) => c.scryfallId === zoomId) ?? null
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is DeckCardEntry => !!c)
  const figures = deckFigures(deck, cardData)
  const q = filter.trim().toLowerCase()
  const matches = (c: DeckCardEntry) =>
    !q || matchesNameOrTag(c.name, tagsOf(roleTags, c.name), q) || (c.typeLine ?? '').toLowerCase().includes(q)
  // A search that found cards by their tag says which, since tags only show in the zoom.
  const tagHits = q ? [...new Set(deck.cards.filter((c) => !c.name.toLowerCase().includes(q)).flatMap((c) => matchedTags(tagsOf(roleTags, c.name), q)))] : []
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

  function canPartner(entry: DeckCardEntry): boolean {
    const main = deck!.commander
    if (!main || !entry.partnerAbility || !main.partnerAbility || entry.scryfallId === main.scryfallId) return false
    if (entry.partnerAbility === 'Partner' && main.partnerAbility === 'Partner') return true
    return entry.partnerAbility.toLowerCase() === main.name.toLowerCase() || main.partnerAbility.toLowerCase() === entry.name.toLowerCase()
  }

  function cardActions(entry: DeckCardEntry): SheetAction[] {
    const isCommander = commanderIds.has(entry.scryfallId)
    const actions: SheetAction[] = [{ label: 'View card', icon: 'visibility', onClick: () => setZoomId(entry.scryfallId) }]
    if (usesCommander && !isCommander && entry.canBeCommander) {
      actions.push({ label: 'Set as commander', icon: 'star', tone: 'gold', detail: deck!.commander ? `Replaces ${deck!.commander.name}` : undefined, onClick: () => setCommander(deck!.id, entry) })
    }
    if (usesCommander && !isCommander && canPartner(entry)) {
      actions.push({ label: 'Set as partner commander', icon: 'star_half', tone: 'gold', onClick: () => setPartnerCommander(deck!.id, entry) })
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
    actions.push({ label: 'Remove from deck', icon: 'delete', tone: 'danger', onClick: () => removeCardFromDeck(deck!.id, entry.scryfallId) })
    return actions
  }

  const searchNote = q && deck.cards.length > 0 && (
    <div className="dim search-note">
      {shownCount} {shownCount === 1 ? 'card' : 'cards'}
      {tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}
      {tagging && ' · finding tags…'}
    </div>
  )

  const cardList = deck.cards.length === 0 ? (
    <div className="empty-state"><Icon name="playing_cards" />No cards yet — search {size === 'desktop' ? 'on the right' : 'below'} to add some.</div>
  ) : groups.length === 0 && shownCommanders.length === 0 ? (
    <div className="empty-state">No cards in this deck match “{filter}”.</div>
  ) : (
    <div className={size === 'phone' ? '' : 'card-groups'}>
      {shownCommanders.length > 0 && (
        <div>
          <div className="grp">{shownCommanders.length > 1 ? 'Commanders' : 'Commander'}<span>{shownCommanders.length}</span></div>
          <div className="list">
            {shownCommanders.map((entry) => (
              <CardRow key={entry.scryfallId} entry={entry} commander onZoom={() => setZoomId(entry.scryfallId)} onMore={() => setCardSheet(entry)} />
            ))}
          </div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.type}>
          <div className="grp">{TYPE_PLURALS[g.type]}<span>{g.count}</span></div>
          <div className="list">
            {g.cards.map((entry) => (
              <CardRow
                key={entry.scryfallId}
                entry={entry}
                onZoom={() => setZoomId(entry.scryfallId)}
                onMore={() => setCardSheet(entry)}
                onIncrement={() => setCardQuantity(deck.id, entry.scryfallId, entry.quantity + 1)}
                onDecrement={() => setCardQuantity(deck.id, entry.scryfallId, entry.quantity - 1)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const addCards = (
    <>
      {addWarning && <div className="add-warning">{addWarning}</div>}
      <CardSearchResults onAdd={(card) => setAddWarning(addCardToDeck(deck.id, card))} placeholder="Search Scryfall to add cards" />
    </>
  )

  const suggestions = <DeckSuggestions deck={deck} onAdd={(card) => setAddWarning(addCardToDeck(deck.id, card))} />
  const details = <DeckDetails deck={deck} onExport={() => setShowExport(true)} onDelete={() => setConfirmDelete(true)} />

  return (
    <>
      <TopBar
        title={deck.name}
        onBack={back}
        progress={progress}
        actions={
          <>
            {size === 'desktop' && (
              <button type="button" className={`btn ${progress < 0.6 ? 'line' : ''}`} style={progress < 0.6 ? { background: 'rgba(12,13,17,.5)' } : undefined} onClick={() => setShowExport(true)}>
                <Icon name="ios_share" />Export
              </button>
            )}
            <IconButton icon="more_horiz" label="Deck actions" variant={progress < 0.6 ? 'glass' : ''} onClick={() => setDeckSheet(true)} />
          </>
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
                <SegmentedTabs labels={tabs} selected={tabs.indexOf(tab)} onSelect={(i) => setTabName(tabs[i])} />
                {tab === 'Cards' && <SearchPill value={filter} onChange={setFilter} placeholder="Name or tag, e.g. ramp" />}
              </div>
              {tab === 'Cards' && searchNote}
              {tab === 'Cards' ? cardList : tab === 'Suggestions' ? suggestions : details}
            </div>
            <aside className="deck-aside">
              <MatchRecordPanel deck={deck} />
              <DeckStats deck={deck} cardsById={cardData} roleTags={roleTags} tagging={!!tagging} onTag={(label) => { setTabName('Cards'); setFilter(label) }} />
              <div className="panel">
                <div className="p-h"><h3>Add cards</h3></div>
                {addCards}
              </div>
            </aside>
          </div>
        ) : (
          <>
            <div className={size === 'tablet' ? 'sticky-tabs deck-toolbar' : 'sticky-tabs'}>
              <SegmentedTabs labels={tabs} selected={tabs.indexOf(tab)} onSelect={(i) => setTabName(tabs[i])} />
              {size === 'tablet' && tab === 'Cards' && <SearchPill value={filter} onChange={setFilter} placeholder="Name or tag, e.g. ramp" />}
            </div>
            {tab === 'Cards' && (
              <>
                {size === 'phone' && deck.cards.length > 0 && (
                  <div style={{ marginTop: 12 }}><SearchPill value={filter} onChange={setFilter} placeholder="Name or tag, e.g. ramp" /></div>
                )}
                {searchNote}
                {cardList}
                <SectionHeader title="Add cards" />
                {addCards}
              </>
            )}
            {tab === 'Stats' && <div style={{ marginTop: 12 }}><MatchRecordPanel deck={deck} /><DeckStats deck={deck} cardsById={cardData} roleTags={roleTags} tagging={!!tagging} onTag={(label) => { setTabName('Cards'); setFilter(label) }} /></div>}
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
            { label: 'Export decklist', icon: 'ios_share', detail: 'Copy it for Moxfield, Archidekt or Arena', onClick: () => setShowExport(true) },
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
            title="Delete this deck?"
            onDismiss={() => setConfirmDelete(false)}
            actions={real > 0
              ? (
                <>
                  <button type="button" className="btn line" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button type="button" className="btn danger" onClick={() => remove(false)}>Delete cards too</button>
                  <button type="button" className="btn gold" onClick={() => remove(true)}>Keep cards</button>
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
                “{deck.name}” holds {real} of your cards. <b>Keep cards</b> puts them in Unsorted; <b>Delete cards too</b> takes them out of your collection with the deck.
              </p>
            )}
            <p className="muted" style={{ margin: 0 }}>{real > 0 ? 'The deck' : `“${deck.name}”`} will be removed here and, if you're signed in, from your other devices too.</p>
          </Dialog>
        )
      })()}

      {showExport && <ExportDeckDialog deck={deck} onDismiss={() => setShowExport(false)} />}
      {sharing && <ShareDialog kind="deck" itemId={deck.id} name={deck.name} onClose={() => setSharing(false)} />}
      {whoHas && <WhoHasItSheet deck={deck} onClose={() => setWhoHas(false)} />}
      {goldfish && <GoldfishDialog deck={deck} onClose={() => setGoldfish(false)} />}

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
          onTagClick={(label) => { setZoomId(null); setTabName('Cards'); setFilter(label) }}
          onSelectSimilar={(similar) => setAddWarning(addCardToDeck(deck.id, similar))}
          similarActionLabel="Tap a card to add it to this deck"
          onClose={() => setZoomId(null)}
          {...zoomSteps(listed, zoomEntry, (card) => setZoomId(card.scryfallId))}
        >
          {!commanderIds.has(zoomEntry.scryfallId) && (
            <div className="row-between panel" style={{ padding: '14px 16px' }}>
              <div>
                <div className="p-h" style={{ margin: 0 }}><h3>In this deck</h3></div>
                <div className="dim">{GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode}</div>
              </div>
              <div className="stepper-big">
                <button type="button" onClick={() => setCardQuantity(deck.id, zoomEntry.scryfallId, zoomEntry.quantity - 1)} aria-label="One fewer">−</button>
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

function CardRow({
  entry, commander, onZoom, onMore, onIncrement, onDecrement,
}: {
  entry: DeckCardEntry
  commander?: boolean
  onZoom: () => void
  onMore: () => void
  onIncrement?: () => void
  onDecrement?: () => void
}) {
  const longPress = useLongPress({ onLongPress: onMore, onClick: onZoom })
  const hasQty = !!onIncrement && !!onDecrement
  return (
    <div className={`crow${hasQty ? '' : ' no-qty'}`}>
      <div className="thumb-wrap" onClick={onZoom} style={{ cursor: 'pointer' }}>
        <ArtImage className="thumb" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
        {entry.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cmain" {...longPress}>
        <div className="cname">{entry.name}</div>
        <div className="cmeta">
          {commander && <span className="badge gold"><Icon name="star" />Commander</span>}
          <span>{entry.typeLine ?? ''}</span>
        </div>
      </div>
      {hasQty && (
        <div className="qty">
          <button type="button" onClick={onDecrement} aria-label={`One fewer ${entry.name}`}>−</button>
          <span className="qn">{entry.quantity}</span>
          <button type="button" onClick={onIncrement} aria-label={`One more ${entry.name}`}>+</button>
        </div>
      )}
      <button type="button" className="more" onClick={onMore} aria-label={`Actions for ${entry.name}`}>
        <Icon name="more_vert" style={{ fontSize: 20 }} />
      </button>
    </div>
  )
}

function DeckDetails({ deck, onExport, onDelete }: { deck: Deck; onExport: () => void; onDelete: () => void }) {
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
        <button type="button" className="btn line" style={{ flex: 1 }} onClick={onExport}><Icon name="ios_share" />Export decklist</button>
        <button type="button" className="btn danger" style={{ flex: 1 }} onClick={onDelete}><Icon name="delete" />Delete deck</button>
      </div>
    </div>
  )
}
