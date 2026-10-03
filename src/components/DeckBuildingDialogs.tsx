import { useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { ArtImage, toArtCrop } from './kit'
import type { ComboVariant } from '../api/relay'
import type { DeckCardEntry } from '../types/models'
import { breakText, swapOptions } from '../decks/considering'
import { hasSideboard } from '../decks/sideboard'
import { parseCardList } from '../collection/cardListText'
import { resolveCardList } from '../collection/importCards'
import { importSummary, splitBySection } from '../decks/deckImport'
import type { ScryfallCard } from '../types/scryfall'
import { changeSummary, recordText, versionDate, type VersionSummary } from '../decks/versions'

/**
 * Picks the other half of a swap: what a cut candidate is replaced with, or what a considered card
 * replaces. Cut candidates come first. The Android app's SwapPickerDialog.
 */
export function SwapPickerDialog({ title, message, options, onPick, onDismiss }: {
  title: string
  message: string
  options: DeckCardEntry[]
  onPick: (entry: DeckCardEntry) => void
  onDismiss: () => void
}) {
  return (
    <Dialog title={title} onDismiss={onDismiss} actions={<button type="button" className="btn line" onClick={onDismiss}>Cancel</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{message}</p>
      {options.length > 0 && (
        <div className="swap-pick">
          {swapOptions(options).map((entry) => (
            <button key={entry.scryfallId} type="button" className="swap-pick-row press" onClick={() => onPick(entry)}>
              <ArtImage className="swap-pick-art" src={toArtCrop(entry.imageUrl)} seed={entry.name} />
              <span className="swap-pick-name">{entry.name}</span>
              {entry.replaceable && <span className="badge cut"><Icon name="swap_horiz" />CUT</span>}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

/** Asked before a combo piece is marked as a cut candidate — cutting it would break those combos. */
export function ComboPieceWarningDialog({ name, combos, onConfirm, onDismiss }: {
  name: string
  combos: ComboVariant[]
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <Dialog
      title={`${name} is a combo piece`}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
          <button type="button" className="btn cut" onClick={onConfirm}>Mark anyway</button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{breakText(combos.length)}</p>
      <ul className="warn-combos">
        {combos.slice(0, 5).map((combo) => <li key={combo.id}>{combo.uses.map((u) => u.card.name).join(' + ')}</li>)}
      </ul>
      {combos.length > 5 && <div className="dim">…and {combos.length - 5} more</div>}
    </Dialog>
  )
}

type Stage = { kind: 'edit' } | { kind: 'working'; done: number; total: number } | { kind: 'done'; summary: string[] }

/**
 * "Import list" into a deck that already exists — pasted, or a .txt/.csv file. Cards are matched on
 * Scryfall; sideboard lines go into the sideboard for a format with one (onto Considering for
 * Commander and Brawl), maybeboard lines onto Considering. The Android app's ImportDialog, plus the
 * file picker the web's binder import has.
 */
export function DeckImportDialog({ mode, onImport, onDismiss }: {
  /** The deck's format, which says whether it has a sideboard. */
  mode: string
  /** Puts what was found into the deck; returns nothing — the summary is worked out here. */
  onImport: (cards: { card: ScryfallCard; quantity: number }[], considering: ScryfallCard[], sideboard: { card: ScryfallCard; quantity: number }[]) => void
  onDismiss: () => void
}) {
  const [text, setText] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'edit' })
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const parsed = parseCardList(text)
  const { main, sideboard, considering } = splitBySection(parsed.lines, mode)
  const lineCount = main.length + sideboard.length + considering.length

  const run = async () => {
    setError(null)
    const total = lineCount
    setStage({ kind: 'working', done: 0, total })
    try {
      // The deck's lines, the sideboard's and Considering's are looked up apart, so each card lands
      // where its line said.
      const mainResult = await resolveCardList(main, (done) => setStage({ kind: 'working', done, total }))
      const boardResult = await resolveCardList(sideboard, (done) => setStage({ kind: 'working', done: main.length + done, total }))
      const sideResult = await resolveCardList(considering, (done) => setStage({ kind: 'working', done: main.length + sideboard.length + done, total }))
      const copies = (r: typeof mainResult) => r.cards.map((c) => ({ card: c.card, quantity: c.quantity + c.foilQuantity }))
      const cards = copies(mainResult)
      const board = copies(boardResult)
      const side = sideResult.cards.map((c) => c.card)
      if (cards.length > 0 || side.length > 0 || board.length > 0) onImport(cards, side, board)
      const count = (list: { quantity: number }[]) => list.reduce((n, c) => n + c.quantity, 0)
      setStage({
        kind: 'done',
        summary: importSummary(
          count(cards),
          sideResult.cards.reduce((n, c) => n + c.quantity + c.foilQuantity, 0),
          count(board),
          [...mainResult.missing, ...boardResult.missing, ...sideResult.missing],
        ),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStage({ kind: 'edit' })
    }
  }

  if (stage.kind === 'done') {
    return (
      <Dialog title="Import finished" onDismiss={onDismiss} actions={<button type="button" className="btn gold" onClick={onDismiss}>Done</button>}>
        {stage.summary.map((para, i) => (
          <p key={i} className={i === 0 ? '' : 'muted'} style={{ marginTop: i === 0 ? 0 : undefined, whiteSpace: 'pre-line' }}>{para}</p>
        ))}
      </Dialog>
    )
  }

  const working = stage.kind === 'working'
  return (
    <Dialog
      title="Import list"
      onDismiss={() => { if (!working) onDismiss() }}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss} disabled={working}>Cancel</button>
          <button type="button" className="btn gold" disabled={working || lineCount === 0} onClick={() => void run()}>
            {working ? `Finding cards… ${stage.done}/${stage.total}` : 'Import'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Paste a decklist — one card per line, e.g. <code>1 Sol Ring</code> — or choose a .txt or .csv file. Cards are matched on Scryfall and added to this deck; {hasSideboard(mode) ? 'sideboard cards go to its sideboard, maybeboard cards to Considering.' : 'sideboard and maybeboard cards go to Considering.'}
      </p>
      <label className="field-label" htmlFor="deck-import-text">Cards</label>
      <textarea
        id="deck-import-text" className="input import-text" rows={8} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'1 Sol Ring\n1 Arcane Signet\n…'} disabled={working} spellCheck={false}
      />
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn line sm" disabled={working} onClick={() => file.current?.click()}>
          <Icon name="upload_file" aria-hidden />Choose a file
        </button>
        <span className="dim" style={{ fontSize: 12.5 }}>
          {lineCount > 0 ? `${main.length} for the deck${sideboard.length > 0 ? ` · ${sideboard.length} for the sideboard` : ''}${considering.length > 0 ? ` · ${considering.length} for Considering` : ''}` : ''}
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
        }}
      />
      {error && <div className="notice warn" style={{ marginTop: 10 }}>{error}</div>}
    </Dialog>
  )
}

/**
 * The deck's saved lists, newest first: when, what changed, and the record on each. The Android
 * app's VersionHistoryPanel; tapping one opens VersionDetailDialog.
 */
export function VersionHistoryPanel({ history, onOpen, index = 0 }: { history: VersionSummary[]; onOpen: (s: VersionSummary) => void; index?: number }) {
  return (
    <div className="panel rise" style={{ ['--i' as string]: index }}>
      <div className="p-h"><h3>Version history</h3>{history.length > 0 && <span className="p-sub">Saved<b>{history.length}</b></span>}</div>
      {history.length === 0 ? (
        <div className="dim">Each time you change this deck's list, the new list is saved here as a version — with what changed and how it did in games you log.</div>
      ) : (
        <>
          <div className="version-list">
            {history.slice(0, 12).map((s, i) => (
              <button key={s.version.id} type="button" className="version-row press" onClick={() => onOpen(s)}>
                <span className="version-main">
                  <span className="version-when">{i === 0 ? `Current · ${versionDate(s.version.savedAt)}` : versionDate(s.version.savedAt)}</span>
                  <span className="version-what">{changeSummary(s)}</span>
                </span>
                {s.games > 0 && <b className="version-record">{recordText(s)}</b>}
              </button>
            ))}
          </div>
          <div className="dim" style={{ marginTop: 8 }}>Record = games logged while that version was the current list.</div>
        </>
      )}
    </div>
  )
}

/** One version: its record, and what it added and took out — or the whole list, for the first. */
export function VersionDetailDialog({ summary, onDismiss }: { summary: VersionSummary; onDismiss: () => void }) {
  const s = summary
  return (
    <Dialog title={versionDate(s.version.savedAt)} onDismiss={onDismiss} actions={<button type="button" className="btn gold" onClick={onDismiss}>Close</button>}>
      <div className="version-detail">
        {s.games > 0 && (
          <p className="version-rec">Record on this version: {recordText(s)} ({Math.floor((s.wins * 100) / s.games)}% wins)</p>
        )}
        {s.isBaseline ? (
          <>
            <div className="field-label" style={{ marginTop: 0 }}>The earliest saved list:</div>
            <div className="decklist">{Object.entries(s.version.cards).sort(([a], [b]) => a.localeCompare(b)).map(([name, q]) => `${q}  ${name}`).join('\n')}</div>
          </>
        ) : (
          <>
            {s.added.length > 0 && (
              <>
                <div className="field-label version-added" style={{ marginTop: 0 }}>Added</div>
                {s.added.map(([name, q]) => <div key={name}>+{q}  {name}</div>)}
              </>
            )}
            {s.removed.length > 0 && (
              <>
                <div className="field-label version-removed">Removed</div>
                {s.removed.map(([name, q]) => <div key={name}>−{q}  {name}</div>)}
              </>
            )}
            {s.added.length === 0 && s.removed.length === 0 && <p className="muted" style={{ margin: 0 }}>Only the commander changed.</p>}
          </>
        )}
        <div className="dim" style={{ marginTop: 10 }}>Commander: {s.version.commanders.join(' + ') || 'none'}</div>
      </div>
    </Dialog>
  )
}
