// The deck page's primer, categories, companion, folder and value history: the "About" panel (and
// the primer as shared decks show it), a card's categories, a category's target, the companion
// picker, the folder picker and the value panel on Stats. The logic is in decks/primer.ts,
// categories.ts, companion.ts, deckFolders.ts and deckValueHistory.ts; the Android app's
// ui/decks/DeckExtrasUi.kt shows the same.

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { PillChip, rise } from './kit'
import { PanelHead } from './StatsFold'
import { useMoney } from '../money/currency'
import { getByExactName } from '../api/scryfall'
import type { Deck, DeckCardEntry } from '../types/models'
import { MAX_DESCRIPTION, parsePrimer, tidyDescription, type PrimerSpan } from '../decks/primer'
import {
  COMMON_CATEGORIES, categoryCounts, deckCategoryNames, removedCategory, renamedCategory, targetOf, tidyCategory,
  withCardCategories, withCategoryTarget,
} from '../decks/categories'
import { COMPANIONS, companionEntry, companionNamed, withCompanion } from '../decks/companion'
import { folderNames, folderOf, tidyFolder, withFolder } from '../decks/deckFolders'
import { monthChange, useDeckValueHistory } from '../decks/deckValueHistory'
import { withSideboardCopies } from '../decks/sideboard'
import { entryFromCard } from '../decks/newDeck'
import { hasSideboard } from '../decks/sideboard'
import './deckExtras.css'

/** Changes one deck, or every deck, in one step. */
export function useDeckChange() {
  const { changeDecksAndStorage } = useSync()
  return {
    one: (deckId: string, change: (deck: Deck) => Deck) =>
      changeDecksAndStorage((collections, decks) => ({ collections, decks: decks.map((d) => (d.id === deckId ? change(d) : d)) })),
    all: (change: (decks: Deck[]) => Deck[]) => changeDecksAndStorage((collections, decks) => ({ collections, decks: change(decks) })),
  }
}

// ---- The primer ----

function Spans({ spans, onCard }: { spans: PrimerSpan[]; onCard: (name: string) => void }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: ReactNode = s.text.includes('\n')
          ? s.text.split('\n').map((line, j) => <Fragment key={j}>{j > 0 && <br />}{line}</Fragment>)
          : s.text
        if (s.card) node = <button type="button" className="primer-card" onClick={() => onCard(s.card!)}>{node}</button>
        else if (s.url) node = <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{node}</a>
        if (s.italic) node = <em>{node}</em>
        if (s.bold) node = <strong>{node}</strong>
        return <Fragment key={i}>{node}</Fragment>
      })}
    </>
  )
}

/** A primer drawn as headings, lists and paragraphs — text only, never HTML; [[cards]] open the card. */
export function PrimerText({ text }: { text: string }) {
  const navigate = useNavigate()
  const blocks = useMemo(() => parsePrimer(text), [text])
  const onCard = (name: string) => navigate(`/card/${encodeURIComponent(name)}`)
  return (
    <div className="primer">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const H = b.level === 1 ? 'h3' : b.level === 2 ? 'h4' : 'h5'
          return <H key={i}><Spans spans={b.spans} onCard={onCard} /></H>
        }
        if (b.kind === 'list') {
          const L = b.ordered ? 'ol' : 'ul'
          return <L key={i}>{b.items.map((item, j) => <li key={j}><Spans spans={item} onCard={onCard} /></li>)}</L>
        }
        return <p key={i}><Spans spans={b.spans} onCard={onCard} /></p>
      })}
    </div>
  )
}

