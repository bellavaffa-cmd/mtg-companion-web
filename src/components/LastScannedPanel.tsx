// The card scanner's "Last scanned" panel: the card just scanned, docked under the camera until the next
// one — its picture, name and the details at its bottom left (set code · collector number · rarity ·
// language), how the scanner knew it, its price and copies, what you already own, and Change printing,
// Foil and Undo. The words are scan/scanCardPanel.ts's; the Android app's half is ui/scan/ScanCardPanel.kt.

import { useCallback, useMemo, useState } from 'react'
import { canBeFoil } from '../collection/addTo'
import type { Money } from '../money/currency'
import type { ScanRow } from '../scan/scanLog'
import {
  copiesInScan, ownedLine, ownedSummary, panelPrice, scanDetailsLine, scanHowLabel, scanIsGuess, scanPanelSpoken, type ScanHow,
} from '../scan/scanCardPanel'
import type { Collection, Deck } from '../types/models'
import { displayImageUrl } from '../types/scryfall'
import { Icon } from './Icon'
import './lastScanned.css'

const SHOW_KEY = 'mtgweb_scan_last_card'

/** Settings › Scanner › Show last scanned card: on unless switched off, kept in this browser. */
export function loadShowLastScanned(): boolean {
  try { return localStorage.getItem(SHOW_KEY) !== 'false' } catch { return true }
}

/** The setting, for Settings › Scanner. */
export function useShowLastScannedSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadShowLastScanned)
  const change = useCallback((next: boolean) => {
    setOn(next)
    try { localStorage.setItem(SHOW_KEY, String(next)) } catch { /* this visit only */ }
  }, [])
  return [on, change]
}

/** The scans made since the scanner opened (oldest first), and how each was identified. */
export interface PanelSession { rows: number[]; how: Record<number, ScanHow> }

/** The newest scan of the session still in the pile, or null before the first (or once all are undone). */
export function lastScanned(session: PanelSession, pile: ScanRow[]): ScanRow | null {
  for (let i = session.rows.length - 1; i >= 0; i--) {
    const row = pile.find((s) => s.id === session.rows[i])
    if (row) return row
  }
  return null
}

const thumbOf = (row: ScanRow) => row.card.image_uris?.small ?? row.card.card_faces?.[0]?.image_uris?.small ?? displayImageUrl(row.card)

/**
 * The panel in one breath for a screen reader — "Forest, FIN 306, basic land, English, $0.40". The scan
 * page keeps it in a polite live region that's always there, so the first card is read out too.
 */
export function lastScannedSpoken(row: ScanRow, how: ScanHow | undefined, money: Money): string {
  const card = row.card
  const price = money.formatPrice(panelPrice(card.prices?.usd, card.prices?.usd_foil, row.foil))
  return scanPanelSpoken(card.name, card.set, card.collector_number, card.rarity, card.type_line, card.lang, row.foil, price, scanIsGuess(how, !!row.exact))
}

interface Props {
  row: ScanRow
  pile: ScanRow[]
  how: ScanHow | undefined
  collections: Collection[]
  decks: Deck[]
  money: Money
  onOpen: () => void
  onChangePrinting: () => void
  onUndo: () => void
  onFoil: () => void
}

export function LastScannedPanel({ row, pile, how, collections, decks, money, onOpen, onChangePrinting, onUndo, onFoil }: Props) {
  const card = row.card
  const exact = !!row.exact
  const guess = scanIsGuess(how, exact)
  const label = scanHowLabel(how, exact)
  const price = money.formatPrice(panelPrice(card.prices?.usd, card.prices?.usd_foil, row.foil))
  const details = scanDetailsLine(card.set, card.collector_number, card.rarity, card.type_line, card.lang, row.foil)
  const spoken = lastScannedSpoken(row, how, money)
  const copies = pile.filter((s) => s.card.id === card.id).length
  // You own N: once per card and library change, not every frame.
  const owned = useMemo(() => ownedLine(ownedSummary(collections, decks, card.id, card.name)), [collections, decks, card.id, card.name])
  return (
    <section className={`last-scanned${guess ? ' guess' : ''}`} aria-label="Last scanned card">
      {/* Keyed by the scan, so the next card slides in (not with reduced motion: lastScanned.css). */}
      <div className="last-scanned-body" key={row.id}>
      <button type="button" className="last-scanned-open" onClick={onOpen} aria-label={`${spoken} — card details`}>
        <img className="last-scanned-thumb" src={thumbOf(row) ?? undefined} alt="" loading="lazy" />
        <span className="last-scanned-text" aria-hidden>
          <span className="last-scanned-name">
            <b>{card.name}</b>
            {label && <span className={`last-scanned-how${guess ? ' guess' : ''}`}>{label}</span>}
          </span>
          <span className="last-scanned-details">{details}</span>
          <span className="last-scanned-meta">{[card.set_name, price, copiesInScan(copies)].filter(Boolean).join(' · ')}</span>
          <span className="last-scanned-owned">{owned}</span>
        </span>
      </button>
      <div className="last-scanned-actions">
        {canBeFoil(card) && (
          <button type="button" className={`ib${row.foil ? ' on' : ''}`} aria-pressed={row.foil} aria-label="Foil" title="Foil" onClick={onFoil}>
            <Icon name="auto_awesome" aria-hidden />
          </button>
        )}
        <button type="button" className="ib" aria-label="Change printing" title="Change printing" onClick={onChangePrinting}>
          <Icon name="swap_horiz" aria-hidden />
        </button>
        <button type="button" className="ib" aria-label="Undo this scan" title="Undo this scan" onClick={onUndo}>
          <Icon name="undo" aria-hidden />
        </button>
      </div>
      </div>
    </section>
  )
}
