import type { ReactNode } from 'react'
import { useMoney } from '../money/currency'
import {
  activeFilterCount, FINISHES, NO_FILTERS, RARITIES, SORT_OPTIONS, WUBRG,
  type ManaColor, type SearchFilters, type SearchSort,
} from '../search/filters'
import { Icon } from './Icon'
import { ManaSymbol } from './ManaSymbols'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Search filters and sort, as on the phone app's search screen — folded away until opened. */
export function SearchFiltersPanel({
  filters, onChange, sort, onSortChange, open, onToggle,
}: {
  filters: SearchFilters
  /** Takes an update, so several changes in a row each build on the last. */
  onChange: (update: (f: SearchFilters) => SearchFilters) => void
  sort: SearchSort
  onSortChange: (s: SearchSort) => void
  open: boolean
  onToggle: () => void
}) {
  const money = useMoney()
  const count = activeFilterCount(filters)
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => onChange((f) => ({ ...f, [key]: value }))
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

  return (
    <div className="sf">
      <div className="sf-bar">
        <button type="button" className="chip" aria-pressed={open} aria-expanded={open} onClick={onToggle}>
          <Icon name="tune" />Filters{count ? <span className="n">{count}</span> : null}
        </button>
        <select
          className="input sf-sort"
          aria-label="Sort by"
          value={sort.order ?? ''}
          onChange={(e) => onSortChange({ ...sort, order: e.target.value || null })}
        >
          {SORT_OPTIONS.map((o) => <option key={o.label} value={o.order ?? ''}>{o.order ? `Sort: ${o.label}` : 'Sort: Relevance'}</option>)}
        </select>
        {sort.order && (
          <button
            type="button"
            className="chip"
            onClick={() => onSortChange({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={sort.dir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}
          >
            <Icon name={sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'} />{sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        )}
        {count > 0 && (
          <button type="button" className="chip" onClick={() => onChange(() => NO_FILTERS)}>
            <Icon name="close" />Clear
          </button>
        )}
      </div>

      {open && (
        <div className="sf-panel">
          <Row label="Type">
            <input className="input" value={filters.typeLine} onChange={(e) => set('typeLine', e.target.value)} placeholder="e.g. legendary creature" />
          </Row>
          <Row label="Rules text">
            <input className="input" value={filters.oracle} onChange={(e) => set('oracle', e.target.value)} placeholder="e.g. draw a card" />
          </Row>
          <Row label="Colors (at least)">
            <ColorPicker value={filters.colors} onToggle={(c) => onChange((f) => ({ ...f, colors: toggle(f.colors, c) }))} />
          </Row>
          <Row label="Fits commander colors">
            <ColorPicker value={filters.colorIdentity} onToggle={(c) => onChange((f) => ({ ...f, colorIdentity: toggle(f.colorIdentity, c) }))} />
          </Row>
          <Row label="Rarity">
            <div className="chips wrap">
              {RARITIES.map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={filters.rarities.includes(r)} onClick={() => onChange((f) => ({ ...f, rarities: toggle(f.rarities, r) }))}>{cap(r)}</button>
              ))}
            </div>
          </Row>
          <Row label="Finish">
            <div className="chips wrap">
              {FINISHES.map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filters.finishes.includes(f)} onClick={() => onChange((prev) => ({ ...prev, finishes: toggle(prev.finishes, f) }))}>
                  {f === 'nonfoil' ? 'Non-foil' : cap(f)}
                </button>
              ))}
            </div>
          </Row>
          <Row label={`Price (${money.currency.code})`}>
            <Range min={filters.priceMin} max={filters.priceMax} onMin={(v) => set('priceMin', v)} onMax={(v) => set('priceMax', v)} step="0.01" />
          </Row>
          <Row label="Power">
            <Range min={filters.powerMin} max={filters.powerMax} onMin={(v) => set('powerMin', v)} onMax={(v) => set('powerMax', v)} />
          </Row>
          <Row label="Toughness">
            <Range min={filters.toughnessMin} max={filters.toughnessMax} onMin={(v) => set('toughnessMin', v)} onMax={(v) => set('toughnessMax', v)} />
          </Row>
          <Row label="Sets">
            <input className="input" value={filters.sets} onChange={(e) => set('sets', e.target.value)} placeholder="Set codes, e.g. mh3, ltr" />
          </Row>
          <Row label="Artist">
            <input className="input" value={filters.artist} onChange={(e) => set('artist', e.target.value)} placeholder="e.g. Rebecca Guay" />
          </Row>
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

function ColorPicker({ value, onToggle }: { value: ManaColor[]; onToggle: (c: ManaColor) => void }) {
  return (
    <div className="sf-colors">
      {WUBRG.map((c) => {
        const on = value.includes(c)
        return (
          <button
            key={c}
            type="button"
            className="sf-color"
            aria-pressed={on}
            aria-label={{ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[c]}
            onClick={() => onToggle(c)}
          >
            <ManaSymbol code={c} size={26} />
          </button>
        )
      })}
    </div>
  )
}

function Range({ min, max, onMin, onMax, step = '1' }: { min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; step?: string }) {
  return (
    <div className="sf-range">
      <input className="input" type="number" inputMode="decimal" step={step} value={min} onChange={(e) => onMin(e.target.value)} placeholder="Min" aria-label="Minimum" />
      <span>to</span>
      <input className="input" type="number" inputMode="decimal" step={step} value={max} onChange={(e) => onMax(e.target.value)} placeholder="Max" aria-label="Maximum" />
    </div>
  )
}
