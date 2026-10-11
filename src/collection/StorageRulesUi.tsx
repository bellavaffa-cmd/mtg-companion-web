// The places' rules on screen (the logic is storageRules.ts): the rule editor inside the place dialog
// (what it holds, its sections, its order), the Rule order list to drag places into the order they're
// tried, and what doesn't belong in a place. Mirrors the Android app's StorageRulesUi.kt
// (ui/collection/StorageRulesUi.kt).

import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { PillChip } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import type { Collection } from '../types/models'
import { AdvancedFilterPage } from './AdvancedFilterPage'
import { NO_ADVANCED_FILTER, advancedActive, type AdvancedFilter } from './advancedFilter'
import { NO_COLLECTION_FILTER, filterActive, type CollectionFilter } from './cardFilter'
import { CollectionFilterPanel } from './CollectionFilterPanel'
import { useSavedFilters } from './savedFilters'
import { LEVEL_BYS, LEVEL_LABELS, splitLevel, type LevelBy, type SplitLevel } from './sortRecipes'
import {
  SORT_BY_CHOICES, holdsMatch, holdsSummary, movedInOrder, placeOrderOf, rulePlaces, rulesLine, withPlaceOrder,
  type Holds, type Misfit, type RuleCard,
} from './storageRules'
import { placeTree, placesOf, type Spot } from './storagePlaces'
import { allUserTags } from './userTags'
import { isWishlist } from './wishlist'
import { PLACE_ICONS } from './StorageTab'
import { levelOptionsText, withLevelOptions } from './storageRulesView'

const OPTIONS_LABEL: Partial<Record<LevelBy, string>> = {
  VALUE: 'Price bands start at, in US dollars (highest first)',
  MANA_VALUE: 'Mana value sections start at',
  NUMBER: 'Number sections start at',
  NAME: 'Letter sections start at',
  SET: 'Sets with a section each (blank: one per set)',
}

/**
 * The rule editor in the place dialog: "Holds" (Everything, Choose… or a saved filter), and — for
 * anything but a binder — "Sections by" and "Then sorted by". The warnings below say which places'
 * rules overlap, with a way to Rule order.
 */
