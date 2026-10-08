import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { ArtImage, IconButton, IdentityStrip, ManaPips, PageHeader, PillChip, SearchPill, rise, toArtCrop, useLayoutSize } from '../components/kit'
import { useDeckColors } from '../components/useDeckColors'
import { DECK_OWNERSHIP_LABELS, DECK_OWNERSHIP_OPTIONS, GAME_MODE_LABELS } from '../types/models'
import type { Deck, DeckOwnership, GameMode } from '../types/models'
import { Dialog } from '../components/Dialog'
import { useDeckChange } from '../components/DeckExtras'
import { deckSections, folderNames, renamedFolder, tidyFolder, withFolder, withoutFolder } from '../decks/deckFolders'
import { useDeckValueSampler } from '../decks/deckValueHistory'
import { isCube } from '../decks/cube'
import '../components/deckExtras.css'
import { EmptyState } from '../components/EmptyState'
import { PasteDeckDialog } from '../onboarding/PasteDeckDialog'

/** Which folders are folded away on the decks list, remembered in this browser. */
const FOLDED_KEY = 'mtgweb_deck_folders_folded'

export function DecksPage() {
  const { decks: library } = useSync()
  // Cubes are kept as decks but have their own list (pages/CubePage.tsx).
  const decks = useMemo(() => library.filter((d) => !isCube(d)), [library])
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DeckOwnership | 'ALL'>('ALL')
  const [pasting, setPasting] = useState(false)
  const deckColors = useDeckColors(decks)
  const wide = useLayoutSize() !== 'phone'
  const { all: changeDecks } = useDeckChange()
  // Once a day, each deck's value for its value over time (decks/deckValueHistory.ts).
  useDeckValueSampler(decks)
  const [folded, setFolded] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '["archived"]') as string[] } catch { return ['archived'] }
  })
  const toggleFold = (key: string) => {
    const next = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key]
    setFolded(next)
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify(next)) } catch { /* this visit only */ }
  }
  // Making a folder (its name and decks), and one being renamed or deleted.
  const [making, setMaking] = useState(false)
  const [editingFolder, setEditingFolder] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const matching = decks.filter((d) => !q || `${d.name} ${d.commander?.name ?? ''} ${d.partnerCommander?.name ?? ''} ${d.tags.join(' ')}`.toLowerCase().includes(q))
  const shown = matching.filter((d) => filter === 'ALL' || d.ownership === filter)
  const sections = deckSections(shown)
  const filed = sections.folders.length > 0 || sections.archived.length > 0

  const tile = (deck: Deck, i: number) => {
    const colors = deckColors[deck.id] ?? []
    const count = deck.cards.reduce((s, c) => s + c.quantity, 0)
    return (
      <button key={deck.id} type="button" className="tile press rise" style={rise(Math.min(i, 8) + 3)} onClick={() => navigate(`/decks/${deck.id}`)}>
        <ArtImage src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors} />
        <div className="shade" />
        {deck.sample ? <span className="flag">Sample</span> : deck.ownership !== 'PHYSICAL' && <span className="flag">{DECK_OWNERSHIP_LABELS[deck.ownership]}</span>}
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
  }
  /** A folder (or the Archived section): its heading, folding away, then its decks. */
  const section = (key: string, title: string, icon: string, list: Deck[], onEdit?: () => void) => (
    <div key={key} className="deck-folder">
      <div className="deck-folder-h">
        <h2>
          <button type="button" className="deck-folder-toggle" aria-expanded={!folded.includes(key)} onClick={() => toggleFold(key)}>
            <Icon name={icon} aria-hidden />{title}<span className="count">{list.length}</span>
            <Icon name={folded.includes(key) ? 'expand_more' : 'expand_less'} aria-hidden />
          </button>
        </h2>
        {onEdit && <IconButton icon="more_horiz" label={`Rename or delete ${title}`} onClick={onEdit} />}
      </div>
      {!folded.includes(key) && <div className="tiles">{list.map(tile)}</div>}
    </div>
  )

  // The old address for a new deck, from a bookmark or the other app's links.
  if (params.get('new') === '1') return <Navigate to="/decks/new" replace />

  return (
    <>
      <PageHeader
        title="Decks"
        actions={wide ? (
          <>
            <button type="button" className="btn line" onClick={() => setMaking(true)} disabled={decks.length === 0}><Icon name="create_new_folder" />New folder</button>
            <button type="button" className="btn line" onClick={() => navigate('/cubes')}><Icon name="grid_view" />Cubes</button>
            <button type="button" className="btn line" onClick={() => navigate('/precons')}><Icon name="inventory_2" />Precons</button>
            <button type="button" className="btn gold" onClick={() => navigate('/decks/new')}><Icon name="add" />New deck</button>
          </>
        ) : (
          <>
            {decks.length > 0 && <IconButton icon="create_new_folder" label="New folder" onClick={() => setMaking(true)} />}
            <IconButton icon="grid_view" label="Cubes" onClick={() => navigate('/cubes')} />
            <IconButton icon="inventory_2" label="Precons" onClick={() => navigate('/precons')} />
            <IconButton icon="add" label="New deck" variant="gold" onClick={() => navigate('/decks/new')} />
          </>
        )}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        {decks.length === 0 ? (
          <EmptyState
            className="rise"
            style={rise(1)}
            icon="style"
            text="No decks yet. Paste a list from anywhere, or start from an official precon."
            actions={[
              { label: 'Paste a list', icon: 'content_paste', onClick: () => setPasting(true) },
              { label: 'Browse precons', icon: 'inventory_2', to: '/precons' },
            ]}
          />
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
              <EmptyState icon="search_off" text="No decks match. Try another name, or show all decks." actions={[{ label: 'Show all', onClick: () => { setQuery(''); setFilter('ALL') } }]} />
            ) : !filed ? (
              <div className="tiles">
                {shown.map(tile)}
                {/* Fills an odd row, and is the obvious next step when the list is short. */}
                {!q && filter === 'ALL' && <StartTiles index={Math.min(shown.length, 8) + 3} />}
              </div>
            ) : (
              <>
                {sections.folders.map((f) => section(`folder:${f.name.toLowerCase()}`, f.name, 'folder', f.decks, () => setEditingFolder(f.name)))}
                {sections.loose.length > 0 && section('loose', 'Not in a folder', 'style', sections.loose)}
                {sections.archived.length > 0 && section('archived', 'Archived', 'archive', sections.archived)}
              </>
            )}
          </>
        )}
      </div>
      {making && <NewFolderDialog decks={decks} onDone={(name, ids) => {
        changeDecks((all) => all.map((d) => (ids.includes(d.id) ? withFolder(d, name) : d)))
        setMaking(false)
      }} onDismiss={() => setMaking(false)} />}
      {editingFolder && <EditFolderDialog name={editingFolder} onRename={(to) => {
        changeDecks((all) => renamedFolder(all, editingFolder, to))
        setEditingFolder(null)
      }} onDelete={() => {
        changeDecks((all) => withoutFolder(all, editingFolder))
        setEditingFolder(null)
      }} onDismiss={() => setEditingFolder(null)} />}
      {pasting && <PasteDeckDialog onDismiss={() => setPasting(false)} />}
    </>
  )
}