/** The deck's "About": its primer, written and edited here. */
export function AboutPanel({ deck }: { deck: Deck }) {
  const { one } = useDeckChange()
  const [editing, setEditing] = useState<string | null>(null)
  const text = deck.description ?? ''
  const save = () => {
    const next = tidyDescription(editing ?? '')
    if (next !== text) one(deck.id, (d) => (next || d.description !== undefined ? { ...d, description: next } : d))
    setEditing(null)
  }
  return (
    <div className="panel rise about-panel" style={rise(0)}>
      <PanelHead title="About">
        <button type="button" className="link" onClick={() => setEditing(text)}>
          <Icon name="edit" aria-hidden />{text ? 'Edit' : 'Write'}
        </button>
      </PanelHead>
      {text ? <PrimerText text={text} /> : (
        <div className="dim">No primer yet. Say how the deck plays, what to keep in an opening hand, and its key cards — [[Card name]] links a card.</div>
      )}
      {editing !== null && (
        <Dialog
          title="About this deck"
          onDismiss={() => setEditing(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn gold" onClick={save}>Save</button>
            </>
          }
        >
          <textarea
            className="input primer-input" rows={12} value={editing} maxLength={MAX_DESCRIPTION} autoFocus
            onChange={(e) => setEditing(e.target.value)}
            placeholder={'## How it plays\nRamp early, then **[[Craterhoof Behemoth]]**.\n\n- Keep hands with two lands\n- *Mulligan* no-landers'}
            aria-label="About this deck"
          />
          <div className="dim primer-help">
            # Heading · **bold** · *italic* · - list · [[Card name]] · [words](https://…) — {editing.length.toLocaleString()} / {MAX_DESCRIPTION.toLocaleString()}
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ---- Categories ----

/** Picking a card's categories: the deck's own and the common ones as chips, and a new one typed in. */
export function CardCategoriesDialog({ deck, entry, onClose }: { deck: Deck; entry: DeckCardEntry; onClose: () => void }) {
  const { one } = useDeckChange()
  const [chosen, setChosen] = useState<string[]>(entry.categories ?? [])
  const [typed, setTyped] = useState('')
  const has = (name: string) => chosen.some((c) => c.toLowerCase() === name.toLowerCase())
  const offered = [...deckCategoryNames(deck), ...COMMON_CATEGORIES, ...chosen]
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i)
  const toggle = (name: string) => setChosen(has(name) ? chosen.filter((c) => c.toLowerCase() !== name.toLowerCase()) : [...chosen, name])
  const add = () => {
    const name = tidyCategory(typed)
    if (name && !has(name)) setChosen([...chosen, name])
    setTyped('')
  }
  return (
    <Dialog
      title={`Categories for ${entry.name}`}
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="btn line" onClick={onClose}>Cancel</button>
          <button type="button" className="btn gold" onClick={() => { one(deck.id, (d) => withCardCategories(d, entry.scryfallId, chosen)); onClose() }}>Save</button>
        </>
      }
    >
      <div className="dim" style={{ marginBottom: 10 }}>A card can be in several. Group the list by Category to see them.</div>
      <div className="chips wrap">
        {offered.map((name) => <PillChip key={name} label={name} selected={has(name)} icon={has(name) ? 'check' : undefined} onClick={() => toggle(name)} className="on-g2" />)}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input" placeholder="New category, e.g. Win cons" value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn" onClick={add} disabled={!tidyCategory(typed)}>Add</button>
      </div>
    </Dialog>
  )
}

/** One category's target, name and removal. */
export function CategoryDialog({ deck, name, onClose }: { deck: Deck; name: string; onClose: () => void }) {
  const { one } = useDeckChange()
  const [target, setTarget] = useState(String(targetOf(deck, name) ?? ''))
  const [rename, setRename] = useState(name)
  const count = categoryCounts(deck)[name] ?? 0
  const save = () => {
    const n = Number.parseInt(target, 10)
    one(deck.id, (d) => {
      let next = withCategoryTarget(d, name, Number.isFinite(n) && n > 0 ? n : null)
      if (tidyCategory(rename) && tidyCategory(rename) !== name) next = renamedCategory(next, name, rename)
      return next
    })
    onClose()
  }
  return (
    <Dialog
      title={name}
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="btn danger" onClick={() => { one(deck.id, (d) => removedCategory(d, name)); onClose() }}>Remove</button>
          <button type="button" className="btn line" onClick={onClose}>Cancel</button>
          <button type="button" className="btn gold" onClick={save}>Save</button>
        </>
      }
    >
      <div className="dim" style={{ marginBottom: 10 }}>{count} {count === 1 ? 'card' : 'cards'} in it. Remove takes it off every card; the cards stay.</div>
      <label className="field-label" htmlFor="cat-name">Name</label>
      <input id="cat-name" className="input" value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} />
      <label className="field-label" htmlFor="cat-target" style={{ marginTop: 10 }}>Target (how many you want)</label>
      <input id="cat-target" className="input" inputMode="numeric" placeholder="None" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, '').slice(0, 3))} />
    </Dialog>
  )
}

// ---- Companion ----

/**
 * The deck's companion: one of the ten, kept in the sideboard (outside the 100 in Commander). Picking
 * one adds it there when it isn't yet; taking it off leaves a 60-card deck's copy in the sideboard.
 */
