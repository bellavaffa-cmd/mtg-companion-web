// The All cards dashboard's Breakdown, folded away until asked for: the collection's value by set
// (the top eight and the rest), by colour, by rarity and by type, and the ten most valuable cards.
// A card opens its page. Mirrors the Android app's ui/collection/BreakdownPanel.kt.

import { useState } from 'react'
import { Icon } from '../components/Icon'
import { ArtImage, MANA, PillChip, rise, toArtCrop } from '../components/kit'
import { useMoney } from '../money/currency'
import { cardValue, type BreakdownCard, type CollectionBreakdown, type Slice } from './breakdown'

/** The colour buckets' own colours (see colorBucket). */
const COLOR_TINTS: Record<string, string> = {
  White: MANA.W, Blue: MANA.U, Black: MANA.B, Red: MANA.R, Green: MANA.G, Multicolor: '#D4AF37', Colorless: MANA.C,
}

const VIEWS = ['Sets', 'Colours', 'Rarity', 'Types', 'Most valuable'] as const
type View = (typeof VIEWS)[number]

export function BreakdownPanel({ breakdown, onViewCard }: { breakdown: CollectionBreakdown | null; onViewCard: (card: BreakdownCard) => void }) {
  const money = useMoney()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('Sets')
  return (
    <div className="panel rise breakdown" style={{ ...rise(2), marginTop: 12 }}>
      <button type="button" className="breakdown-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <b>Breakdown</b>
        <span className="dim">{breakdown ? 'Value by set, colour, rarity, type' : 'Working it out…'}</span>
        <Icon name={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} aria-label={open ? 'Hide breakdown' : 'Show breakdown'} />
      </button>
      {open && breakdown && (
        <div className="breakdown-body">
          <div className="chips">
            {VIEWS.map((v) => <PillChip key={v} label={v} selected={view === v} onClick={() => setView(v)} className="on-g2" />)}
          </div>
          {view === 'Sets' && <SliceBars slices={breakdown.bySet} total={breakdown.totalUsd} />}
          {view === 'Colours' && <SliceBars slices={breakdown.byColor} total={breakdown.totalUsd} tint={(l) => COLOR_TINTS[l]} />}
          {view === 'Rarity' && <SliceBars slices={breakdown.byRarity} total={breakdown.totalUsd} />}
          {view === 'Types' && <SliceBars slices={breakdown.byType} total={breakdown.totalUsd} />}
          {view === 'Most valuable' && (
            <div className="breakdown-top">
              {breakdown.mostValuable.length === 0 && <div className="dim">No prices for your cards yet.</div>}
              {breakdown.mostValuable.map((card, i) => (
                <button key={card.id} type="button" className="breakdown-card press" onClick={() => onViewCard(card)}>
                  <span className="breakdown-rank dim">{i + 1}</span>
                  <ArtImage className="breakdown-art" src={toArtCrop(card.imageUrl)} seed={card.name} />
                  <span className="breakdown-card-main">
                    <span className="breakdown-card-name">{card.name}</span>
                    <span className="dim breakdown-card-meta">
                      {[card.setName || null, card.copies > 1 ? `×${card.copies} at ${money.format(card.usd ?? 0)}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <b className="breakdown-card-value">{money.format(cardValue(card))}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One bar per slice, its length its share of the biggest, with its value, share and copies. */
function SliceBars({ slices, total, tint }: { slices: Slice[]; total: number; tint?: (label: string) => string | undefined }) {
  const money = useMoney()
  const most = Math.max(...slices.map((s) => s.usd), 0) || 1
  return (
    <div className="slice-bars">
      {slices.map((s) => (
        <div key={s.label} className="slice">
          <div className="slice-top">
            <span className="slice-label">{s.label}</span>
            <span className="dim slice-figures">{money.format(s.usd)}{total > 0 ? ` · ${Math.round((s.usd / total) * 100)}%` : ''} · {s.copies} cards</span>
          </div>
          <div className="slice-track">
            <span style={{ width: `${Math.min(1, Math.max(0.02, s.usd / most)) * 100}%`, background: tint?.(s.label) ?? 'var(--gold)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