export function RulesFields({ isBinder, holds, onHolds, level, onLevel, sortKey, onSortKey, overlaps, onRuleOrder, onChooseHolds }: {
  isBinder: boolean
  holds: Holds | null
  onHolds: (h: Holds | null) => void
  level: SplitLevel | null
  onLevel: (l: SplitLevel | null) => void
  sortKey: string
  onSortKey: (k: string) => void
  overlaps: string[]
  onRuleOrder?: () => void
  onChooseHolds: () => void
}) {
  const { collections } = useSync()
  const { saved } = useSavedFilters()
  const places = placesOf(collections)
  const [optionsText, setOptionsText] = useState(levelOptionsText(level))
  const holdsLine = holds
    ? `Holds ${holdsSummary(holds.basic, holds.advanced, (id) => collections.find((c) => c.id === id)?.name, (id) => places.find((p) => p.id === id)?.name)}`
    : 'Everything'
  return (
    <>
      <div className="field-label" style={{ marginTop: 16 }}><b>Rules</b></div>
      <div className="field-label" style={{ marginTop: 8 }}>Holds</div>
      <div className="dim" style={{ marginBottom: 6 }}>{holdsLine}</div>
      <select
        className="input"
        aria-label="Holds"
        value=""
        onChange={(e) => {
          const v = e.target.value
          if (v === 'all') onHolds(null)
          else if (v === 'choose') onChooseHolds()
          else {
            const s = saved.find((x) => x.id === v)
            if (s) onHolds({ basic: s.basic, advanced: s.advanced })
          }
        }}
      >
        <option value="" disabled>{holds ? 'Change what it holds…' : 'Choose what it holds…'}</option>
        <option value="all">Everything</option>
        <option value="choose">{holds ? 'Change…' : 'Choose…'}</option>
        {saved.map((s) => <option key={s.id} value={s.id}>Saved filter: {s.name}</option>)}
      </select>
      {!isBinder && (
        <>
          <div className="field-label" style={{ marginTop: 12 }}>Sections by</div>
          <select
            className="input"
            aria-label="Sections by"
            value={level?.by ?? ''}
            onChange={(e) => {
              const by = e.target.value as LevelBy | ''
              const next = by ? splitLevel({ by, ...(by === 'COLOUR' ? { lands: true } : {}) }) : null
              setOptionsText(levelOptionsText(next))
              onLevel(next)
            }}
          >
            <option value="">None</option>
            {LEVEL_BYS.map((b) => <option key={b} value={b}>{LEVEL_LABELS[b]}</option>)}
          </select>
          {level?.by === 'COLOUR' && (
            <div className="chips" style={{ marginTop: 8 }}>
              <PillChip label="Lands get their own section" selected={!!level.lands} onClick={() => onLevel(splitLevel({ ...level, lands: !level.lands }))} />
            </div>
          )}
          {level && OPTIONS_LABEL[level.by] && (
            <>
              <div className="field-label" style={{ marginTop: 8 }}>{OPTIONS_LABEL[level.by]}</div>
              <input className="input" value={optionsText} onChange={(e) => { setOptionsText(e.target.value); onLevel(withLevelOptions(level, e.target.value)) }} />
            </>
          )}
          <div className="field-label" style={{ marginTop: 12 }}>Then sorted by</div>
          <select className="input" aria-label="Then sorted by" value={sortKey} onChange={(e) => onSortKey(e.target.value)}>
            <option value="">Not sorted</option>
            {SORT_BY_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </>
      )}
      {overlaps.length > 0 && (
        <div role="status" style={{ marginTop: 10 }}>
          {overlaps.map((line) => <div key={line} className="dim"><Icon name="warning" aria-hidden /> {line}</div>)}
          {onRuleOrder && <button type="button" className="link" onClick={onRuleOrder}>Rule order</button>}
        </div>
      )}
    </>
  )
}

/**
 * "Holds › Choose…": the Cards filter panel (type, text, colours, rarity, tags) and, behind it, the
 * Advanced filters — what the place holds. [cards]: the cards in storage as the rules judge them, for
 * how many fit.
 */
export function HoldsDialog({ holds, cards, onDone, onDismiss }: {
  holds: Holds | null
  cards: RuleCard[]
  onDone: (h: Holds | null) => void
  onDismiss: () => void
}) {
  const { collections, decks } = useSync()
  const [basic, setBasic] = useState<CollectionFilter>(holds?.basic ?? NO_COLLECTION_FILTER)
  const [advanced, setAdvanced] = useState<AdvancedFilter>(holds?.advanced ?? NO_ADVANCED_FILTER)
  const [advOpen, setAdvOpen] = useState(false)
  const userTagOptions = useMemo(() => allUserTags(decks, collections).slice(0, 12), [decks, collections])
  const places = placesOf(collections)
  const on = filterActive(basic) || advancedActive(advanced)
  const fit = cards.length > 0 && on ? cards.filter((c) => holdsMatch({ basic, advanced }, c)).length : null
  const sets = useMemo(() => [...new Set(cards.map((c) => c.advanced?.set).filter((s): s is string => !!s))].sort().map((code) => ({ code, name: code.toUpperCase() })), [cards])
  const binders = collections.filter((c) => !isWishlist(c) && c.type !== 'WISHLIST').map((c) => ({ id: c.id, name: c.name })).sort((x, y) => x.name.localeCompare(y.name))
  return (
    <>
      <Dialog
        title="What it holds"
        onDismiss={onDismiss}
        actions={
          <>
            <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
            <button type="button" className="btn gold" onClick={() => onDone(on ? { basic, advanced } : null)}>Done</button>
          </>
        }
      >
        <div>{on ? `Holds ${holdsSummary(basic, advanced, (id) => collections.find((c) => c.id === id)?.name, (id) => places.find((p) => p.id === id)?.name)}` : 'Holds everything'}</div>
        {fit !== null && <div className="dim" style={{ marginTop: 4 }}>{fit} of your cards in storage fit</div>}
        <div style={{ marginTop: 10 }}>
          <CollectionFilterPanel
            filter={basic}
            onChange={setBasic}
            onAdvanced={() => setAdvOpen(true)}
            onClear={() => { setBasic(NO_COLLECTION_FILTER); setAdvanced(NO_ADVANCED_FILTER) }}
            anyOn={on}
            userTagOptions={userTagOptions}
          />
        </div>
      </Dialog>
      {advOpen && (
        <AdvancedFilterPage
          basic={basic}
          advanced={advanced}
          countFor={(b, a) => cards.filter((c) => holdsMatch({ basic: b, advanced: a }, c)).length}
          binders={binders}
          places={placeTree(places).map((n) => ({ id: n.place.id, name: n.place.name, depth: n.depth }))}
          sets={sets}
          onApply={(b, a) => { setBasic(b); setAdvanced(a); setAdvOpen(false) }}
          onClose={() => setAdvOpen(false)}
        />
      )}
    </>
  )
}

/**
 * Rule order: the places with rules, in the order they're tried — drag one, or use its arrows.
 * "When a card fits more than one place, it goes to the first one here."
 */
export function RuleOrderDialog({ onDismiss }: { onDismiss: () => void }) {
  const { collections, changeStorage } = useSync()
  const places = placesOf(collections)
  const ids = rulePlaces(places, placeOrderOf(collections)).map((p) => p.id)
  const [dragging, setDragging] = useState<string | null>(null)
  const move = (id: string, to: number) => changeStorage((c: Collection[]) => withPlaceOrder(c, movedInOrder(placesOf(c), placeOrderOf(c), id, to)))
  return (
    <Dialog title="Rule order" onDismiss={onDismiss} actions={<button type="button" className="btn gold" onClick={onDismiss}>Done</button>}>
      <div className="dim">When a card fits more than one place, it goes to the first one here.</div>
      {ids.length === 0 && <div className="dim" style={{ marginTop: 8 }}>No place has a rule yet. Change a place and say what it holds.</div>}
      <ol className="rule-order" style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
        {ids.map((id, i) => {
          const p = places.find((x) => x.id === id)!
          return (
            <li
              key={id}
              draggable
              onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { if (dragging) e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== id) move(dragging, i); setDragging(null) }}
              onDragEnd={() => setDragging(null)}
              className="storage-row"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', opacity: dragging === id ? 0.5 : 1, cursor: 'grab' }}
            >
              <Icon name="drag_indicator" aria-hidden />
              <b style={{ minWidth: 20 }}>{i + 1}</b>
              <Icon name={PLACE_ICONS[p.kind]} aria-hidden />
              <div className="storage-text" style={{ flex: 1 }}><b>{p.name}</b><span>{rulesLine(p) || 'Holds everything'}</span></div>
              <button type="button" className="ib" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(id, i - 1)}><Icon name="arrow_upward" /></button>
              <button type="button" className="ib" aria-label={`Move ${p.name} down`} disabled={i === ids.length - 1} onClick={() => move(id, i + 1)}><Icon name="arrow_downward" /></button>
            </li>
          )
        })}
      </ol>
    </Dialog>
  )
}