export function CompanionPanel({ deck, index = 0 }: { deck: Deck; index?: number }) {
  const { one } = useDeckChange()
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = companionNamed(deck.companion)
  const inSide = companionEntry(deck)
  const sided = hasSideboard(deck.gameMode)
  const choose = async (name: string | null) => {
    setPicking(false)
    setError(null)
    if (!name) {
      // Commander keeps no sideboard: the companion goes with the mark.
      one(deck.id, (d) => {
        const entry = companionEntry(d)
        const next = withCompanion(d, null)
        return !sided && entry ? { ...next, sideboard: (next.sideboard ?? []).filter((c) => c !== entry) } : next
      })
      return
    }
    const there = (deck.sideboard ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase())
    let entry: DeckCardEntry | null = null
    if (!there) {
      try {
        entry = entryFromCard(await getByExactName(name), 1)
      } catch {
        setError("Couldn't reach Scryfall — try again when you're online.")
        return
      }
    }
    one(deck.id, (d) => {
      // A Commander deck's old companion goes when a new one comes.
      const old = !sided ? companionEntry(d) : undefined
      let next = old ? { ...d, sideboard: (d.sideboard ?? []).filter((c) => c !== old) } : d
      if (entry) next = withSideboardCopies(next, entry)
      return withCompanion(next, name)
    })
  }
  return (
    <div className="panel rise" style={rise(index)}>
      <div className="p-h"><h3>Companion</h3></div>
      {current ? (
        <>
          <div className="chips wrap"><PillChip label={current.name} icon="pets" className="on-g2" selected onClick={() => setPicking(true)} /></div>
          <div className="dim" style={{ marginTop: 10 }}>{current.rule} Stats shows whether the deck meets it.</div>
          {!inSide && <div className="dim" style={{ marginTop: 6, color: 'var(--error)' }}>It isn't in the {sided ? 'sideboard' : 'deck'} — pick it again to add it.</div>}
        </>
      ) : (
        <div className="dim">None. A companion starts the game outside the deck if the deck meets its condition{sided ? ' — it takes one of the sideboard\'s 15' : ' — in Commander it sits outside the 100'}.</div>
      )}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button type="button" className="btn line sm" onClick={() => setPicking(true)}>{current ? 'Change' : 'Choose a companion'}</button>
        {current && <button type="button" className="btn line sm" onClick={() => { void choose(null) }}>Remove</button>}
      </div>
      {error && <div className="dim" style={{ marginTop: 8, color: 'var(--error)' }}>{error}</div>}
      {picking && (
        <Dialog title="Choose a companion" onDismiss={() => setPicking(false)} actions={<button type="button" className="btn line" onClick={() => setPicking(false)}>Cancel</button>}>
          <div className="companion-list">
            {COMPANIONS.map((c) => (
              <button key={c.name} type="button" className={`companion-option${current?.name === c.name ? ' on' : ''}`} onClick={() => { void choose(c.name) }}>
                <b>{c.name}</b>
                <span className="dim">{c.rule}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ---- Folders ----

/** Filing a deck: an existing folder, a new one, or none. */
export function FolderDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const { decks } = useSync()
  const { one } = useDeckChange()
  const [typed, setTyped] = useState('')
  const current = folderOf(deck)
  const move = (folder: string | null) => { one(deck.id, (d) => withFolder(d, folder)); onClose() }
  return (
    <Dialog title={`File “${deck.name}”`} onDismiss={onClose} actions={<button type="button" className="btn line" onClick={onClose}>Cancel</button>}>
      <div className="chips wrap">
        {folderNames(decks).map((f) => (
          <PillChip key={f} label={f} icon="folder" selected={current?.toLowerCase() === f.toLowerCase()} onClick={() => move(f)} className="on-g2" />
        ))}
        {current && <PillChip label="No folder" icon="folder_off" onClick={() => move(null)} className="on-g2" />}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input" placeholder="New folder, e.g. Modern" value={typed} maxLength={60} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tidyFolder(typed) && move(typed)} />
        <button type="button" className="btn" onClick={() => move(typed)} disabled={!tidyFolder(typed)}>Move</button>
      </div>
    </Dialog>
  )
}

// ---- Value over time ----

const W = 300
const H = 64

/** "+$12 this month", "−$3 this month". */
export function useMonthChangeText(points: { date: string; usd: number; cards: number }[]): string | null {
  const money = useMoney()
  const change = monthChange(points)
  if (!change) return null
  const sign = change.usd < 0 ? '−' : '+'
  return `${sign}${money.format(Math.abs(change.usd), Math.abs(money.toLocal(change.usd)) >= 100)} this month`
}

/** The deck's value over the last three months, noted once a day on this device, and how it moved this month. */
export function DeckValuePanel({ deckId, index = 0 }: { deckId: string; index?: number }) {
  const all = useDeckValueHistory(deckId)
  const money = useMoney()
  const changeText = useMonthChangeText(all)
  const points = all.slice(-91)
  const last = points[points.length - 1]
  let chart: ReactNode = null
  if (points.length >= 2) {
    const days = points.map((p) => Date.parse(`${p.date}T00:00:00Z`) / 86_400_000)
    const span = Math.max(1, days[days.length - 1] - days[0])
    const lo = Math.min(...points.map((p) => p.usd))
    const hi = Math.max(...points.map((p) => p.usd))
    const pad = (hi - lo || Math.max(hi * 0.1, 1)) * 0.1
    const x = (i: number) => ((days[i] - days[0]) / span) * W
    const y = (v: number) => H * (1 - (v - (lo - pad)) / (hi + pad - (lo - pad)))
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.usd).toFixed(1)}`).join(' ')
    chart = (
      <svg className="value-chart deck-value-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Deck value over time">
        <path d={line} className="value-line" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  return (
    <div className="panel rise" style={rise(index)}>
      <PanelHead title="Value over time" closed={changeText ?? (last ? money.format(last.usd, true) : 'Nothing noted yet')}>
        {changeText && <span className={`p-sub value-change${changeText.startsWith('−') ? ' down' : ' up'}`}>{changeText}</span>}
      </PanelHead>
      {chart ?? <div className="dim">Noted once a day on this device while the app is open — the chart fills in from tomorrow.</div>}
      {last && <div className="dim" style={{ marginTop: 8 }}>{money.format(last.usd, true)} on {new Date(`${last.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · kept on this device only</div>}
    </div>
  )
}