/** A new folder: its name, and the decks that go in it (a folder is there while a deck is in it). */
function NewFolderDialog({ decks, onDone, onDismiss }: { decks: Deck[]; onDone: (name: string, ids: string[]) => void; onDismiss: () => void }) {
  const [name, setName] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const taken = folderNames(decks).some((f) => f.toLowerCase() === tidyFolder(name).toLowerCase())
  return (
    <Dialog
      title="New folder"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!tidyFolder(name) || ids.length === 0} onClick={() => onDone(tidyFolder(name), ids)}>Make folder</button>
        </>
      }
    >
      <input className="input" autoFocus placeholder="Name, e.g. Modern" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <div className="dim" style={{ margin: '10px 0 6px' }}>{taken ? 'There is a folder with this name — the decks you pick join it.' : 'Pick the decks that go in it.'}</div>
      <div className="list" style={{ maxHeight: 280, overflow: 'auto' }}>
        {decks.filter((d) => !d.archived).map((d) => (
          <label key={d.id} className="row" style={{ gap: 10, padding: '6px 2px' }}>
            <input type="checkbox" checked={ids.includes(d.id)} onChange={() => setIds(ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id])} />
            <span style={{ flex: 1 }}>{d.name}</span>
            {d.folder && <span className="dim">{d.folder}</span>}
          </label>
        ))}
      </div>
    </Dialog>
  )
}

/** Renaming a folder, or deleting it — its decks stay, out of any folder. */
function EditFolderDialog({ name, onRename, onDelete, onDismiss }: { name: string; onRename: (to: string) => void; onDelete: () => void; onDismiss: () => void }) {
  const [to, setTo] = useState(name)
  return (
    <Dialog
      title={name}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn danger" onClick={onDelete}>Delete folder</button>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!tidyFolder(to)} onClick={() => onRename(to)}>Rename</button>
        </>
      }
    >
      <input className="input" autoFocus value={to} maxLength={60} onChange={(e) => setTo(e.target.value)} aria-label="Folder name" />
      <div className="dim" style={{ marginTop: 8 }}>Deleting the folder keeps its decks — they go back to the main list.</div>
    </Dialog>
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