/**
 * What doesn't belong in a place by its rules: each line says where it belongs, with Move — and Move
 * all. [spotFor]: where in its new place a copy goes (suggestSpot).
 */
export function MisfitsDialog({ found, spotFor, onMove, onDismiss }: {
  found: Misfit[]
  spotFor: (m: Misfit) => Spot | null
  onMove: (moves: { misfit: Misfit; spot: Spot | null }[]) => void
  onDismiss: () => void
}) {
  const movable = found.filter((m) => m.to || m.section)
  return (
    <Dialog
      title="Doesn't fit the rules"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={onDismiss}>Close</button>
          {movable.length > 1 && <button type="button" className="btn gold" onClick={() => onMove(movable.map((m) => ({ misfit: m, spot: spotFor(m) })))}>Move all {movable.length}</button>}
        </>
      }
    >
      {found.length === 0 && <div className="dim">Everything here fits.</div>}
      {found.map((m) => (
        <div key={`${m.card.collectionId}|${m.card.entry.scryfallId}|${m.card.line.foil ? 'f' : ''}|${m.card.line.section ?? ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <div style={{ flex: 1 }}>
            <div>{m.card.entry.name}{m.card.line.foil ? ' · foil' : ''} ×{m.card.line.qty}</div>
            <div className="dim">{m.line}</div>
          </div>
          {(m.to || m.section) && <button type="button" className="btn soft sm" onClick={() => onMove([{ misfit: m, spot: spotFor(m) }])}>Move</button>}
        </div>
      ))}
    </Dialog>
  )
}

