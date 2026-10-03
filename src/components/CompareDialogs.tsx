import { useEffect } from 'react'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { compareCount, deckCounts, diffDecks, identical, sameCount, versionCounts, type CompareRow } from '../decks/deckCompare'
import { versionDate, versionSummaries } from '../decks/versions'
import { GAME_MODE_LABELS, type Deck, type GameMode } from '../types/models'

/** What a deck is compared with: another deck, or one of its own saved versions. */
export interface CompareTarget {
  label: string
  counts: Map<string, number>
}

/**
 * "Compare with…": the user's other decks, then this deck's saved versions (newest first, the current
 * one left out since it's the deck as it is). The Android app's ComparePickerDialog.
 */
export function ComparePickerDialog({ deck, decks, onPick, onDismiss }: {
  deck: Deck
  /** Every deck; this one is left out. */
  decks: Deck[]
  onPick: (target: CompareTarget) => void
  onDismiss: () => void
}) {
  const others = decks.filter((d) => d.id !== deck.id).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const earlier = versionSummaries(deck).slice(1)
  return (
    <Dialog title="Compare with…" onDismiss={onDismiss} actions={<button type="button" className="btn line" onClick={onDismiss}>Cancel</button>}>
      {others.length === 0 && earlier.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>Nothing to compare with yet: no other decks, and no earlier versions of this one.</p>
      )}
      {others.length > 0 && (
        <>
          <div className="compare-pick-h">Another deck</div>
          {others.map((other) => (
            <button key={other.id} type="button" className="compare-pick press" onClick={() => onPick({ label: other.name, counts: deckCounts(other) })}>
              <b>{other.name}</b>
              <span>{GAME_MODE_LABELS[other.gameMode as GameMode] ?? other.gameMode} · {other.cards.reduce((n, c) => n + c.quantity, 0)} cards</span>
            </button>
          ))}
        </>
      )}
      {earlier.length > 0 && (
        <>
          <div className="compare-pick-h" style={{ marginTop: others.length > 0 ? 12 : 0 }}>An earlier version of this deck</div>
          {earlier.map((s) => {
            const date = versionDate(s.version.savedAt)
            return (
              <button key={s.version.id} type="button" className="compare-pick press" onClick={() => onPick({ label: `version of ${date}`, counts: versionCounts(s.version) })}>
                <b>{date}</b>
                <span>
                  {Object.values(s.version.cards).reduce((a, b) => a + b, 0)} cards
                  {s.games > 0 ? ` · ${s.wins}-${s.losses}` : ''}
                </span>
              </button>
            )
          })}
        </>
      )}
    </Dialog>
  )
}

/**
 * The comparison, full screen: cards only in this deck, only in the other, and in both — with each
 * side's copies where they differ. Matched by card name (decks/deckCompare.ts), main deck only. The
 * Android app's CompareScreen.
 */
export function CompareScreen({ deck, target, onClose }: { deck: Deck; target: CompareTarget; onClose: () => void }) {
  const diff = diffDecks(deckCounts(deck), target.counts)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="goldfish" role="dialog" aria-modal="true" aria-label={`Compare ${deck.name} with ${target.label}`}>
      <div className="goldfish-bar">
        <button type="button" className="ib" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        <div className="goldfish-title">
          <b>Compare</b>
          <span className="playtest-status">{deck.name} vs {target.label}</span>
        </div>
      </div>
      <div className="goldfish-body compare-body">
        {identical(diff) && <div className="dim">The two lists are the same.</div>}
        <CompareSection title={`Only in ${deck.name}`} rows={diff.onlyHere} />
        <CompareSection title={`Only in ${target.label}`} rows={diff.onlyThere} />
        <CompareSection title="In both" rows={diff.both} />
      </div>
    </div>
  )
}

function CompareSection({ title, rows }: { title: string; rows: CompareRow[] }) {
  return (
    <section className="compare-section">
      <div className="compare-h"><h3>{title}</h3><span>{rows.length}</span></div>
      {rows.length === 0 && <div className="dim">None.</div>}
      {rows.map((row) => (
        <div key={row.name.toLowerCase()} className="compare-row">
          <span className="compare-name">{row.name}</span>
          <span className={`compare-count${sameCount(row) ? '' : ' differs'}${row.here > 0 && row.there > 0 && row.here !== row.there ? ' changed' : ''}`}>
            {compareCount(row)}
          </span>
        </div>
      ))}
    </section>
  )
}
