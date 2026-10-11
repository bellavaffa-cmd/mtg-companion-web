// The Cards tab's filters, for what's in storage: the filter button (with its badge), the filter panel
// and Spares only while it's open, the chips for what's on (each removable, and one Clear) once it's
// shut, and the Advanced filters page with its saved filters — on a place's page and the Storage tab.
// The rules are placeFilter.ts's; the Android app's PlaceFilterUi.kt.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ArtImage, PillChip, toArtCrop } from '../components/kit'
import { useMoney } from '../money/currency'
import { useSync } from '../sync/SyncContext'
import type { ScryfallCard } from '../types/scryfall'
import type { StoragePlace } from '../types/models'
import { AdvancedFilterPage } from './AdvancedFilterPage'
import type { AdvancedFilter } from './advancedFilter'
import type { CollectionFilter } from './cardFilter'
import { ActiveFilterChips, CollectionFilterPanel } from './CollectionFilterPanel'
import { placeLink } from './collectionLayout'
import { LocationChips } from './LocationChips'
import { cardsFilterActive, cardsFilterChips, copyChip, removeCardsFilterChip, MISFITS_CHIP, NO_CARDS_FILTER, type CardsFilter } from './placeFilter'
import { hasRule } from './storageRules'
import type { CopyGroup } from './pullList'
import { placeTree, placesOf } from './storagePlaces'
import { allUserTags } from './userTags'
import { isWishlist } from './wishlist'

/** The filter button by a search field: "Filters, 2 on". */
export function FilterButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`ib filter-ib${count > 0 || open ? ' on' : ''}`}
      aria-expanded={open}
      aria-label={count > 0 ? `Filters, ${count} on` : 'Filters'}
      title={count > 0 ? `Filters, ${count} on` : 'Filters'}
      onClick={onClick}
    >
      <Icon name="filter_list" />
      {count > 0 && <span className="filter-badge" aria-hidden>{count}</span>}
    </button>
  )
}

/**
 * Under the search: while [open], the filter panel and Spares only; once shut, a chip for each thing
 * on and Clear. The Advanced filters page opens from the panel; its "Show N cards" counts with
 * [countFor] (copies), and its saved filters are the Cards tab's.
 */
export function CardsFilterControls({ filter, onChange, open, countFor, data }: {
  filter: CardsFilter
  onChange: (f: CardsFilter) => void
  open: boolean
  countFor: (f: CardsFilter) => number
  data: Map<string, ScryfallCard> | undefined
}) {
  const { collections, decks } = useSync()
  // The user's own tags, offered in the panel's Tags row as on the Cards tab.
  const userTagOptions = useMemo(() => allUserTags(decks, collections).slice(0, 12), [decks, collections])
  const money = useMoney()
  const [advOpen, setAdvOpen] = useState(false)
  const places = placesOf(collections)
  const on = cardsFilterActive(filter)
  const clear = () => onChange(NO_CARDS_FILTER)
  const sets = useMemo(() => {
    const m = new Map<string, string>()
    if (data) for (const c of data.values()) if (c.set) m.set(c.set.toLowerCase(), c.set_name ?? c.set.toUpperCase())
    return [...m].map(([code, name]) => ({ code, name })).sort((x, y) => x.name.localeCompare(y.name))
  }, [data])
  const binders = collections.filter((c) => !isWishlist(c) && c.type !== 'WISHLIST').map((c) => ({ id: c.id, name: c.name })).sort((x, y) => x.name.localeCompare(y.name))
  return (
    <>
      {open && (
        <div className="rise" style={{ marginTop: 10 }}>
          <CollectionFilterPanel
            filter={filter.basic}
            onChange={(basic: CollectionFilter) => onChange({ ...filter, basic })}
            onAdvanced={() => setAdvOpen(true)}
            onClear={clear}
            anyOn={on}
            userTagOptions={userTagOptions}
          />
          <div className="chips" style={{ marginTop: 8 }}>
            <PillChip label="Spares only" icon="swap_horiz" selected={filter.sparesOnly} onClick={() => onChange({ ...filter, sparesOnly: !filter.sparesOnly })} />
            {/* Once a place has rules (storageRules.ts): the copies they say don't belong where they are. */}
            {places.some(hasRule) && (
              <PillChip label={MISFITS_CHIP} icon="rule" selected={!!filter.misfitsOnly} onClick={() => onChange({ ...filter, misfitsOnly: !filter.misfitsOnly })} />
            )}
          </div>
        </div>
      )}
      {!open && on && (
        <div style={{ marginTop: 10 }}>
          <ActiveFilterChips
            chips={cardsFilterChips(filter, {
              binderName: (id) => collections.find((c) => c.id === id)?.name,
              placeName: (id) => places.find((p) => p.id === id)?.name,
              formatLocal: (n) => money.formatLocal(n),
            })}
            onRemove={(key) => onChange(removeCardsFilterChip(filter, key))}
            onClear={clear}
            clearLabel="Clear"
          />
        </div>
      )}
      {advOpen && (
        <AdvancedFilterPage
          basic={filter.basic}
          advanced={filter.advanced}
          countFor={(basic: CollectionFilter, advanced: AdvancedFilter) => countFor({ ...filter, basic, advanced })}
          binders={binders}
          places={placeTree(places).map((n) => ({ id: n.place.id, name: n.place.name, depth: n.depth }))}
          sets={sets}
          onApply={(basic, advanced) => { onChange({ ...filter, basic, advanced }); setAdvOpen(false) }}
          onClose={() => setAdvOpen(false)}
        />
      )}
    </>
  )
}

