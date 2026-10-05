// The All cards filter's controls, shown under the search field while opened — the look of
// Search's filter panel, the fields of the Android app's CollectionFilterPanel. At the bottom, the
// way to the Advanced filters page (AdvancedFilterPage.tsx) and Clear; and, under the search field
// once the panel is shut, a removable chip for each filter on (ActiveFilterChips).

import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { ManaSymbol } from '../components/ManaSymbols'
import {
  COLLECTION_FILTER_RARITIES,
  type CollectionFilter, type FilterColor,
} from './cardFilter'
import { chipText, type FilterChip } from './advancedFilter'

const WUBRG: FilterColor[] = ['W', 'U', 'B', 'R', 'G']
const COLOR_NAMES: Record<FilterColor, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

export function CollectionFilterPanel({ filter, onChange, onAdvanced, onClear, anyOn }: {
  filter: CollectionFilter
  onChange: (f: CollectionFilter) => void
  /** Opens the Advanced filters page. */
  onAdvanced: () => void
  /** Clears these filters and the advanced ones; offered while [anyOn]. */
  onClear: () => void
  anyOn: boolean
}) {
  return (
    <div className="sf-panel collection-filter">
      {/* Named as in Search. */}
      <Row label="Type">
        <input className="input" value={filter.type} onChange={(e) => onChange({ ...filter, type: e.target.value })} placeholder="e.g. legendary creature" />
      </Row>
      <Row label="Text">
        <input className="input" value={filter.text} onChange={(e) => onChange({ ...filter, text: e.target.value })} placeholder="e.g. draw a card" />
      </Row>
      <Row label="Colors (at least)">
        <div className="sf-colors">
          {WUBRG.map((c) => (
            <button
              key={c}
              type="button"
              className="sf-color"
              aria-pressed={filter.colors.includes(c)}
              aria-label={COLOR_NAMES[c]}
              onClick={() => onChange({ ...filter, colors: toggle(filter.colors, c) })}
            >
              <ManaSymbol code={c} size={26} />
            </button>
          ))}
        </div>
      </Row>
      <Row label="Rarity">
        <div className="chips wrap">
          {COLLECTION_FILTER_RARITIES.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={filter.rarities.includes(r)} onClick={() => onChange({ ...filter, rarities: toggle(filter.rarities, r) })}>
              {cap(r)}
            </button>
          ))}
        </div>
      </Row>
      <div className="sf-row row" style={{ gap: 8 }}>
        <button type="button" className="btn line sm" onClick={onAdvanced}><Icon name="tune" aria-hidden />Advanced filters</button>
        {anyOn && <button type="button" className="chip" onClick={onClear}><Icon name="close" />Clear</button>}
      </div>
    </div>
  )
}

/** The filters on, a chip each — tap one to take it off — and Clear all. */
export function ActiveFilterChips({ chips, onRemove, onClear }: { chips: FilterChip[]; onRemove: (key: string) => void; onClear: () => void }) {
  return (
    <div className="chips wrap active-filters">
      {chips.map((c) => (
        <button key={c.key} type="button" className="chip" aria-pressed="true" aria-label={`Remove: ${chipText(c)}`} onClick={() => onRemove(c.key)}>
          {c.label}
          {c.symbols.map((s, i) => <ManaSymbol key={i} code={s} size={16} />)}
          <Icon name="close" />
        </button>
      ))}
      <button type="button" className="chip" onClick={onClear}>Clear all</button>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sf-row">
      <div className="field-label">{label}</div>
      {children}
    </div>
  )
}
