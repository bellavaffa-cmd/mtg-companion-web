// Sorting with a recipe, in the scanner (ScanPage.tsx's ?recipe mode) — the Scan and Smart mockups: the
// pile's number big, its colour band and name (or, for a smart pile, why: "KRENKO NEEDS IT"), the card
// and its line, Undo, Wrong card?, the last pile and how many are sorted; for a smart pile, what else
// wants the card, Put in deck now and Send to pile N instead. Checking a pile shows each card's verdict
// instead. The logic is sortRecipes.ts; the Android app's RecipeScanPanel.kt shows the same.

import { useMoney } from '../money/currency'
import {
  alsoLine, APART_LABELS, cardLine, otherPile, ownedLine, reasonLine,
  type ApartKind, type DerivedPiles, type RecipeChoice, type SmartContext,
} from './sortRecipes'
import type { RecipeSessionState, RecipeVoice } from './recipeSession'
import './recipes.css'

interface Props {
  session: RecipeSessionState
  derived: DerivedPiles
  ctx: SmartContext
  voice: RecipeVoice
  rate: number
  onUndo: () => void
  onWrong: () => void
  onSend: (choice: RecipeChoice) => void
  onPutInDeck: () => void
  onApart: (kind: ApartKind) => void
  onDone: () => void
  onFinishCheck: () => void
  /** The newest card was put right by a correction learned before (scan/scanCorrections.ts). */
  learned?: boolean
  onLearned?: () => void
}

export function RecipeScanPanel({ session, derived, ctx, voice, rate, onUndo, onWrong, onSend, onPutInDeck, onApart, onDone, onFinishCheck, learned = false, onLearned }: Props) {
  const money = useMoney()
  const price = (usd: number) => money.format(usd)
  const scans = session.scans
  const last = scans.at(-1)
  const before = scans.at(-2)
  const pile = last ? derived.piles.find((p) => p.number === last.pile) : undefined
  const beforePile = before ? derived.piles.find((p) => p.number === before.pile) : undefined
  const checking = session.checking
  const top = (
    <div className="rscan-top">
      <button type="button" className="btn line" onClick={checking ? onFinishCheck : onDone}>{checking ? 'Finish check' : 'Done'}</button>
      <span style={{ flex: 1 }} />
      <span className="rscan-chip"><span className={`dot${voice.auto ? '' : ' off'}`} />{[voice.auto ? 'Auto' : 'Tap to scan', voice.speak ? 'speaking' : ''].filter(Boolean).join(' · ')}</span>
      <span className="rscan-chip">{scans.length} sorted</span>
    </div>
  )

  if (checking) {
    const p = derived.piles.find((x) => x.number === checking.pile)
    const lastFlag = checking.flagged.at(-1)
    return (
      <>
        {top}
        <div className="rscan" style={{ ['--band' as string]: p?.band ?? 'var(--gold)' }} role="status" aria-live="polite">
          <div className="rscan-band" />
          <div className="rscan-main">
            <span className="rscan-num" aria-label={`Pile ${checking.pile}`}>{checking.pile}</span>
            <div className="rscan-txt">
              <span className="rscan-pile">Checking {p?.name ?? ''}</span>
              <b>{checking.checked.length} of {scans.filter((s) => s.pile === checking.pile).length} found</b>
              <span className="line">{lastFlag ? `${lastFlag.name}: ${lastFlag.line}` : 'Scan the pile, card by card.'}</span>
            </div>
          </div>
          {checking.flagged.length > 0 && (
            <div className="rscan-also">
              <span className="h">Doesn't belong:</span>
              {checking.flagged.slice().reverse().slice(0, 6).map((f, i) => <span key={i}>{f.name} — {f.line.replace("Doesn't belong — ", '')}</span>)}
            </div>
          )}
        </div>
      </>
    )
  }

  if (!last || !pile) {
    return (
      <>
        {top}
        <div className="rscan" style={{ ['--band' as string]: 'var(--g3)' }}>
          <div className="rscan-band" />
          <div className="rscan-main">
            <span className="rscan-num">?</span>
            <div className="rscan-txt">
              <span className="rscan-pile">Show the first card</span>
              <span className="line">{voice.auto ? 'Hold it still under the camera; its pile shows here, big.' : 'Tap Scan now for each card; its pile shows here, big.'}</span>
            </div>
          </div>
        </div>
      </>
    )
  }

  const reason = last.reason ?? null
  const alt = !last.filed ? otherPile(session.recipe, derived, last, rate) : null
  const also = [...(last.also ?? []).map(alsoLine), ...(reason ? [ownedLine(ctx, last.name, scans.slice(0, -1))].filter((x): x is string => !!x) : [])]
  return (
    <>
      {top}
      <div className="rscan" style={{ ['--band' as string]: pile.band }}>
        <div className="rscan-band" />
        <div className="rscan-main" role="status" aria-live="polite" aria-atomic="true">
          <span className="rscan-num" aria-label={`Pile ${pile.number}`}>{pile.number}</span>
          <div className="rscan-txt">
            <span className={`rscan-pile${reason ? ' reason' : ''}`}>{reason ? reasonLine(reason) : pile.name}</span>
            <b>{last.name}</b>
            <span className="line">{cardLine(last, price)}</span>
          </div>
        </div>
        {reason && also.length > 0 && (
          <div className="rscan-also">
            <span className="h">Also wanted:</span>
            {also.map((a, i) => <span key={i}>{a}</span>)}
          </div>
        )}
        {session.recipe.apart.length > 0 && !last.filed && (
          <div className="rscan-apart">
            {session.recipe.apart.map((k) => {
              const on = k === 'FOIL' ? !!last.card.foil : k === 'FOREIGN' ? !!last.card.lang && last.card.lang !== 'en' : !!last.card.played
              return <button key={k} type="button" className={`pull-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onApart(k)}>{k === 'FOIL' ? 'Foil' : APART_LABELS[k]}</button>
            })}
          </div>
        )}
        <div className="rscan-bar">
          {reason?.kind === 'DECKS' && !last.filed && <button type="button" onClick={onPutInDeck}>Put in deck now</button>}
          {alt && <button type="button" onClick={() => onSend(alt)}>Send to pile {alt.pile} instead</button>}
          <button type="button" onClick={onUndo} disabled={!!last.filed}>Undo</button>
          {!last.filed && <button type="button" onClick={onWrong}>Wrong card?</button>}
          {learned && <button type="button" className="rscan-learned" aria-label={`Learned from your correction: ${last.name}`} onClick={onLearned}>Learned</button>}
          {last.filed && <span className="last" style={{ textAlign: 'left' }}>Put with its deck</span>}
          <span className="last">{before && beforePile ? `Last: ${beforePile.number} · ${beforePile.name}` : ''}</span>
        </div>
      </div>
    </>
  )
}
