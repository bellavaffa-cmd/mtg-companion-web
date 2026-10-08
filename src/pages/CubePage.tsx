import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { IconButton, PageHeader, PillChip, SectionHeader, SegmentedTabs, useBack } from '../components/kit'
import { ShareDialog } from '../social/ShareDialog'
import { useCardData } from '../collection/cardData'
import { pulledCopies } from '../collection/pullList'
import { resolveCardList } from '../collection/importCards'
import { savePlace } from '../collection/storagePlaces'
import { searchCards } from '../api/scryfall'
import { entryFromCard } from '../decks/newDeck'
import {
  CUBE_DEFAULT_SIZE, CUBE_GROUPS, CUBE_GROUP_LABELS, CUBE_PACKS, CUBE_PACK_SIZE, CUBE_SEATS, CUBE_SIZES,
  addToCube, asCube, cubeBalance, cubeBoxOf, cubeBoxPlace, cubeCardOf, cubeFill, cubeFilterMatches, cubeGroupOf, cubeListText,
  cubePacks, cubePool, cubePullList, cubeSettings, cubeSize, cubeStatus, isCube, limitedDeckFromCube, markCubeProxy, moveIntoCubeBox,
  newCube, parseCubeList, removeFromCube,
  type CubeBalance, type CubeCard, type CubeCardStatus, type CubeCount, type CubeFilter, type CubeLine, type CubePacks,
} from '../decks/cube'
import type { Collection, Deck, DeckCardEntry } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import './cube.css'

// Cubes (decks/cube.ts): the list of cubes, and one cube — its cards (built from the collection, with
// cards not owned flagged), its balance, its box (a storage place, filled from the pull list) and its
// draft (packs dealt from it into a draft or sealed deck). The Android app's CubeScreens.kt shows the same.

const cardsWord = (n: number) => (n === 1 ? '1 card' : `${n} cards`)

