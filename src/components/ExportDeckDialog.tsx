import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { PillChip } from './kit'
import { getCardsByIds } from '../api/scryfall'
import type { ScryfallCard } from '../types/scryfall'
import type { Deck, DeckCardEntry } from '../types/models'

/**
 * "Simple" is "qty name" per line — the most broadly compatible format (Moxfield, Archidekt,
 * TappedOut, MTG Arena, MTGO all read it). "Exact printing" appends "(SET) collector-number",
 * the same "(SLD) 1962" shape decklist importers (including this app's own Android importer)
 * already parse — preserving which specific art/printing each card was on round-trip import.
 */
function buildDecklistText(deck: Deck, cardsById: Map<string, ScryfallCard> | null, exact: boolean): string {
  const lines: string[] = []
  const line = (entry: DeckCardEntry) => {
    if (exact && cardsById) {
      const card = cardsById.get(entry.scryfallId)
      if (card?.set && card.collector_number) {
        lines.push(`${entry.quantity} ${entry.name} (${card.set.toUpperCase()}) ${card.collector_number}`)
        return
      }
    }
    lines.push(`${entry.quantity} ${entry.name}`)
  }
  if (deck.commander) line(deck.commander)
  if (deck.partnerCommander) line(deck.partnerCommander)
  const commanderIds = new Set([deck.commander?.scryfallId, deck.partnerCommander?.scryfallId].filter(Boolean))
  deck.cards
    .filter((c) => !commanderIds.has(c.scryfallId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(line)
  return lines.join('\n')
}

export function ExportDeckDialog({ deck, onDismiss }: { deck: Deck; onDismiss: () => void }) {
  const [exact, setExact] = useState(false)
  const [cardsById, setCardsById] = useState<Map<string, ScryfallCard> | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!exact || cardsById) return
    setLoading(true)
    getCardsByIds(deck.cards.map((c) => c.scryfallId))
      .then((cards) => setCardsById(new Map(cards.map((c) => [c.id, c]))))
      .finally(() => setLoading(false))
  }, [exact, cardsById, deck.cards])

  const decklist = buildDecklistText(deck, cardsById, exact)

  return (
    <Dialog
      title="Export decklist"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Close</button>
          <button
            type="button"
            className="btn gold"
            disabled={!decklist || (exact && loading)}
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
      <p className="muted" style={{ marginTop: 0 }}>Paste it into Moxfield, Archidekt, Arena or the Android app's importer.</p>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        <PillChip label="Simple" selected={!exact} onClick={() => { setExact(false); setCopied(false) }} className="on-g2" />
        <PillChip label="Exact printing" selected={exact} onClick={() => { setExact(true); setCopied(false) }} className="on-g2" />
      </div>
      <div className="decklist">{exact && loading ? 'Loading printings…' : decklist || 'This deck has no cards yet.'}</div>
    </Dialog>
  )
}
