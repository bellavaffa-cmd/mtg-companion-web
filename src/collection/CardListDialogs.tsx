import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { PillChip } from '../components/kit'
import { getCardsByIds } from '../api/scryfall'
import { useSync } from '../sync/SyncContext'
import { UNSORTED_COLLECTION_ID, type Collection } from '../types/models'
import { buildCardListText, parseCardList } from './cardListText'
import { resolveCardList, type ImportResult } from './importCards'

const fileName = (name: string) => `${name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'binder'}.txt`

/**
 * A binder as text for other apps: "Simple" is "4 Lightning Bolt" (everything reads it); "Exact
 * printing" adds "(CMR) 472" so the same art comes back. Foil copies get their own "*F*" line.
 */
export function ExportCollectionDialog({ collection, onDismiss, title = 'Export binder' }: { collection: Collection; onDismiss: () => void; title?: string }) {
  const [exact, setExact] = useState(false)
  const [printings, setPrintings] = useState<Map<string, { set: string; number: string }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!exact || printings) return
    setLoading(true)
    getCardsByIds(collection.entries.map((e) => e.scryfallId), true)
      .then((cards) => setPrintings(new Map(cards.filter((c) => c.set && c.collector_number).map((c) => [c.id, { set: c.set!, number: c.collector_number! }]))))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Something went wrong.'); setExact(false) })
      .finally(() => setLoading(false))
  }, [exact, printings, collection.entries])

  const text = buildCardListText(collection.entries, exact ? printings ?? undefined : undefined)
  const ready = !!text && !(exact && loading)

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
              const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }))
              const a = document.createElement('a')
              a.href = url
              a.download = fileName(collection.name)
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Icon name="download" aria-hidden />Save .txt
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
      <p className="muted" style={{ marginTop: 0 }}>Paste it into Moxfield, Archidekt, ManaBox, TCGplayer — or this app on another device.</p>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        <PillChip label="Simple" selected={!exact} onClick={() => { setExact(false); setCopied(false) }} className="on-g2" />
        <PillChip label="Exact printing" selected={exact} onClick={() => { setExact(true); setCopied(false) }} className="on-g2" />
      </div>
      {error && <div className="notice warn" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="decklist">{exact && loading ? 'Loading printings…' : text || 'This binder has no cards yet.'}</div>
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
  const { createCollection, importIntoCollection } = useSync()
  const [newBinder, setNewBinder] = useState(startInNewBinder)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'edit' })
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const parsed = parseCardList(text)
  const count = parsed.lines.reduce((n, l) => n + l.quantity, 0)

  const run = async () => {
    setError(null)
    setStage({ kind: 'working', done: 0, total: parsed.lines.length })
    try {
      const result = await resolveCardList(parsed.lines, (done, total) => setStage({ kind: 'working', done, total }))
      if (result.cards.length > 0) {
        const targetId = collection?.id ?? (newBinder ? createCollection(name.trim() || 'Imported', 'OWNED').id : UNSORTED_COLLECTION_ID)
        importIntoCollection(targetId, result.cards)
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
      title={collection ? `Import into ${collection.name}` : 'Import cards'}
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
        Paste a list — one card per line, like <code>4 Lightning Bolt</code> or <code>1 Sol Ring (CMR) 472 *F*</code> — or choose a .txt or .csv export from Moxfield, ManaBox, Archidekt, Deckbox or TCGplayer.
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
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}
