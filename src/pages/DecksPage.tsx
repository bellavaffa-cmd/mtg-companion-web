import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, IconButton, IdentityStrip, ManaPips, PageHeader, PillChip, SearchPill, rise, toArtCrop } from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_OPTIONS, GAME_MODES, GAME_MODE_LABELS } from '../types/models'
import type { DeckOwnership, GameMode } from '../types/models'

export function DecksPage() {
  const { decks } = useSync()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DeckOwnership | 'ALL'>('ALL')
  const deckColors = useDeckColors(decks)
  const showCreate = params.get('new') === '1'

  const q = query.trim().toLowerCase()
  const matching = decks.filter((d) => !q || `${d.name} ${d.commander?.name ?? ''} ${d.partnerCommander?.name ?? ''} ${d.tags.join(' ')}`.toLowerCase().includes(q))
  const shown = matching.filter((d) => filter === 'ALL' || d.ownership === filter)

  return (
    <>
      <PageHeader
        title="Decks"
        actions={<IconButton icon="add" label="New deck" variant="gold" onClick={() => setParams({ new: '1' })} />}
      />
      <div className="content-scroll with-nav">
        {decks.length === 0 ? (
          <div className="empty-state rise" style={rise(1)}>
            <Icon name="style" />
            <div>No decks yet. Build your first one — cards you add sync to your phone when you're signed in.</div>
            <button type="button" className="btn gold" onClick={() => setParams({ new: '1' })}><Icon name="add" />New deck</button>
          </div>
        ) : (
          <>
            <div className="rise" style={rise(1)}>
              <SearchPill value={query} onChange={setQuery} placeholder="Search decks, commanders, tags" />
            </div>
            <div className="chips rise" style={rise(2)}>
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
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateDeckDialog
          onDismiss={() => setParams({}, { replace: true })}
          onCreated={(id) => navigate(`/decks/${id}`, { replace: true })}
        />
      )}
    </>
  )
}

function CreateDeckDialog({ onDismiss, onCreated }: { onDismiss: () => void; onCreated: (id: string) => void }) {
  const { createDeck } = useSync()
  const [name, setName] = useState('')
  const [gameMode, setGameMode] = useState<GameMode>('COMMANDER')
  const create = () => {
    if (!name.trim()) return
    onCreated(createDeck(name.trim(), gameMode).id)
  }

  return (
    <Dialog
      title="New deck"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!name.trim()} onClick={create}>Create deck</button>
        </>
      }
    >
      <div className="field-label">Deck name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus />
      <div className="field-label" style={{ marginTop: 16 }}>Format</div>
      <div className="chips wrap">
        {GAME_MODES.map((m) => (
          <PillChip key={m} label={GAME_MODE_LABELS[m]} selected={gameMode === m} onClick={() => setGameMode(m)} className="on-g2" />
        ))}
      </div>
    </Dialog>
  )
}
