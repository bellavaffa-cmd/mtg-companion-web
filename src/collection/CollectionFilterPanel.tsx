// The All cards filter's controls, shown under the search field while opened — the look of
// Search's filter panel, the fields of the Android app's CollectionFilterPanel.

import type { ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { ManaSymbol } from '../components/ManaSymbols'
import {
  COLLECTION_FILTER_RARITIES, filterActive, NO_COLLECTION_FILTER,
  type CollectionFilter, type FilterColor,
} from './cardFilter'

const WUBRG: FilterColor[] = ['W', 'U', 'B', 'R', 'G']
const COLOR_NAMES: Record<FilterColor, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

export function CollectionFilterPanel({ filter, onChange }: { filter: CollectionFilter; onChange: (f: CollectionFilter) => void }) {
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
      {filterActive(filter) && (
        <div className="sf-row">
          <button type="button" className="chip" onClick={() => onChange(NO_COLLECTION_FILTER)}><Icon name="close" />Clear filters</button>
        </div>
      )}
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
