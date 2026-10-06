import { countAction } from '../usage/usage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { PillChip } from '../components/kit'
import { getCardsByIds } from '../api/scryfall'
import { useSync } from '../sync/SyncContext'
import { UNSORTED_COLLECTION_ID, type Collection, type CollectionEntry } from '../types/models'
import { buildCardListCsv, buildCardListText, parseCardList } from './cardListText'
import { resolveCardList, type ImportResult } from './importCards'
import { applyImportedPlaces, locationCounts, locationKey, suggestTargets, type LocationCount, type PlaceTarget } from './importPlaces'
import { placesOf, placeTree } from './storagePlaces'
import { noteImport } from './upkeepStore'

const fileName = (name: string, ext = 'txt') => `${name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'binder'}.${ext}`

/**
 * A binder as text for other apps: "Simple" is "4 Lightning Bolt" (everything reads it); "Exact
 * printing" adds "(CMR) 472" so the same art comes back. Foil copies get their own "*F*" line. "CSV"
 * is a collection file that keeps each card's printing, condition and language too — [csvEntries]
 * when the rows differ from the text's (All cards: each binder's copies a row of their own).
 */
export function ExportCollectionDialog({ collection, onDismiss, title = 'Export list', csvEntries }: {
  collection: Collection
  onDismiss: () => void
  title?: string
  csvEntries?: CollectionEntry[]
}) {
  const [format, setFormat] = useState<'simple' | 'exact' | 'csv'>('simple')
  const [printings, setPrintings] = useState<Map<string, { set: string; number: string }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { collections } = useSync()
  const csv = format === 'csv'
  const rows = csv ? csvEntries ?? collection.entries : collection.entries
  const needsPrintings = format !== 'simple'

  useEffect(() => {
    if (!needsPrintings || printings) return
    setLoading(true)
    getCardsByIds([...collection.entries, ...(csvEntries ?? [])].map((e) => e.scryfallId), true)
      .then((cards) => setPrintings(new Map(cards.filter((c) => c.set && c.collector_number).map((c) => [c.id, { set: c.set!, number: c.collector_number! }]))))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Something went wrong.'); setFormat('simple') })
      .finally(() => setLoading(false))
  }, [needsPrintings, printings, collection.entries, csvEntries])

  const text = rows.length === 0
    ? ''
    : csv
      ? buildCardListCsv(rows, printings ?? undefined, placesOf(collections))
      : buildCardListText(rows, format === 'exact' ? printings ?? undefined : undefined)
  const ready = !!text && !(needsPrintings && loading)
  const pick = (next: typeof format) => { setFormat(next); setCopied(false) }

  return (
    <Dialog
      title={title}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Close</button>
          <button
            type="button"
            className="btn line"
            disabled={!ready}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text + '\n'], { type: csv ? 'text/csv' : 'text/plain' }))
              const a = document.createElement('a')
              a.href = url
              a.download = fileName(collection.name, csv ? 'csv' : 'txt')
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Icon name="download" aria-hidden />{csv ? 'Save .csv' : 'Save .txt'}
          </button>
          <button
            type="button"
            className="btn gold"
            disabled={!ready}
            onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)) }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {csv
          ? "A collection file for Moxfield, ManaBox, Deckbox — with each card's printing, condition and language."
          : 'Paste it into Moxfield, Archidekt, ManaBox, TCGplayer — or this app on another device.'}
      </p>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        <PillChip label="Simple" selected={format === 'simple'} onClick={() => pick('simple')} className="on-g2" />
        <PillChip label="Exact printing" selected={format === 'exact'} onClick={() => pick('exact')} className="on-g2" />
        <PillChip label="CSV" selected={csv} onClick={() => pick('csv')} className="on-g2" />
      </div>
      {error && <div className="notice warn" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="decklist">{needsPrintings && loading ? 'Loading printings…' : text || 'This binder has no cards yet.'}</div>
    </Dialog>
  )
}

type Stage = { kind: 'edit' } | { kind: 'working'; done: number; total: number } | { kind: 'done'; added: number; foils: number; result: ImportResult }

