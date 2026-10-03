import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { PillChip } from './kit'
import { getCardsByIds } from '../api/scryfall'
import { DECK_EXPORT_FORMATS, DECK_EXPORT_HINTS, DECK_EXPORT_LABELS, deckExportText, needsPrintings, type DeckExportFormat } from '../decks/deckExport'
import type { Deck } from '../types/models'

/**
 * Export list: the deck as text in one of four shapes (decks/deckExport.ts) — Simple ("1 Sol Ring",
 * what nearly everything reads), Exact printing (with "(SET) number", so the art survives), Arena and
 * MTGO. The printings are looked up the first time a format needs them. The Android app's ExportDialog.
 */
export function ExportDeckDialog({ deck, onDismiss }: { deck: Deck; onDismiss: () => void }) {
  const [format, setFormat] = useState<DeckExportFormat>('SIMPLE')
  const [printings, setPrintings] = useState<Map<string, [string, string]> | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const wantsPrintings = needsPrintings(format)

  useEffect(() => {
    if (!wantsPrintings || printings) return
    setLoading(true)
    const ids = [...new Set([deck.commander, deck.partnerCommander, ...deck.cards, ...(deck.sideboard ?? [])].flatMap((e) => (e ? [e.scryfallId] : [])))]
    getCardsByIds(ids)
      .then((cards) => setPrintings(new Map(cards.flatMap((c) => (c.set && c.collector_number ? [[c.id, [c.set, c.collector_number] as [string, string]]] : [])))))
      .catch(() => setPrintings(new Map()))
      .finally(() => setLoading(false))
  }, [wantsPrintings, printings, deck])

  const busy = wantsPrintings && loading
  const decklist = deckExportText(deck, format, wantsPrintings ? printings ?? new Map() : new Map())

  return (
    <Dialog
      title="Export list"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Close</button>
          <button
            type="button"
            className="btn gold"
            disabled={!decklist || busy}
            onClick={() => {
              navigator.clipboard.writeText(decklist)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy decklist'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{DECK_EXPORT_HINTS[format]}</p>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        {DECK_EXPORT_FORMATS.map((f) => (
          <PillChip key={f} label={DECK_EXPORT_LABELS[f]} selected={format === f} onClick={() => { setFormat(f); setCopied(false) }} className="on-g2" />
        ))}
      </div>
      <div className="decklist">{busy ? 'Loading printings…' : decklist || 'This deck has no cards yet.'}</div>
    </Dialog>
  )
}
