import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal } from '../components/CardZoomModal'
import { ActionSheet } from '../components/ActionSheet'
import type { SheetAction } from '../components/ActionSheet'
import { useLongPress } from '../components/useLongPress'
import { CardSearchResults } from '../components/CardSearchResults'
import { ExportDeckDialog } from '../components/ExportDeckDialog'
import { useAddWarning } from '../components/useAddWarning'
import { DeckStats } from '../components/DeckStats'
import { Dialog } from '../components/Dialog'
import {
  ArtImage, IconButton, ManaPips, PillChip, SectionHeader, SegmentedTabs, TYPE_GROUPS, TYPE_PLURALS,
  primaryTypeOf, rise, toArtCrop, useBack, useScrollProgress,
} from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { LAST_DECK_KEY } from './HomePage'
import {
  GAME_MODES, GAME_MODES_USING_COMMANDER, GAME_MODE_LABELS,
  DECK_OWNERSHIP_OPTIONS, DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_DESCRIPTIONS,
} from '../types/models'
import type { Deck, DeckCardEntry, GameMode } from '../types/models'

const TABS = ['Cards', 'Stats', 'Details'] as const

export function DeckDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/decks')
  const {
    decks, setCardQuantity, removeCardFromDeck, addCardToDeck, setCommander, setPartnerCommander, deleteDeck,
  } = useSync()
  const deck = decks.find((d) => d.id === id)
  const deckColors = useDeckColors(deck ? [deck] : [])
  const [tab, setTab] = useState(0)
  const [zoomId, setZoomId] = useState<string | null>(null)
  const [cardSheet, setCardSheet] = useState<DeckCardEntry | null>(null)
  const [deckSheet, setDeckSheet] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addWarning, setAddWarning] = useAddWarning()
  const progress = useScrollProgress(200)

  useEffect(() => {
    if (deck) localStorage.setItem(LAST_DECK_KEY, deck.id)
  }, [deck?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const groups = TYPE_GROUPS.map((type) => {
    const cards = deck.cards
      .filter((c) => !commanderIds.has(c.scryfallId) && primaryTypeOf(c.typeLine) === type)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { type, cards, count: cards.reduce((s, c) => s + c.quantity, 0) }
  }).filter((g) => g.cards.length > 0)

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
    actions.push({ label: 'Remove from deck', icon: 'delete', tone: 'danger', onClick: () => removeCardFromDeck(deck!.id, entry.scryfallId) })
    return actions
  }

  return (
    <>
      <TopBar
        title={deck.name}
        onBack={back}
        progress={progress}
        actions={<IconButton icon="more_horiz" label="Deck actions" variant={progress < 0.6 ? 'glass' : ''} onClick={() => setDeckSheet(true)} />}
      />

      <div className="hero" style={{ ['--p' as string]: progress }}>
        <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors} />
        <div className="hero-fade" />
        <div className="hero-body rise" style={rise(0)}>
          <div className="h-cmd">
            {colors.length > 0 && <ManaPips colors={colors} />}
            <span>{commanders.length > 0 ? commanders.map((c) => c.name).join(' & ') : GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode}</span>
          </div>
          <h1 className="deckname">{deck.name}</h1>
          <div className="h-stats">
            <span><b>{totalCards}</b>cards</span>
            {usesCommander && commanders.length > 0 && <span>{GAME_MODE_LABELS[deck.gameMode as GameMode]}</span>}
            <span className="bchip">{DECK_OWNERSHIP_LABELS[deck.ownership]}</span>
          </div>
        </div>
      </div>

      <div className="content-scroll">
        <div className="sticky-tabs">
          <SegmentedTabs labels={[...TABS]} selected={tab} onSelect={setTab} />
        </div>

        {tab === 0 && (
          <>
            {deck.cards.length === 0 ? (
              <div className="empty-state"><Icon name="playing_cards" />No cards yet — search below to add some.</div>
            ) : (
              <>
                {commanders.length > 0 && (
                  <>
                    <div className="grp">Commander<span>{commanders.length}</span></div>
                    <div className="list">
                      {commanders.map((entry) => (
                        <CardRow key={entry.scryfallId} entry={entry} commander onZoom={() => setZoomId(entry.scryfallId)} onMore={() => setCardSheet(entry)} />
                      ))}
                    </div>
                  </>
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
              </>
            )}

            <SectionHeader title="Add cards" />
            {addWarning && <div className="add-warning">{addWarning}</div>}
            <CardSearchResults onAdd={(card) => setAddWarning(addCardToDeck(deck.id, card))} />
          </>
        )}

        {tab === 1 && (
          <div style={{ marginTop: 12 }}>
            <DeckStats deck={deck} />
          </div>
        )}

        {tab === 2 && <DeckDetails deck={deck} onExport={() => setShowExport(true)} onDelete={() => setConfirmDelete(true)} />}
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

      {deckSheet && (
        <ActionSheet
          title={deck.name}
          subtitle={`${totalCards} cards · ${DECK_OWNERSHIP_LABELS[deck.ownership]}`}
          imageUrl={deck.commander?.imageUrl ?? null}
          actions={[
            { label: 'Export decklist', icon: 'ios_share', detail: 'Copy it for Moxfield, Archidekt or Arena', onClick: () => setShowExport(true) },
            { label: 'Deck details', icon: 'tune', detail: 'Format, ownership, commander and tags', onClick: () => setTab(2) },
            { label: 'Delete deck', icon: 'delete', tone: 'danger', onClick: () => setConfirmDelete(true) },
          ]}
          onClose={() => setDeckSheet(false)}
        />
      )}

      {confirmDelete && (
        <Dialog
          title="Delete this deck?"
          onDismiss={() => setConfirmDelete(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { deleteDeck(deck.id); navigate('/decks', { replace: true }) }}>Delete deck</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>“{deck.name}” will be removed here and, if you're signed in, from your other devices too.</p>
        </Dialog>
      )}

      {showExport && <ExportDeckDialog deck={deck} onDismiss={() => setShowExport(false)} />}

      {zoomEntry && (
        <CardZoomModal
          imageUrl={zoomEntry.imageUrl}
          name={zoomEntry.name}
          typeLine={zoomEntry.typeLine}
          scryfallId={zoomEntry.scryfallId}
          currentDeckId={deck.id}
          backImageUrl={zoomEntry.backImageUrl}
          tags={zoomEntry.tags}
          onSelectSimilar={(similar) => setAddWarning(addCardToDeck(deck.id, similar))}
          similarActionLabel="Tap a card to add it to this deck"
          onClose={() => setZoomId(null)}
        >
          {!commanderIds.has(zoomEntry.scryfallId) && (
            <div className="row-between panel">
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
      <div className="thumb-wrap">
        <button type="button" className="thumb" onClick={onZoom} aria-label={`View ${entry.name}`} style={{ padding: 0, border: 0, background: 'none' }}>
          <ArtImage className="thumb" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
        </button>
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
            <PillChip key={o} label={DECK_OWNERSHIP_LABELS[o]} selected={deck.ownership === o} onClick={() => setDeckOwnership(deck.id, o)} className="on-g2" />
          ))}
        </div>
        <div className="dim" style={{ marginTop: 10 }}>{DECK_OWNERSHIP_DESCRIPTIONS[deck.ownership]}</div>
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
