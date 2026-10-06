// Sorting a new pile, in the scanner (ScanPage.tsx's ?sort mode): the big coloured tile for the card
// just scanned — its pile's number, where that pile goes, the card, its rarity and price — the piles so
// far, the piles' rules (Piles…) and "Done: file every pile". The logic is sortPiles.ts. Mirrors the
// Android app's SortPanel.kt (ui/scan/SortPanel.kt).

import { useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { placeTree, placesOf } from './storagePlaces'
import { overflowLine, overflows, pileAdds } from './boxSpace'
import {
  BY_RULE, defaultPiles, MAX_PILES, MIN_PILES, PILE_KINDS, pileDestination, pileGoesTo, pileTallies, pileTitle, type PileKind, type PileRule, type SortSession,
} from './sortPiles'
import { PILE_COLOURS, savePiles } from './sortSession'
import './loans.css'
import './inventory.css'

const KIND_LABELS: Record<PileKind, string> = {
  VALUE: 'Rares and mythics worth over…',
  PRICE: 'Any card worth over…',
  SPARES: 'Spares: more than … owned',
  WANTED: 'Wanted by a deck',
  BULK: 'Bulk: everything else',
}

const RARITY: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic', special: 'Special', bonus: 'Bonus' }

export function SortPilePanel({ session, onChange, onDone }: { session: SortSession; onChange: (s: SortSession) => void; onDone: () => void }) {
  const { collections } = useSync()
  const money = useMoney()
  const [editing, setEditing] = useState(false)
  const last = session.scans.at(-1)
  const tallies = pileTallies(session)
  const fmt = (usd: number) => money.format(usd, usd >= 10)
  const lastRule = last ? session.rules[last.pile] : undefined
  const lastWhere = last && lastRule ? pileDestination(lastRule, last.facts, collections).label : null

  return (
    <>
      <div className="sort-head">
        <input className="input" value={session.source} onChange={(e) => onChange({ ...session, source: e.target.value })} placeholder="Where they're from (Booster box, Duskmourn)" aria-label="Where they're from" />
        <button type="button" className={`pull-chip${session.newCards ? ' on' : ''}`} aria-pressed={session.newCards} onClick={() => onChange({ ...session, newCards: !session.newCards })}
          title={session.newCards ? 'New cards: they are added to your collection' : 'Already in your collection: they are put away'}
        >
          {session.newCards ? 'New cards' : 'Already mine'}
        </button>
      </div>

      {last ? (
        <div className={`sort-tile${last.pile < 0 ? ' none' : ''}`} style={last.pile >= 0 ? { background: PILE_COLOURS[last.pile % PILE_COLOURS.length] } : undefined} role="status">
          <span className="num">{last.pile >= 0 ? last.pile + 1 : '–'}</span>
          <div className="txt">
            <span>{last.pile >= 0 ? `Pile ${last.pile + 1} · ${lastWhere}` : 'No pile fits · Unsorted'}</span>
            <b>{last.name}</b>
            <span>{[RARITY[last.rarity ?? ''] ?? '', last.usd != null ? money.format(last.usd) : 'No price'].filter(Boolean).join(' · ')}{last.why && last.why !== 'Bulk' ? ` · ${last.why}` : ''}</span>
          </div>
        </div>
      ) : (
        <div className="sort-tile none"><span className="num">?</span><div className="txt"><b>Scan the first card</b><span>Each card shows its pile, big.</span></div></div>
      )}

      <div className="sort-piles">
        {session.rules.map((r, i) => {
          const t = tallies[i]
          return (
            <div key={i} className={`sort-pile${last?.pile === i ? ' on' : ''}`} style={{ ['--pile' as string]: PILE_COLOURS[i % PILE_COLOURS.length] }}>
              <span className="dim" style={{ color: PILE_COLOURS[i % PILE_COLOURS.length] }}>Pile {i + 1} · {pileTitle(r, fmt)}</span>
              <b>{pileGoesTo(r, collections)}</b>
              <span className="dim">
                {t.cards} {t.cards === 1 ? 'card' : 'cards'}{t.usd > 0 && (r.kind === 'VALUE' || r.kind === 'PRICE') ? ` · ${money.format(t.usd, true)}` : ''}{t.decks.length > 0 ? ` · ${t.decks.join(', ')}` : ''}
              </span>
            </div>
          )
        })}
      </div>

      {/* Places these piles would overflow (boxSpace.ts). */}
      {overflows(collections, pileAdds(collections, session)).map((o) => (
        <div key={o.placeId} className="space-warn" role="status" style={{ marginTop: 8 }}>{overflowLine(o)}</div>
      ))}
      <div className="putaway-head">
        <span>{session.scans.length} {session.scans.length === 1 ? 'card' : 'cards'} sorted</span>
        {last && <button type="button" className="link" onClick={() => onChange({ ...session, scans: session.scans.slice(0, -1) })}>Undo last</button>}
      </div>
      <div className="pull-bar" style={{ marginTop: 8 }}>
        <button type="button" className="btn line" onClick={() => setEditing(true)}>Piles…</button>
        <button type="button" className="btn gold" disabled={session.scans.length === 0} onClick={onDone}>Done: file every pile</button>
      </div>
      {editing && (
        <PilesDialog
          rules={session.rules}
          onDismiss={() => setEditing(false)}
          onSave={(rules) => {
            savePiles(rules)
            // Cards scanned so far stay in their piles; a pile that's gone leaves its cards with none.
            onChange({ ...session, rules, scans: session.scans.map((s) => (s.pile >= rules.length ? { ...s, pile: -1 } : s)) })
            setEditing(false)
          }}
        />
      )}
    </>
  )
}

/** The piles' rules, in order: what goes in each and where it goes. */
function PilesDialog({ rules, onDismiss, onSave }: { rules: PileRule[]; onDismiss: () => void; onSave: (rules: PileRule[]) => void }) {
  const { collections } = useSync()
  const money = useMoney()
  const [list, setList] = useState<PileRule[]>(rules)
  const places = placeTree(placesOf(collections))
  const change = (i: number, r: PileRule) => setList((l) => l.map((x, j) => (j === i ? r : x)))
  const move = (i: number, by: number) => setList((l) => {
    const j = i + by
    if (j < 0 || j >= l.length) return l
    const next = [...l]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  return (
    <Dialog
      title="Piles"
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="btn line" onClick={() => setList(defaultPiles(collections))}>Start again</button>
          <button type="button" className="btn gold" onClick={() => onSave(list)}>Save</button>
        </>
      }
    >
      <p className="muted" style={{ margin: '0 0 10px' }}>Each card goes in the first pile whose rule fits it; bulk takes the rest.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((r, i) => (
          <div key={i} className="sort-rule">
            <div className="sort-rule-h">
              <span className="dot" style={{ background: PILE_COLOURS[i % PILE_COLOURS.length] }} />
              <b>Pile {i + 1}</b>
              <button type="button" className="ib" aria-label="Earlier" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow_upward" /></button>
              <button type="button" className="ib" aria-label="Later" disabled={i === list.length - 1} onClick={() => move(i, 1)}><Icon name="arrow_downward" /></button>
              <button type="button" className="ib" aria-label="Remove pile" disabled={list.length <= MIN_PILES} onClick={() => setList((l) => l.filter((_, j) => j !== i))}><Icon name="delete" /></button>
            </div>
            <select className="input" aria-label="What goes in it" value={r.kind} onChange={(e) => {
              const kind = e.target.value as PileKind
              change(i, { kind, ...(kind === 'VALUE' || kind === 'PRICE' ? { over: r.over ?? 2 } : {}), ...(kind === 'SPARES' ? { keep: r.keep ?? 4 } : {}), ...(r.to ? { to: r.to } : {}) })
            }}>
              {PILE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <div className="row2">
              {(r.kind === 'VALUE' || r.kind === 'PRICE') && (
                <input className="input" inputMode="decimal" aria-label={`Worth over, in ${money.currency.code}`}
                  defaultValue={String(Math.round(money.toLocal(r.over ?? 0) * 100) / 100)}
                  onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n) && n >= 0) change(i, { ...r, over: money.toUsd(n) }) }} />
              )}
              {r.kind === 'SPARES' && (
                <input className="input" inputMode="numeric" aria-label="Copies to keep" defaultValue={String(r.keep ?? 4)}
                  onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0) change(i, { ...r, keep: n }) }} />
              )}
              <select className="input" aria-label="Where it goes" value={r.to ?? ''} onChange={(e) => change(i, { ...r, to: e.target.value || undefined })}>
                <option value="">No place (Unsorted)</option>
                <option value={BY_RULE}>The box whose rule fits</option>
                {places.map((n) => <option key={n.place.id} value={n.place.id}>{`${' '.repeat(n.depth)}${n.place.name}`}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
      {list.length < MAX_PILES && (
        <button type="button" className="btn soft" style={{ marginTop: 10 }} onClick={() => setList((l) => [...l, { kind: 'PRICE', over: 5 }])}>
          <Icon name="add" aria-hidden />Add a pile
        </button>
      )}
    </Dialog>
  )
}