/** Rows shown before "Show all": a big collection can match thousands. */
const SHOWN_ROWS = 200

/**
 * Copies found in storage, grouped by place › section (copiesByPlace): each row the card, its finish
 * and how many, and its place chip ("Red box › Red ×2") — tap the chip to open the place there.
 */
export function CopyGroups({ groups, places }: { groups: CopyGroup[]; places: StoragePlace[] }) {
  const navigate = useNavigate()
  const [all, setAll] = useState(false)
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])
  const rows = groups.reduce((n, g) => n + g.copies.length, 0)
  let left = all ? Infinity : SHOWN_ROWS
  return (
    <div className="copy-groups">
      {groups.map((g) => {
        if (left <= 0) return null
        const shown = g.copies.slice(0, left)
        left -= shown.length
        return (
          <section key={g.key} className="copy-group place-section open">
            <div className="place-section-h" style={{ cursor: 'default' }}>
              <div><h3>{g.title}</h3>{g.detail && <div className="detail">{g.detail}</div>}</div>
              <span>{g.copies.reduce((n, c) => n + c.line.qty, 0)}</span>
            </div>
            <div className="place-cards">
              {shown.map((c) => (
                <div key={`${c.collectionId}:${c.entry.scryfallId}:${c.line.placeId}:${c.line.section ?? ''}:${c.line.page ?? ''}:${c.line.slot ?? ''}:${c.line.foil ? 'f' : ''}`} className="copy-row" role="button" tabIndex={0}
                  onClick={() => navigate(`/card/${encodeURIComponent(c.entry.name)}?id=${c.entry.scryfallId}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/card/${encodeURIComponent(c.entry.name)}?id=${c.entry.scryfallId}`) }}>
                  <ArtImage className="thumb" src={toArtCrop(c.entry.imageUrl)} seed={c.entry.name} />
                  <span className="txt">
                    <span className="nm">{c.entry.name}{c.line.foil ? ' · foil' : ''}</span>
                    <LocationChips chips={[copyChip(c, byId.get(c.line.placeId))]} actions={{ onPlace: (id, section, page) => navigate(placeLink(id, section, page)) }} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        )
      })}
      {!all && rows > SHOWN_ROWS && (
        <button type="button" className="btn line block" onClick={() => setAll(true)}>Show all {rows.toLocaleString('en-GB')} rows</button>
      )}
    </div>
  )
}
