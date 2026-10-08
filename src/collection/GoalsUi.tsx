// Collection goals on screen, the parts used in more than one place: the progress bar, the Goals card
// on the Collection's home, "Make this a goal" for a set or a deck, and the watcher that notices a
// goal completing — a small celebration, then the goal moves to Completed. The pages are
// pages/GoalsPage.tsx; the rules collectionGoals.ts. The Android app's ui/collection/GoalsUi.kt.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { IconButton } from '../components/kit'
import type { ScryfallCard } from '../types/scryfall'
import type { Deck } from '../types/models'
import {
  completeGoals, goalActivityOf, goalProgress, goalsOf, GOAL_RARITIES, missingLine, newDeckGoal, newSetGoal, progressLine, saveGoal, setGoalName,
  sortedGoals, withGoals, type CollectionGoal, type GoalProgress, type GoalSetCard,
} from './collectionGoals'
import { goalSetCard, newGoalId, useGoals } from './useGoals'
import { postGoalCompleted } from '../social/activity'
import './storage.css'
import './recipes.css'
import './goals.css'

/** The bar: gold while going, green once complete. */
export function GoalBar({ p, big }: { p: GoalProgress; big?: boolean }) {
  return (
    <span className={`goal-bar${big ? ' big' : ''}${p.complete ? ' done' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={p.have} aria-label={`${p.have} of ${p.need}`}>
      <span style={{ width: `${p.need === 0 ? 0 : Math.min(100, (p.have / p.need) * 100)}%` }} />
    </span>
  )
}

/** One goal on a list: its name, bar, have/need and what's missing. */
export function GoalRow({ goal, p, onClick }: { goal: CollectionGoal; p: GoalProgress; onClick: () => void }) {
  const money = useMoney()
  return (
    <button type="button" className="goal-row press" onClick={onClick}>
      <span className="goal-row-top">
        <b>{goal.name}</b>
        <span className="goal-num">{goal.completedAt != null ? <Icon name="task_alt" aria-label="Complete" /> : progressLine(p)}</span>
      </span>
      <GoalBar p={p} />
      <span className="goal-row-sub">{goal.completedAt != null && !p.complete ? `Completed · now ${progressLine(p)}` : missingLine(p, (usd) => money.format(usd))}</span>
    </button>
  )
}

/** The Collection home's Goals card: the two open goals nearest done, and See all. */
export function GoalsHomeCard() {
  const navigate = useNavigate()
  const { goals, progress } = useGoals()
  const { open, done } = sortedGoals(goals, progress)
  return (
    <section className="chome-todo goals-home">
      <div className="chome-head">
        <h2>Goals</h2>
        <button type="button" className="link" onClick={() => navigate('/collections/goals')}>{goals.length > 0 ? 'See all' : 'New goal'}</button>
      </div>
      {open.length === 0 ? (
        <button type="button" className="chome-row goal-empty" onClick={() => navigate(goals.length > 0 ? '/collections/goals' : '/collections/goals/new')}>
          <Icon name="flag" aria-hidden />
          <span>{done.length > 0 ? `${done.length} complete — set another goal` : 'Set a goal: finish a set, playsets, a foil deck…'}</span>
        </button>
      ) : open.slice(0, 2).map((g) => <GoalRow key={g.id} goal={g} p={progress(g)} onClick={() => navigate(`/collections/goals/${encodeURIComponent(g.id)}`)} />)}
    </section>
  )
}

const RARITY_LABELS: Record<string, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' }

/** Choosing the rarities and the finish for a set goal. */
export function SetGoalOptions({ setName, rarities, foil, onRarities, onFoil, cards }: {
  setName: string; rarities: string[]; foil: boolean; onRarities: (r: string[]) => void; onFoil: (f: boolean) => void; cards: GoalSetCard[] | null
}) {
  const count = cards ? cards.filter((c) => rarities.length === 0 || rarities.includes((c.rarity ?? '').toLowerCase())).length : null
  return (
    <div className="goal-options">
      <div className="recipe-h" style={{ marginTop: 0 }}>Which cards</div>
      <div className="recipe-chips">
        <button type="button" className={`pull-chip${rarities.length === 0 ? ' on' : ''}`} aria-pressed={rarities.length === 0} onClick={() => onRarities([])}>Every card</button>
        {GOAL_RARITIES.map((r) => (
          <button key={r} type="button" className={`pull-chip${rarities.includes(r) ? ' on' : ''}`} aria-pressed={rarities.includes(r)}
            onClick={() => onRarities(GOAL_RARITIES.filter((x) => (x === r ? !rarities.includes(r) : rarities.includes(x))))}
          >{RARITY_LABELS[r]}</button>
        ))}
      </div>
      <label className="goal-check">
        <input type="checkbox" checked={foil} onChange={(e) => onFoil(e.target.checked)} />
        <span>In foil — only foil copies count</span>
      </label>
      <div className="dim goal-preview">“{setGoalName(setName, rarities, foil)}”{count != null ? ` · ${count} ${count === 1 ? 'card' : 'cards'}` : ''}</div>
    </div>
  )
}

/** "Make this a goal" on a set's page. */
export function MakeSetGoalDialog({ set, cards, onClose }: { set: { code: string; name: string }; cards: ScryfallCard[]; onClose: () => void }) {
  const { changeStorage } = useSync()
  const navigate = useNavigate()
  const [rarities, setRarities] = useState<string[]>([])
  const [foil, setFoil] = useState(false)
  const setCards = useMemo(() => cards.map(goalSetCard), [cards])
  const create = () => {
    const goal = newSetGoal(newGoalId(), set, setCards, rarities, foil, Date.now())
    changeStorage((c) => saveGoal(c, goal))
    navigate(`/collections/goals/${encodeURIComponent(goal.id)}`)
  }
  return (
    <Dialog
      title="Make this a goal"
      onDismiss={onClose}
      actions={<>
        <button type="button" className="btn line" onClick={onClose}>Cancel</button>
        <button type="button" className="btn gold" onClick={create}>Make it a goal</button>
      </>}
    >
      <SetGoalOptions setName={set.name} rarities={rarities} foil={foil} onRarities={setRarities} onFoil={setFoil} cards={setCards} />
    </Dialog>
  )
}

/** "Make this a goal" on a deck: every card in foil (or every card at all). */
export function MakeDeckGoalDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const { changeStorage } = useSync()
  const navigate = useNavigate()
  const [foil, setFoil] = useState(true)
  const create = () => {
    const goal = newDeckGoal(newGoalId(), deck, foil, Date.now())
    changeStorage((c) => saveGoal(c, goal))
    navigate(`/collections/goals/${encodeURIComponent(goal.id)}`)
  }
  return (
    <Dialog
      title="Make this a goal"
      onDismiss={onClose}
      actions={<>
        <button type="button" className="btn line" onClick={onClose}>Cancel</button>
        <button type="button" className="btn gold" onClick={create}>Make it a goal</button>
      </>}
    >
      <div className="goal-options">
        <label className="goal-check">
          <input type="radio" name="deck-goal" checked={foil} onChange={() => setFoil(true)} />
          <span><b>Foil this deck</b><br /><small className="dim">Every card in foil. Foil copies the pull list brought into the deck count.</small></span>
        </label>
        <label className="goal-check">
          <input type="radio" name="deck-goal" checked={!foil} onChange={() => setFoil(false)} />
          <span><b>Own every card</b><br /><small className="dim">Every card, any finish.</small></span>
        </label>
        <div className="dim goal-preview">“{foil ? `Foil ${deck.name}` : `Own all of ${deck.name}`}” · basic lands left out</div>
      </div>
    </Dialog>
  )
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Notices goals completing, wherever the cards came from (a scan, an import, a trade): marks them
 * complete — once, on whichever device sees it first — and celebrates: confetti and a short buzz,
 * or just the note when the system asks for reduced motion.
 */
export function GoalWatcher() {
  const { collections, decks, changeStorage, pendingReset } = useSync()
  const navigate = useNavigate()
  const [party, setParty] = useState<string[] | null>(null)
  const timer = useRef<number | null>(null)
  const change = useRef(changeStorage)
  change.current = changeStorage

  useEffect(() => {
    if (pendingReset) return
    const goals = goalsOf(collections)
    if (!goals.some((g) => g.completedAt == null)) return
    const t = window.setTimeout(() => {
      const found = completeGoals(goals, collections, decks, Date.now())
      if (found.done.length === 0) return
      change.current((c) => {
        const r = completeGoals(goalsOf(c), c, decks, Date.now())
        return r.done.length > 0 ? withGoals(c, r.goals) : c
      })
      const completed = found.goals.filter((g) => found.done.includes(g.id))
      setParty(completed.map((g) => g.name))
      // Friends' Activity hears of it, when the user shares completed goals (and the server has it).
      for (const g of completed) void postGoalCompleted(goalActivityOf(g, goalProgress(g, collections, decks)))
      if (!reducedMotion()) navigator.vibrate?.([30, 60, 30, 60, 90])
    }, 700)
    return () => window.clearTimeout(t)
  }, [collections, decks, pendingReset])

  useEffect(() => {
    if (!party) return
    timer.current = window.setTimeout(() => setParty(null), 6000)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [party])

  if (!party) return null
  const still = reducedMotion()
  return (
    <div className="goal-party" role="status" aria-live="polite">
      {!still && (
        <div className="goal-confetti" aria-hidden>
          {Array.from({ length: 36 }, (_, i) => <i key={i} style={{ ['--x' as string]: `${(i * 37) % 100}%`, ['--d' as string]: `${(i % 7) * 0.12}s`, ['--c' as string]: CONFETTI[i % CONFETTI.length] }} />)}
        </div>
      )}
      <div className="goal-party-card">
        <Icon name="emoji_events" aria-hidden />
        <div className="goal-party-text">
          <b>Goal complete!</b>
          <span>{party.join(' · ')}</span>
        </div>
        <button type="button" className="btn gold sm" onClick={() => { setParty(null); navigate('/collections/goals') }}>See goals</button>
        <IconButton icon="close" label="Close" onClick={() => setParty(null)} />
      </div>
    </div>
  )
}

const CONFETTI = ['#e6b45e', '#5fbf7a', '#4d8fe0', '#e0674d', '#b98cf0', '#f3efe0']