/** The cubes, A–Z, and "New cube". */
export function CubesPage() {
  const { decks, changeDecksAndStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack('/decks')
  const [making, setMaking] = useState(false)
  const cubes = decks.filter(isCube).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <PageHeader title="Cubes" onBack={back} />
      <div className="content-scroll cube-page">
        {cubes.length === 0 && (
          <div className="empty-state"><Icon name="grid_view" /><div>No cubes yet. Make one from your own cards — 360, 540, 720 or any size — or paste a list from CubeCobra.</div></div>
        )}
        <div className="cube-list">
          {cubes.map((c) => {
            const s = cubeSettings(c)
            return (
              <button key={c.id} type="button" className="cube-tile press" onClick={() => navigate(`/cubes/${c.id}`)}>
                <b>{c.name}</b>
                <span>{c.cards.reduce((n, e) => n + e.quantity, 0)} / {s.size} cards{s.singleton ? ' · singleton' : ''}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="pull-bar">
        <button type="button" className="btn gold" onClick={() => setMaking(true)}>+ New cube</button>
      </div>
      {making && (
        <CubeSettingsDialog
          title="New cube" name="" size={CUBE_DEFAULT_SIZE} singleton confirm="Make it" onDismiss={() => setMaking(false)}
          onDone={(name, size, singleton) => {
            const cube = newCube(crypto.randomUUID(), name ?? '', size, singleton, Date.now())
            changeDecksAndStorage((collections, all) => ({ collections, decks: [...all, cube] }))
            setMaking(false)
            navigate(`/cubes/${cube.id}`)
          }}
        />
      )}
    </>
  )
}

/** Name, size (360, 540, 720 or custom) and singleton — for a new cube, or to change one. */
function CubeSettingsDialog({ title, name, size, singleton, confirm, onDismiss, onDone }: {
  title: string; name: string | null; size: number; singleton: boolean; confirm: string
  onDismiss: () => void; onDone: (name: string | null, size: number, singleton: boolean) => void
}) {
  const [typed, setTyped] = useState(name ?? '')
  const [chosen, setChosen] = useState(CUBE_SIZES.includes(size) ? size : 0)
  const [custom, setCustom] = useState(CUBE_SIZES.includes(size) ? '' : String(size))
  const [single, setSingle] = useState(singleton)
  const finalSize = chosen > 0 ? chosen : Number(custom) || 0
  return (
    <Dialog
      title={title}
      onDismiss={onDismiss}
      actions={<>
        <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
        <button type="button" className="btn gold" disabled={finalSize < 40} onClick={() => onDone(name == null ? null : typed, finalSize, single)}>{confirm}</button>
      </>}
    >
      <div className="cube-form">
        {name != null && <label>Name<input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>}
        <div className="dim">Size</div>
        <div className="chips">
          {CUBE_SIZES.map((s) => <PillChip key={s} label={String(s)} selected={chosen === s} onClick={() => setChosen(s)} />)}
          <PillChip label="Custom" selected={chosen === 0} onClick={() => setChosen(0)} />
        </div>
        {chosen === 0 && <label>Cards (40 to 1,500)<input className="input" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>}
        <label className="cube-check"><input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} /> Singleton — one copy of each card</label>
      </div>
    </Dialog>
  )
}

const TABS = ['Cards', 'Balance', 'Box', 'Draft']

/** One cube: Cards, Balance, Box and Draft. */
export function CubePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/cubes')
  const { decks, collections, changeDecksAndStorage, changeStorage, deleteDeck } = useSync()
  const found = decks.find((d) => d.id === id)
  const cube = found && isCube(found) ? found : null
  const [tab, setTab] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'rename' | 'settings' | 'delete' | 'owned' | 'fill' | 'search' | 'import' | 'share' | null>(null)
  const [query, setQuery] = useState('')

  // Owned printings (not the Wishlist's), one entry per printing, copies added together.
  const owned = useMemo(() => {
    const byId = new Map<string, DeckCardEntry>()
    for (const c of collections) {
      if (c.type === 'WISHLIST') continue
      for (const e of c.entries) {
        const n = e.quantity + e.foilQuantity
        if (n <= 0) continue
        const had = byId.get(e.scryfallId)
        byId.set(e.scryfallId, had ? { ...had, quantity: had.quantity + n } : {
          scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, quantity: n, canBeCommander: false, typeLine: null, partnerAbility: null,
          ...(e.backImageUrl ? { backImageUrl: e.backImageUrl } : {}), ...(e.tags ? { tags: e.tags } : {}),
        })
      }
    }
    return [...byId.values()]
  }, [collections])
  const ids = useMemo(() => [...new Set([...(cube?.cards ?? []).map((e) => e.scryfallId), ...owned.map((e) => e.scryfallId)])], [cube?.cards, owned])
  const cardData = useCardData(ids)
  const [extra, setExtra] = useState<Map<string, ScryfallCard>>(new Map())
  const cardOf = (cid: string) => cardData?.get(cid) ?? extra.get(cid)

  const settings = cube ? cubeSettings(cube) : { size: CUBE_DEFAULT_SIZE, singleton: true }
  const lines: CubeLine[] = useMemo(
    () => (cube?.cards ?? []).flatMap((e) => { const c = cardData?.get(e.scryfallId) ?? extra.get(e.scryfallId); return c ? [{ card: cubeCardOf(c), qty: e.quantity }] : [] }),
    [cube?.cards, cardData, extra],
  )
  const balance = useMemo(() => cubeBalance(lines, settings.size, settings.singleton), [lines, settings.size, settings.singleton])
  const status = useMemo(() => new Map(cube ? cubeStatus(cube, collections).map((s) => [s.scryfallId, s]) : []), [cube, collections])

  if (!cube) {
    return (
      <>
        <PageHeader title="Cube" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="grid_view" /><div>This cube isn't here any more.</div></div></div>
      </>
    )
  }
  const total = cube.cards.reduce((n, e) => n + e.quantity, 0)
  const unknown = cube.cards.filter((e) => !cardOf(e.scryfallId)).length

  const changeCube = (f: (c: Deck) => Deck) =>
    changeDecksAndStorage((cols, all) => ({ collections: cols, decks: all.map((d) => (d.id === cube.id && isCube(d) ? asCube(f(d)) : d)) }))
  const add = (entries: DeckCardEntry[]) => {
    const r = addToCube(cube, entries)
    if (r.added > 0) changeCube((c) => addToCube(c, entries).cube)
    setMessage(`Added ${cardsWord(r.added)}${r.skipped.length > 0 ? ` — ${cardsWord(r.skipped.length)} already in the cube left out` : ''}`)
  }
  const withInfo = (e: DeckCardEntry): DeckCardEntry => {
    const c = cardOf(e.scryfallId)
    return c ? { ...entryFromCard(c, e.quantity), imageUrl: e.imageUrl ?? entryFromCard(c, 1).imageUrl, ...(e.tags ? { tags: e.tags } : {}) } : e
  }
  const listText = () => cubeListText(cube.cards.map((e) => ({ name: e.name, qty: e.quantity })))

  return (
    <>
      <PageHeader
        title={cube.name}
        eyebrow={`${total} / ${settings.size} cards${settings.singleton ? ' · singleton' : ''}`}
        onBack={back}
        actions={<>
          <IconButton icon="group" label="Share with friends" onClick={() => setDialog('share')} />
          <IconButton icon="content_copy" label="Copy the list" onClick={() => { void navigator.clipboard?.writeText(listText()); setMessage('List copied — a card a line, ready for CubeCobra') }} />
          <IconButton icon="edit" label="Rename" onClick={() => setDialog('rename')} />
          <IconButton icon="tune" label="Size and singleton" onClick={() => setDialog('settings')} />
          <IconButton icon="delete" label="Delete cube" onClick={() => setDialog('delete')} />
        </>}
      />
      <div className="content-scroll cube-page">
        <SegmentedTabs labels={TABS} selected={tab} onSelect={setTab} />
        {message && <button type="button" className="cube-note" role="status" onClick={() => setMessage(null)}>{message}</button>}
        {unknown > 0 && <div className="dim cube-small">Looking up {cardsWord(unknown)} on Scryfall…</div>}
        {tab === 0 && (
          <CardsTab
            cube={cube} cardOf={cardOf} status={status} query={query} onQuery={setQuery}
            onAddOwned={() => setDialog('owned')} onFill={() => setDialog('fill')} onSearch={() => setDialog('search')} onImport={() => setDialog('import')}
            onRemove={(sid) => changeCube((c) => removeFromCube(c, sid))}
            onProxy={(sid, on) => changeCube((c) => markCubeProxy(c, sid, on))}
            onView={(e) => navigate(`/card/${encodeURIComponent(e.name)}?id=${e.scryfallId}`)}
          />
        )}
        {tab === 1 && <BalanceTab balance={balance} unknown={unknown} />}
        {tab === 2 && (
          <BoxTab
            cube={cube} collections={collections} decks={decks} status={[...status.values()]}
            onMakeBox={() => {
              const place = cubeBoxPlace(cube, crypto.randomUUID(), Date.now())
              changeDecksAndStorage((cols, all) => ({
                collections: savePlace(cols, place),
                decks: all.map((d) => (d.id === cube.id ? asCube({ ...d, cube: { ...cubeSettings(d), boxPlaceId: place.id } }) : d)),
              }))
            }}
            onOpenPlace={(pid) => navigate(`/collections/place/${pid}`)}
            onMove={(list, ticked) => {
              const box = cube.cube?.boxPlaceId
              if (!box) return
              const moved = moveIntoCubeBox(list, ticked, collections, box).moved
              changeStorage((cols) => moveIntoCubeBox(list, ticked, cols, box).collections)
              setMessage(`Moved ${moved === 1 ? '1 copy' : `${moved} copies`} into the cube box`)
            }}
          />
        )}
        {tab === 3 && (
          <DraftTab
            cube={cube}
            onSave={(seats, packs, packSize) => changeCube((c) => ({ ...c, cube: { ...cubeSettings(c), seats, packs, packSize } }))}
            onStart={(cardIds, name, note) => {
              const deck = limitedDeckFromCube(cube, cardIds, crypto.randomUUID(), name, note, Date.now())
              changeDecksAndStorage((cols, all) => ({ collections: cols, decks: [...all, deck] }))
              navigate(`/decks/${deck.id}`)
            }}
            onCopy={(text) => { void navigator.clipboard?.writeText(text); setMessage('Pack lists copied') }}
          />
        )}
      </div>

      {dialog === 'share' && <ShareDialog kind="deck" itemId={cube.id} name={cube.name} onClose={() => setDialog(null)} />}
      {dialog === 'rename' && <RenameDialog name={cube.name} onDismiss={() => setDialog(null)} onSave={(n) => { changeCube((c) => ({ ...c, name: n.trim() })); setDialog(null) }} />}
      {dialog === 'settings' && (
        <CubeSettingsDialog
          title="Size and singleton" name={null} size={settings.size} singleton={settings.singleton} confirm="Save" onDismiss={() => setDialog(null)}
          onDone={(_n, size, singleton) => { changeCube((c) => ({ ...c, cube: { ...cubeSettings(c), size: cubeSize(size), singleton } })); setDialog(null) }}
        />
      )}
      {dialog === 'delete' && (
        <Dialog
          title={`Delete ${cube.name}?`}
          onDismiss={() => setDialog(null)}
          actions={<>
            <button type="button" className="btn line" onClick={() => setDialog(null)}>Cancel</button>
            <button type="button" className="btn danger" onClick={() => { deleteDeck(cube.id); navigate('/cubes', { replace: true }) }}>Delete</button>
          </>}
        >
          The cube's list goes. The cards stay in your collection — the ones in the cube box stay there.
        </Dialog>
      )}
      {dialog === 'owned' && (
        <AddFromCollectionDialog cube={cube} owned={owned} cardOf={cardOf} onDismiss={() => setDialog(null)} onAdd={(picked) => { setDialog(null); add(picked.map(withInfo)) }} />
      )}
      {dialog === 'fill' && (
        <FillDialog
          suggestions={cubeFill(lines, owned.flatMap((e) => { const c = cardOf(e.scryfallId); return c ? [cubeCardOf(c)] : [] }), settings.size)}
          unknown={unknown}
          onDismiss={() => setDialog(null)}
          onAdd={(picked) => {
            setDialog(null)
            const byId = new Map(owned.map((e) => [e.scryfallId, e]))
            add(picked.flatMap((c) => { const e = byId.get(c.id); return e ? [withInfo({ ...e, quantity: 1 })] : [] }))
          }}
        />
      )}
      {dialog === 'search' && (
        <SearchCardsDialog cube={cube} onDismiss={() => setDialog(null)} onAdd={(card) => { setExtra((m) => new Map(m).set(card.id, card)); add([entryFromCard(card, 1)]) }} />
      )}
      {dialog === 'import' && (
        <ImportDialog
          onDismiss={() => setDialog(null)}
          onFound={(cards) => {
            setExtra((m) => { const next = new Map(m); for (const c of cards) next.set(c.card.id, c.card); return next })
            const r = addToCube(cube, cards.map((c) => entryFromCard(c.card, c.quantity)))
            if (r.added > 0) changeCube((c) => addToCube(c, cards.map((x) => entryFromCard(x.card, x.quantity))).cube)
            return { added: r.added, skipped: r.skipped.length }
          }}
        />
      )}
    </>
  )
}

function stateLine(s: CubeCardStatus | undefined): string {
  switch (s?.state) {
    case 'IN_BOX': return 'In the cube box'
    case 'OWNED': return s.where ? `Owned · ${s.where}` : 'Owned'
    case 'PROXY': return 'Proxy'
    case 'NOT_OWNED': return 'Not owned'
    default: return ''
  }
}

function CardsTab({ cube, cardOf, status, query, onQuery, onAddOwned, onFill, onSearch, onImport, onRemove, onProxy, onView }: {
  cube: Deck; cardOf: (id: string) => ScryfallCard | undefined; status: Map<string, CubeCardStatus>; query: string; onQuery: (q: string) => void
  onAddOwned: () => void; onFill: () => void; onSearch: () => void; onImport: () => void
  onRemove: (id: string) => void; onProxy: (id: string, on: boolean) => void; onView: (e: DeckCardEntry) => void
}) {
  const q = query.trim().toLowerCase()
  const shown = cube.cards.filter((e) => !q || e.name.toLowerCase().includes(q))
  const groups = new Map<string, DeckCardEntry[]>()
  for (const e of shown) {
    const c = cardOf(e.scryfallId)
    const g = c ? cubeGroupOf(cubeCardOf(c)) : '?'
    groups.set(g, [...(groups.get(g) ?? []), e])
  }
  return (
    <>
      <div className="cube-actions">
        <button type="button" className="btn line" onClick={onAddOwned}><Icon name="library_add" />Add from collection</button>
        <button type="button" className="btn line" onClick={onFill}><Icon name="auto_awesome" />Fill from collection</button>
        <button type="button" className="btn line" onClick={onSearch}><Icon name="search" />Any card</button>
        <button type="button" className="btn line" onClick={onImport}><Icon name="upload" />Import a list</button>
      </div>
      {cube.cards.length === 0 ? (
        <div className="empty-state"><Icon name="grid_view" /><div>No cards yet. Add them from your collection, let it fill by colour, or import a list.</div></div>
      ) : (
        <>
          {cube.cards.length > 10 && <input className="input cube-find" placeholder="Find in the cube" value={query} onChange={(e) => onQuery(e.target.value)} />}
          {[...CUBE_GROUPS, '?'].map((g) => {
            const inGroup = (groups.get(g) ?? []).sort((a, b) => a.name.localeCompare(b.name))
            if (inGroup.length === 0) return null
            return (
              <section key={g}>
                <SectionHeader title={`${CUBE_GROUP_LABELS[g] ?? 'Looking up'} · ${inGroup.reduce((n, e) => n + e.quantity, 0)}`} />
                <div className="cube-rows">
                  {inGroup.map((e) => {
                    const s = status.get(e.scryfallId)
                    return (
                      <div key={e.scryfallId} className="cube-row">
                        <button type="button" className="cube-row-main" onClick={() => onView(e)}>
                          <b>{e.quantity > 1 ? `${e.quantity}× ` : ''}{e.name}</b>
                          <span className={`cube-state ${s?.state.toLowerCase() ?? ''}`}>{stateLine(s)}</span>
                        </button>
                        {(s?.state === 'NOT_OWNED' || s?.state === 'PROXY') && (
                          <button type="button" className="btn-link" onClick={() => onProxy(e.scryfallId, s.state === 'NOT_OWNED')}>{s.state === 'NOT_OWNED' ? 'Mark proxy' : 'Not a proxy'}</button>
                        )}
                        <IconButton icon="close" label={`Take ${e.name} out of the cube`} onClick={() => onRemove(e.scryfallId)} />
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </>
      )}
    </>
  )
}

function CountBar({ c }: { c: CubeCount }) {
  const pct = c.target ? Math.min(100, (c.count / c.target) * 100) : 0
  return (
    <div className="cube-bar">
      <div className="cube-bar-head"><span>{c.label}</span><b>{c.target != null ? `${c.count} / ${c.target}` : c.count}</b></div>
      {c.target != null && c.target > 0 && <div className="cube-bar-track"><div className={c.count > c.target ? 'over' : ''} style={{ width: `${pct}%` }} /></div>}
    </div>
  )
}

function BalanceTab({ balance: b, unknown }: { balance: CubeBalance; unknown: number }) {
  return (
    <>
      {unknown > 0 && <div className="cube-note">{cardsWord(unknown)} not looked up yet — they're left out of the balance until they are.</div>}
      {b.warnings.length > 0
        ? <div className="cube-note warn">{b.warnings.map((w) => <div key={w}>{w}</div>)}</div>
        : <div className="cube-note">Balanced for {b.size} cards.</div>}
      <SectionHeader title="Colours" />
      {b.groups.map((c) => <CountBar key={c.key} c={c} />)}
      <SectionHeader title={`Curve · average ${b.averageMv.toFixed(2)}`} />
      <div className="cube-curve">
        {b.curve.map((c) => <div key={c.key}><span>{c.label}</span><b>{c.count}</b><small>of {c.target}</small></div>)}
      </div>
      <SectionHeader title="Types" />
      {b.types.map((c) => <CountBar key={c.key} c={c} />)}
      <SectionHeader title="Roles" />
      {b.roles.map((c) => <CountBar key={c.key} c={c} />)}
      <div className="dim cube-small">Roles are read from each card's rules text: removal, fixing (lands and spells that make or find more than one colour), card draw and counterspells.</div>
    </>
  )
}

function BoxTab({ cube, collections, decks, status, onMakeBox, onOpenPlace, onMove }: {
  cube: Deck; collections: Collection[]; decks: Deck[]; status: CubeCardStatus[]
  onMakeBox: () => void; onOpenPlace: (id: string) => void; onMove: (list: ReturnType<typeof cubePullList>, ticked: Set<string>) => void
}) {
  const box = cubeBoxOf(cube, collections)
  const list = useMemo(() => cubePullList(cube, collections, decks), [cube, collections, decks])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const inBox = status.reduce((n, s) => n + s.inBox, 0)
  const toPull = status.filter((s) => s.state === 'OWNED').reduce((n, s) => n + s.qty - s.inBox, 0)
  const proxies = status.filter((s) => s.state === 'PROXY').reduce((n, s) => n + s.qty, 0)
  const notOwned = status.filter((s) => s.state === 'NOT_OWNED').reduce((n, s) => n + s.qty - s.inBox, 0)
  const movable = list.groups.filter((g) => g.kind === 'place' || g.kind === 'loose').flatMap((g) => g.rows)
  const live = new Set([...ticked].filter((k) => movable.some((r) => r.key === k)))
  const chosen = pulledCopies(movable, live)
  const toggle = (k: string) => setTicked((t) => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n })
  return (
    <>
      <div className="panel cube-box-head">
        {!box ? (
          <>
            <p>{cube.cube?.boxPlaceId
              ? 'The cube box isn’t one of your storage places any more (deleted, or the collection was reset). Make it again to keep track of the cards in it.'
              : 'Keep the cube’s cards together: the cube box is a storage place, so every owned card in it says where it is. The pull list fetches the rest from wherever they are now.'}</p>
            <button type="button" className="btn gold" onClick={onMakeBox}><Icon name="inventory_2" />Make the cube box</button>
          </>
        ) : (
          <div className="cube-box-name"><b>{box.name}</b><button type="button" className="btn-link" onClick={() => onOpenPlace(box.id)}>Open</button></div>
        )}
        <div className="dim cube-small">{inBox} in the box · {toPull} to pull · {proxies} proxies · {notOwned} not owned</div>
      </div>
      {box && (list.groups.length === 0 ? <div className="cube-note">Every owned card is in the box.</div> : (
        <>
          <div className="cube-pull-head">
            <SectionHeader title="Pull list" action={movable.length > 0 ? (live.size === movable.length ? 'Untick all' : 'Tick all') : undefined}
              onAction={() => setTicked(live.size === movable.length ? new Set() : new Set(movable.map((r) => r.key)))} />
          </div>
          {list.groups.map((g) => (
            <section key={g.key} className="cube-pull-group">
              <div className="cube-pull-title">{g.title}</div>
              {g.detail && <div className="dim cube-small">{g.detail}</div>}
              {g.rows.map((r) => {
                const canMove = r.source.kind === 'place' || r.source.kind === 'loose'
                return (
                  <label key={r.key} className="cube-pull-row">
                    {canMove ? <input type="checkbox" checked={live.has(r.key)} onChange={() => toggle(r.key)} /> : <span className="cube-pull-gap" />}
                    <span>
                      <b>{r.qty > 1 ? `${r.qty}× ` : ''}{r.name}</b>
                      {r.hint && <small>{r.hint}</small>}
                      {r.source.kind === 'deck' && <small>Stays in that deck — swap a copy in when you have one</small>}
                    </span>
                  </label>
                )
              })}
            </section>
          ))}
          <div className="pull-bar">
            <button type="button" className="btn gold" disabled={chosen === 0} onClick={() => { onMove(list, live); setTicked(new Set()) }}>
              {chosen > 0 ? `Move ${chosen} into the cube box` : 'Tick what you’ve pulled'}
            </button>
          </div>
        </>
      ))}
    </>
  )
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="cube-stepper">
      <span>{label}</span>
      <IconButton icon="remove" label={`Fewer: ${label}`} onClick={() => onChange(Math.max(min, value - 1))} />
      <b>{value}</b>
      <IconButton icon="add" label={`More: ${label}`} onClick={() => onChange(Math.min(max, value + 1))} />
    </div>
  )
}

function packText(name: string, dealt: CubePacks, names: Map<string, string>): string {
  const out = [name]
  dealt.seats.forEach((packs, s) => packs.forEach((pack, p) => out.push(`Seat ${s + 1} — pack ${p + 1}: ${pack.map((id) => names.get(id) ?? id).join(', ')}`)))
  return out.join('\n')
}

function DraftTab({ cube, onSave, onStart, onCopy }: {
  cube: Deck; onSave: (seats: number, packs: number, packSize: number) => void
  onStart: (ids: string[], name: string, note: string) => void; onCopy: (text: string) => void
}) {
  const s = cubeSettings(cube)
  const [seats, setSeats] = useState(s.seats ?? CUBE_SEATS)
  const [packs, setPacks] = useState(s.packs ?? CUBE_PACKS)
  const [size, setSize] = useState(s.packSize ?? CUBE_PACK_SIZE)
  const [seed, setSeed] = useState<number | null>(null)
  const pool = useMemo(() => cubePool(cube), [cube])
  const names = useMemo(() => new Map(cube.cards.map((e) => [e.scryfallId, e.name])), [cube.cards])
  const dealt = useMemo(() => (seed == null ? null : cubePacks(pool, seats, packs, size, seed)), [pool, seats, packs, size, seed])
  return (
    <div className="cube-draft">
      <p>Deal packs from the cube for your pod: each seat gets its packs, to pull from the cube box. Then start a draft or sealed deck — your pool goes in, and the deck's draft and sealed tools take it from there.</p>
      <Stepper label="Seats (pod size)" value={seats} min={2} max={16} onChange={setSeats} />
      <Stepper label="Packs a seat" value={packs} min={1} max={6} onChange={setPacks} />
      <Stepper label="Cards a pack" value={size} min={5} max={20} onChange={setSize} />
      <div className="dim cube-small">{cardsWord(pool.length)} in the cube · {seats * packs * size} needed</div>
      <button type="button" className="btn gold block" onClick={() => { setSeed(Math.floor(Math.random() * 2 ** 31)); onSave(seats, packs, size) }}>
        {dealt ? 'Shuffle and deal again' : 'Deal packs'}
      </button>
      {dealt && dealt.short > 0 && <div className="cube-note warn">The cube is {cardsWord(dealt.short)} short of {dealt.needed} — fewer seats, packs or cards a pack, or add cards.</div>}
      {dealt && dealt.short === 0 && (
        <>
          <button type="button" className="btn line block" onClick={() => onStart(dealt.seats.flat(2), `${cube.name} draft`, `Drafted from the cube ${cube.name}, ${seats} seats × ${packs} packs of ${size}. The pool holds every card dealt: move your picks into the main deck.`)}>
            Start a draft deck
          </button>
          <button type="button" className="btn line block" onClick={() => onCopy(packText(cube.name, dealt, names))}>Copy pack lists</button>
          {dealt.seats.map((seatPacks, i) => (
            <div key={i} className="panel cube-seat">
              <div className="cube-box-name">
                <b>Seat {i + 1}</b>
                <button type="button" className="btn-link" onClick={() => onStart(seatPacks.flat(), `${cube.name} sealed — seat ${i + 1}`, `Sealed from the cube ${cube.name}: seat ${i + 1}'s ${packs} packs of ${size}.`)}>Sealed deck</button>
              </div>
              {seatPacks.map((pack, p) => <div key={p} className="dim cube-small">Pack {p + 1}: {pack.map((id) => names.get(id) ?? id).join(', ')}</div>)}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function RenameDialog({ name, onSave, onDismiss }: { name: string; onSave: (n: string) => void; onDismiss: () => void }) {
  const [typed, setTyped] = useState(name)
  return (
    <Dialog title="Rename cube" onDismiss={onDismiss} actions={<>
      <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
      <button type="button" className="btn gold" disabled={!typed.trim()} onClick={() => onSave(typed)}>Save</button>
    </>}>
      <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
    </Dialog>
  )
}

const RARITIES = ['common', 'uncommon', 'rare', 'mythic']

function AddFromCollectionDialog({ cube, owned, cardOf, onDismiss, onAdd }: {
  cube: Deck; owned: DeckCardEntry[]; cardOf: (id: string) => ScryfallCard | undefined; onDismiss: () => void; onAdd: (picked: DeckCardEntry[]) => void
}) {
  const [f, setF] = useState<CubeFilter>({})
  const [minText, setMin] = useState('')
  const [maxText, setMax] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const inCube = new Set(cube.cards.map((e) => e.name.toLowerCase()))
  const filter: CubeFilter = { ...f, minUsd: minText ? Number(minText) : null, maxUsd: maxText ? Number(maxText) : null }
  const onlyName = !filter.groups?.length && !filter.rarities?.length && !filter.type?.trim() && !filter.set?.trim() && filter.minUsd == null && filter.maxUsd == null
  const seen = new Set<string>()
  const shown = owned
    .filter((e) => !inCube.has(e.name.toLowerCase()))
    .filter((e) => {
      const c = cardOf(e.scryfallId)
      // A card not looked up yet only shows while nothing but its name is asked.
      return c ? cubeFilterMatches(filter, cubeCardOf(c)) : onlyName && (!filter.query?.trim() || e.name.toLowerCase().includes(filter.query.trim().toLowerCase()))
    })
    .filter((e) => { const k = e.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.name.localeCompare(b.name))
  const toggleIn = (list: string[] | undefined, v: string) => (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]
  const count = shown.filter((e) => picked.has(e.scryfallId)).length
  return (
    <Dialog
      title="Add from collection"
      onDismiss={onDismiss}
      actions={<>
        <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
        <button type="button" className="btn gold" disabled={count === 0} onClick={() => onAdd(shown.filter((e) => picked.has(e.scryfallId)).map((e) => ({ ...e, quantity: 1 })))}>Add {cardsWord(count)}</button>
      </>}
    >
      <div className="cube-form">
        <input className="input" placeholder="Name" value={f.query ?? ''} onChange={(e) => setF({ ...f, query: e.target.value })} />
        <div className="chips">{CUBE_GROUPS.map((g) => <PillChip key={g} label={CUBE_GROUP_LABELS[g]} selected={f.groups?.includes(g)} onClick={() => setF({ ...f, groups: toggleIn(f.groups, g) })} />)}</div>
        <div className="chips">{RARITIES.map((r) => <PillChip key={r} label={r[0].toUpperCase() + r.slice(1)} selected={f.rarities?.includes(r)} onClick={() => setF({ ...f, rarities: toggleIn(f.rarities, r) })} />)}</div>
        <div className="cube-two">
          <input className="input" placeholder="Type" value={f.type ?? ''} onChange={(e) => setF({ ...f, type: e.target.value })} />
          <input className="input" placeholder="Set code" value={f.set ?? ''} onChange={(e) => setF({ ...f, set: e.target.value })} />
        </div>
        <div className="cube-two">
          <input className="input" placeholder="Min $" inputMode="decimal" value={minText} onChange={(e) => setMin(e.target.value)} />
          <input className="input" placeholder="Max $" inputMode="decimal" value={maxText} onChange={(e) => setMax(e.target.value)} />
        </div>
        <div className="cube-box-name">
          <span className="dim">{shown.length} of your cards</span>
          <button type="button" className="btn-link" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((e) => e.scryfallId)))}>{shown.length > 0 && picked.size === shown.length ? 'Untick all' : 'Tick all'}</button>
        </div>
        <div className="cube-pick-list">
          {shown.map((e) => (
            <label key={e.scryfallId} className="cube-pull-row">
              <input type="checkbox" checked={picked.has(e.scryfallId)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(e.scryfallId)) n.delete(e.scryfallId); else n.add(e.scryfallId); return n })} />
              <span><b>{e.name}</b>{cardOf(e.scryfallId)?.prices?.usd && <small>${cardOf(e.scryfallId)?.prices?.usd}</small>}</span>
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

function FillDialog({ suggestions, unknown, onDismiss, onAdd }: { suggestions: CubeCard[]; unknown: number; onDismiss: () => void; onAdd: (picked: CubeCard[]) => void }) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const chosen = suggestions.filter((c) => !off.has(c.id))
  return (
    <Dialog
      title="Fill from collection"
      onDismiss={onDismiss}
      actions={<>
        <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
        <button type="button" className="btn gold" disabled={chosen.length === 0} onClick={() => onAdd(chosen)}>Add {cardsWord(chosen.length)}</button>
      </>}
    >
      <p className="cube-small">
        {suggestions.length === 0
          ? `Nothing to suggest: the cube is full, its colours are at their targets, or none of your cards fits.${unknown > 0 ? ' Some cards are still being looked up.' : ''}`
          : 'Your cards for the colours that are short, a colour at a time, the rarest and dearest first. Untick any you’d rather not.'}
      </p>
      <div className="cube-pick-list">
        {suggestions.map((c) => (
          <label key={c.id} className="cube-pull-row">
            <input type="checkbox" checked={!off.has(c.id)} onChange={() => setOff((o) => { const n = new Set(o); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })} />
            <span><b>{c.name}</b><small>{CUBE_GROUP_LABELS[cubeGroupOf(c)]}</small></span>
          </label>
        ))}
      </div>
    </Dialog>
  )
}

/** Any card, from Scryfall: one not owned goes in flagged "Not owned", to be bought or proxied. */
function SearchCardsDialog({ cube, onDismiss, onAdd }: { cube: Deck; onDismiss: () => void; onAdd: (card: ScryfallCard) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryfallCard[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inCube = new Set(cube.cards.map((e) => e.name.toLowerCase()))
  const run = async () => {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try { setResults((await searchCards(query.trim())).cards.slice(0, 60)) } catch { setError('Couldn’t search — check your connection.') }
    setBusy(false)
  }
  return (
    <Dialog title="Add any card" onDismiss={onDismiss} actions={<button type="button" className="btn gold" onClick={onDismiss}>Done</button>}>
      <form className="cube-two" onSubmit={(e) => { e.preventDefault(); void run() }}>
        <input className="input" placeholder="Name or Scryfall search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <button type="submit" className="btn line" disabled={busy}>Search</button>
      </form>
      <p className="dim cube-small">Cards you don’t own go in as “Not owned” — mark them as proxies, or buy them.</p>
      {error && <p className="cube-small" style={{ color: 'var(--error)' }}>{error}</p>}
      <div className="cube-pick-list">
        {results.map((c) => (
          <div key={c.id} className="cube-row">
            <span className="cube-row-main"><b>{c.name}</b><span className="dim">{[c.type_line, c.set?.toUpperCase()].filter(Boolean).join(' · ')}</span></span>
            {inCube.has(c.name.toLowerCase()) ? <span className="dim cube-small">In the cube</span> : <IconButton icon="add" label={`Add ${c.name}`} onClick={() => onAdd(c)} />}
          </div>
        ))}
      </div>
    </Dialog>
  )
}

/** "Import a list": pasted, or from a file — CubeCobra's plain text or CSV, or a "2 Name" list. */
function ImportDialog({ onDismiss, onFound }: { onDismiss: () => void; onFound: (cards: { card: ScryfallCard; quantity: number }[]) => { added: number; skipped: number } }) {
  const [text, setText] = useState('')
  const [stage, setStage] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ added: number; skipped: number; missing: string[] } | null>(null)
  const run = async () => {
    const lines = parseCubeList(text)
    if (lines.length === 0) { setResult({ added: 0, skipped: 0, missing: [] }); return }
    setStage({ done: 0, total: lines.length })
    try {
      const found = await resolveCardList(
        lines.map((l) => ({ quantity: l.qty, name: l.name, set: null, number: null, scryfallId: null, foil: false })),
        (done, total) => setStage({ done, total }),
      )
      const r = onFound(found.cards.map((c) => ({ card: c.card, quantity: c.quantity + c.foilQuantity })))
      setResult({ ...r, missing: found.missing })
    } catch {
      setResult({ added: 0, skipped: 0, missing: ['Couldn’t reach Scryfall — try again when you’re online.'] })
    }
    setStage(null)
  }
  const readFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > 5_000_000) return
    void file.text().then(setText)
  }
  let body: ReactNode
  if (stage) body = <p>Finding {stage.done} of {stage.total} cards…</p>
  else if (result) {
    body = <>
      <p>Added {cardsWord(result.added)}.{result.skipped > 0 ? ` ${cardsWord(result.skipped)} already in the cube left out.` : ''}</p>
      {result.missing.length > 0 && <p className="cube-small" style={{ color: 'var(--warn)' }}>Not found: {result.missing.join(', ')}</p>}
    </>
  } else {
    body = <>
      <p className="dim cube-small">Paste CubeCobra’s plain text (a card a line), its CSV export, or a list like “2 Lightning Bolt”.</p>
      <textarea className="input cube-paste" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Sol Ring\nLightning Bolt\n…'} />
      <label className="btn line"><Icon name="upload_file" />Load a file<input type="file" accept=".txt,.csv,text/plain,text/csv" hidden onChange={(e) => readFile(e.target.files?.[0])} /></label>
    </>
  }
  return (
    <Dialog
      title="Import a cube list"
      onDismiss={() => { if (!stage) onDismiss() }}
      actions={result
        ? <button type="button" className="btn gold" onClick={onDismiss}>Done</button>
        : <>
          <button type="button" className="btn line" disabled={!!stage} onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn gold" disabled={!text.trim() || !!stage} onClick={() => void run()}>Import</button>
        </>}
    >
      {body}
    </Dialog>
  )
}