/**
 * Adds a list of cards from another app — pasted, or a .txt/.csv file — to a binder. With no
 * [collection], the cards go to a new binder (named here) or — "No binder" — the Unsorted pile,
 * to be sorted into binders later.
 */
export function ImportCardsDialog({ collection, onDismiss, onCreated, startInNewBinder = true }: {
  collection?: Collection
  onDismiss: () => void
  onCreated?: (id: string) => void
  startInNewBinder?: boolean
}) {
  const { collections, createCollection, importIntoCollection, changeStorage } = useSync()
  const [newBinder, setNewBinder] = useState(startInNewBinder)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'edit' })
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const parsed = useMemo(() => parseCardList(text), [text])
  const count = parsed.lines.reduce((n, l) => n + l.quantity, 0)
  // Import with locations: each value of the list's location column, and where it goes (importPlaces.ts).
  const places = placesOf(collections)
  const counts = useMemo(() => locationCounts(parsed.lines), [parsed])
  const [picked, setPicked] = useState<Map<string, PlaceTarget>>(new Map())
  const suggested = useMemo(() => suggestTargets(counts, places), [counts, places])
  const targets = useMemo(() => new Map([...suggested].map(([k, t]) => [k, picked.get(k) ?? t])), [suggested, picked])

  const run = async () => {
    setError(null)
    setStage({ kind: 'working', done: 0, total: parsed.lines.length })
    try {
      const result = await resolveCardList(parsed.lines, (done, total) => setStage({ kind: 'working', done, total }))
      if (result.cards.length > 0) {
        const targetId = collection?.id ?? (newBinder ? createCollection(name.trim() || 'Imported', 'OWNED').id : UNSORTED_COLLECTION_ID)
        importIntoCollection(targetId, result.cards)
        const placements = result.cards.filter((c) => c.locations?.length).map((c) => ({ scryfallId: c.card.id, locations: c.locations! }))
        if (placements.length > 0) {
          const now = Date.now()
          changeStorage((c) => applyImportedPlaces(c, targetId, placements, targets, parsed.locationColumn, now, () => crypto.randomUUID()))
        }
        noteImport(result.cards.reduce((n, c) => n + c.quantity + c.foilQuantity, 0), targetId)
        countAction('cards_imported')
        if (!collection && newBinder) onCreated?.(targetId)
      }
      setStage({
        kind: 'done',
        added: result.cards.reduce((n, c) => n + c.quantity + c.foilQuantity, 0),
        foils: result.cards.reduce((n, c) => n + c.foilQuantity, 0),
        result,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStage({ kind: 'edit' })
    }
  }

  if (stage.kind === 'done') {
    return (
      <Dialog title="Import finished" onDismiss={onDismiss} actions={<button type="button" className="btn gold" onClick={onDismiss}>Done</button>}>
        <p style={{ marginTop: 0 }}>
          Added <b>{stage.added}</b> {stage.added === 1 ? 'card' : 'cards'}{stage.foils > 0 ? ` (${stage.foils} foil)` : ''} to {collection?.name ?? (newBinder ? name.trim() || 'Imported' : 'your collection (Unsorted)')}.
        </p>
        {stage.result.missing.length > 0 && (
          <>
            <p className="muted">Couldn't find {stage.result.missing.length === 1 ? 'this one' : `these ${stage.result.missing.length}`}:</p>
            <div className="decklist" style={{ maxHeight: 180 }}>{stage.result.missing.join('\n')}</div>
          </>
        )}
      </Dialog>
    )
  }

  const working = stage.kind === 'working'
  return (
    <Dialog
      title={collection ? `Import into ${collection.name}` : 'Import list'}
      onDismiss={() => { if (!working) onDismiss() }}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss} disabled={working}>Cancel</button>
          <button type="button" className="btn gold" disabled={working || parsed.lines.length === 0 || (!collection && newBinder && !name.trim())} onClick={() => void run()}>
            {working ? `Finding cards… ${stage.done}/${stage.total}` : count > 0 ? `Import ${count} ${count === 1 ? 'card' : 'cards'}` : 'Import'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Paste a list — one card per line, like <code>4 Lightning Bolt</code> or <code>1 Sol Ring (CMR) 472 *F*</code> — or choose a .txt or .csv export from ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer or Dragon Shield.
      </p>
      {!collection && (
        <div className="chips wrap" style={{ marginBottom: 10 }}>
          <PillChip label="No binder" selected={!newBinder} onClick={() => setNewBinder(false)} className="on-g2" />
          <PillChip label="New binder" selected={newBinder} onClick={() => setNewBinder(true)} className="on-g2" />
        </div>
      )}
      {!collection && !newBinder && (
        <p className="dim" style={{ marginTop: 0 }}>Cards go into Unsorted, on the Collection page. Move them into binders whenever you like.</p>
      )}
      {!collection && newBinder && (
        <>
          <label className="field-label" htmlFor="import-name" style={{ marginTop: 0 }}>Binder name</label>
          <input id="import-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My collection" disabled={working} />
        </>
      )}
      <label className="field-label" htmlFor="import-text">Cards</label>
      <textarea id="import-text" className="input import-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'4 Lightning Bolt\n1 Sol Ring (CMR) 472 *F*'} disabled={working} spellCheck={false} />
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn line sm" disabled={working} onClick={() => file.current?.click()}>
          <Icon name="upload_file" aria-hidden />Choose a file
        </button>
        <span className="dim" style={{ fontSize: 12.5 }}>
          {parsed.lines.length > 0 ? `${parsed.lines.length} ${parsed.lines.length === 1 ? 'line' : 'lines'} · ${count} ${count === 1 ? 'card' : 'cards'}` : ''}
          {parsed.skipped.length > 0 ? ` · ${parsed.skipped.length} unreadable` : ''}
        </span>
      </div>
      <input
        ref={file}
        type="file"
        accept=".txt,.csv,.dec,.dck,text/plain,text/csv"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > 5 * 1024 * 1024) { setError('That file is too big (5 MB at most).'); return }
          setText(await f.text())
          if (!collection && newBinder && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
        }}
      />
      {counts.length > 0 && (
        <ImportPlaces counts={counts} targets={targets} disabled={working} onPick={(key, t) => setPicked((m) => new Map(m).set(key, t))} />
      )}
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

/**
 * Import with locations: each value of the list's location column ("Binder 1", "Box R", blank) with
 * its copies, and where they go — one of the user's places, a new place, or no place yet.
 */
function ImportPlaces({ counts, targets, disabled, onPick }: {
  counts: LocationCount[]; targets: Map<string, PlaceTarget>; disabled: boolean; onPick: (key: string, t: PlaceTarget) => void
}) {
  const { collections } = useSync()
  const tree = placeTree(placesOf(collections))
  const valueOf = (t: PlaceTarget | undefined) => (t?.kind === 'place' ? `place:${t.placeId}` : t?.kind === 'new' ? 'new' : 'none')
  return (
    <div className="import-places">
      <b>Import with locations</b>
      <p className="muted">We found a column that looks like where cards are kept. Match each value to a place.</p>
      {counts.map((c) => {
        const key = locationKey(c.value)
        return (
          <div key={key || '(blank)'} className="import-place-row">
            <span className="v">{c.value ? `“${c.value}”` : 'Blank'}</span>
            <span className="n">{c.copies.toLocaleString('en-GB')}</span>
            <select
              className="input"
              aria-label={`Where ${c.value || 'blank'} goes`}
              value={valueOf(targets.get(key))}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value
                onPick(key, v === 'new' ? { kind: 'new' } : v === 'none' ? { kind: 'none' } : { kind: 'place', placeId: v.slice('place:'.length) })
              }}
            >
              <option value="none">No place yet</option>
              {c.value && <option value="new">Make a new place</option>}
              {tree.map((n) => <option key={n.place.id} value={`place:${n.place.id}`}>{`→ ${' '.repeat(n.depth * 2)}${n.place.name}`}</option>)}
            </select>
          </div>
        )
      })}
      <p className="dim">Works with Manabind exports and other apps' CSV files that have a binder, box or location column. Exports now include places too.</p>
    </div>
  )
}
