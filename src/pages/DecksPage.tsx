import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { ArtImage, IconButton, IdentityStrip, ManaPips, PageHeader, PillChip, SearchPill, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_OPTIONS, GAME_MODE_LABELS } from '../types/models'
import type { DeckOwnership, GameMode } from '../types/models'

export function DecksPage() {
  const { decks } = useSync()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DeckOwnership | 'ALL'>('ALL')
  const deckColors = useDeckColors(decks)
  const wide = useLayoutSize() !== 'phone'

  const q = query.trim().toLowerCase()
  const matching = decks.filter((d) => !q || `${d.name} ${d.commander?.name ?? ''} ${d.partnerCommander?.name ?? ''} ${d.tags.join(' ')}`.toLowerCase().includes(q))
  const shown = matching.filter((d) => filter === 'ALL' || d.ownership === filter)

  // The old address for a new deck, from a bookmark or the other app's links.
  if (params.get('new') === '1') return <Navigate to="/decks/new" replace />

  return (
    <>
      <PageHeader
        title="Decks"
        actions={wide ? (
          <>
            <button type="button" className="btn line" onClick={() => navigate('/precons')}><Icon name="inventory_2" />Precons</button>
            <button type="button" className="btn gold" onClick={() => navigate('/decks/new')}><Icon name="add" />New deck</button>
          </>
        ) : (
          <>
            <IconButton icon="inventory_2" label="Precons" onClick={() => navigate('/precons')} />
            <IconButton icon="add" label="New deck" variant="gold" onClick={() => navigate('/decks/new')} />
          </>
        )}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        {decks.length === 0 ? (
          <div className="empty-state rise" style={rise(1)}>
            <Icon name="style" />
            <div>No decks yet. Build your first one — cards you add sync to your phone when you're signed in.</div>
            <div className="tiles"><StartTiles index={2} /></div>
          </div>
        ) : (
          <>
            <div className={wide ? 'toolbar rise' : 'rise'} style={rise(1)}>
            <SearchPill value={query} onChange={setQuery} placeholder="Search decks, commanders, tags" />
            <div className="chips">
              <PillChip label="All" count={matching.length} selected={filter === 'ALL'} onClick={() => setFilter('ALL')} />
              {DECK_OWNERSHIP_OPTIONS.map((o) => (
                <PillChip
                  key={o}
                  label={DECK_OWNERSHIP_LABELS[o]}
                  count={matching.filter((d) => d.ownership === o).length}
                  selected={filter === o}
                  onClick={() => setFilter(o)}
                />
              ))}
            </div>
            </div>
            {shown.length === 0 ? (
              <div className="empty-state">No decks match.</div>
            ) : (
              <div className="tiles">
                {shown.map((deck, i) => {
                  const colors = deckColors[deck.id] ?? []
                  const count = deck.cards.reduce((s, c) => s + c.quantity, 0)
                  return (
                    <button key={deck.id} type="button" className="tile press rise" style={rise(Math.min(i, 8) + 3)} onClick={() => navigate(`/decks/${deck.id}`)}>
                      <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors} />
                      <div className="shade" />
                      {deck.ownership !== 'PHYSICAL' && <span className="flag">{DECK_OWNERSHIP_LABELS[deck.ownership]}</span>}
                      <div className="meta">
                        <div className="t-name">{deck.name}</div>
                        <div className="t-cmd">
                          {deck.commander ? [deck.commander.name, deck.partnerCommander?.name].filter(Boolean).join(' & ') : GAME_MODE_LABELS[deck.gameMode as GameMode] ?? deck.gameMode}
                        </div>
                        <div className="t-row">
                          {colors.length > 0 ? <ManaPips colors={colors} /> : <span />}
                          <span className="t-val">{count}<small>cards</small></span>
                        </div>
                      </div>
                      <IdentityStrip className="glow" colors={colors} />
                    </button>
                  )
                })}
                {/* Fills an odd row, and is the obvious next step when the list is short. */}
                {!q && filter === 'ALL' && <StartTiles index={Math.min(shown.length, 8) + 3} />}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

/** A deck-sized tile that starts a new deck: from scratch, or from a precon. */
function StartTile({ icon, title, note, onClick, index }: { icon: string; title: string; note: string; onClick: () => void; index: number }) {
  return (
    <button type="button" className="tile start-tile press rise" style={rise(index)} onClick={onClick}>
      <span className="start-icon"><Icon name={icon} /></span>
      <span className="start-title">{title}</span>
      <span className="start-note">{note}</span>
    </button>
  )
}

/** The two ways to start a deck, after the decks (and all there is when there are none). */
function StartTiles({ index }: { index: number }) {
  const navigate = useNavigate()
  return (
    <>
      <StartTile icon="add" title="Start from scratch" note="Pick a format and a commander" onClick={() => navigate('/decks/new')} index={index} />
      <StartTile icon="inventory_2" title="Start from a precon" note="Import any official Commander deck" onClick={() => navigate('/precons')} index={index + 1} />
    </>
  )
}
