// Collection goals: the list (open ones nearest done first, then Completed), one goal with its
// missing cards — Add missing to Wishlist, Ask friends who have them, count cards in decks — and New
// goal. The rules are collection/collectionGoals.ts; the bar, the home card and the celebration
// collection/GoalsUi.tsx. The Android app's ui/collection/GoalsScreen.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ArtImage, PageHeader, PillChip, rise, toArtCrop, useBack } from '../components/kit'
import { CardSearchResults } from '../components/CardSearchResults'
import { getCollection, getSetCards, getSets } from '../api/scryfall'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { parseCardList } from '../collection/cardListText'
import { useCardData } from '../collection/cardData'
import { isWishlist } from '../collection/wishlist'
import { isArchived } from '../decks/deckFolders'
import type { SetInfo } from '../collection/setCompletion'
import { WhoHasCardsSheet } from '../social/WhoHasIt'
import {
  deleteGoal, goalNameKey, goalProgress, GOAL_KIND_DETAILS, GOAL_KIND_LABELS, GOAL_KINDS, GOAL_PLAYSET, goalWishlistAdds, missingLine,
  missingLines, newDeckGoal, newListGoal, newSetGoal, saveGoal, sortedGoals,
  type GoalCard, type GoalKind, type GoalPrices,
} from '../collection/collectionGoals'
import { GoalBar, GoalRow, SetGoalOptions } from '../collection/GoalsUi'
import { goalSetCard, newGoalId, useGoals } from '../collection/useGoals'
import '../collection/goals.css'

export function GoalsPage() {
  const navigate = useNavigate()
  const back = useBack('/collections')
  const { goals, progress } = useGoals()
  const { open, done } = sortedGoals(goals, progress)
  const go = (id: string) => navigate(`/collections/goals/${encodeURIComponent(id)}`)
  return (
    <>
      <PageHeader
        title="Goals"
        eyebrow="Collection"
        onBack={back}
        actions={<button type="button" className="btn gold" onClick={() => navigate('/collections/goals/new')}><Icon name="add" aria-hidden />New goal</button>}
      />
      <div className="content-scroll goal-page">
        {goals.length === 0 && (
          <div className="empty-state rise" style={rise(0)}>
            <Icon name="flag" />
            <div>Set a target and watch it fill up: every Duskmourn uncommon, a playset of each shock land, your Krenko deck in foil.</div>
            <button type="button" className="btn gold" onClick={() => navigate('/collections/goals/new')}>New goal</button>
          </div>
        )}
        {open.length > 0 && <div className="goal-list rise" style={rise(1)}>{open.map((g) => <GoalRow key={g.id} goal={g} p={progress(g)} onClick={() => go(g.id)} />)}</div>}
        {done.length > 0 && (
          <>
            <div className="recipe-h">Completed</div>
            <div className="goal-list">{done.map((g) => <GoalRow key={g.id} goal={g} p={progress(g)} onClick={() => go(g.id)} />)}</div>
          </>
        )}
      </div>
    </>
  )
}

const price = (s: string | null | undefined) => {
  const n = s ? Number(s) : NaN
  return Number.isFinite(n) ? n : null
}

export function GoalPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/collections/goals')
  const money = useMoney()
  const { collections, decks, changeStorage, addToWishlist } = useSync()
  const { goals } = useGoals()
  const goal = goals.find((g) => g.id === id) ?? null
  const [show, setShow] = useState<'missing' | 'all'>('missing')
  const [message, setMessage] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [asking, setAsking] = useState(false)

  const base = useMemo(() => (goal ? goalProgress(goal, collections, decks) : null), [goal, collections, decks])
  // Prices as this browser knows them now, for the missing cards — fresher than the goal's own.
  const ids = useMemo(() => (base ? missingLines(base).map((l) => l.scryfallId).filter((x): x is string => !!x) : []), [base])
  const known = useCardData(ids)
  const prices = useMemo<GoalPrices>(() => {
    const out: GoalPrices = {}
    for (const [cid, c] of known ?? []) out[cid] = { usd: price(c.prices?.usd), usdFoil: price(c.prices?.usd_foil) }
    return out
  }, [known])
  const p = useMemo(() => (goal ? goalProgress(goal, collections, decks, prices) : null), [goal, collections, decks, prices])

  if (!goal || !p) {
    return (
      <>
        <PageHeader title="Goal" onBack={back} />
        <div className="content-scroll"><div className="empty-state">This goal isn't here any more.</div></div>
      </>
    )
  }

  const change = (next: typeof goal) => changeStorage((c) => saveGoal(c, { ...next, updatedAt: Date.now() }))
  const missing = missingLines(p)
  const lines = show === 'missing' ? missing : p.lines
  const wishlist = collections.find(isWishlist)?.entries ?? []
  const addMissing = () => {
    const adds = goalWishlistAdds(p, wishlist)
    if (adds.length === 0) { setMessage('Your Wishlist already has them all.'); return }
    addToWishlist(adds.map((w) => ({ scryfallId: w.scryfallId, name: w.name, imageUrl: w.imageUrl, quantity: w.quantity })))
    setMessage(adds.length === 1 ? '1 card put on your Wishlist.' : `${adds.length} cards put on your Wishlist.`)
  }
  const deckName = goal.kind === 'DECK' ? decks.find((d) => d.id === goal.deckId)?.name ?? null : null

  return (
    <>
      <PageHeader
        title={goal.name}
        eyebrow={`Goal · ${GOAL_KIND_LABELS[goal.kind]}${goal.foil ? ' · foil' : ''}`}
        onBack={back}
        actions={<>
          <button type="button" className="btn line" onClick={() => setRenaming(goal.name)}>Rename</button>
          <button type="button" className="btn line" onClick={() => setDeleting(true)}>Delete</button>
        </>}
      />
      <div className="content-scroll goal-page">
        <div className="goal-hero rise" style={rise(0)}>
          <div className="big-num">{p.have}/{p.need}<small>{p.percent}%</small></div>
          <GoalBar p={p} big />
          <div className="sub">
            {goal.completedAt != null
              ? `Completed ${new Date(goal.completedAt).toLocaleDateString()}${p.complete ? '' : ` · ${p.need - p.have} missing now`}`
              : missingLine(p, (usd) => money.format(usd))}
          </div>
          {goal.kind === 'DECK' && <div className="sub">{deckName ? `Follows ${deckName} as it changes.` : 'The deck is gone: this is its list from when the goal was made.'}</div>}
          <label className="goal-check" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={goal.countDecks === true} onChange={(e) => change({ ...goal, countDecks: e.target.checked })} />
            <span>Count cards in decks{goal.foil ? ' (foil copies a pull list brought in)' : ''}</span>
          </label>
        </div>

        {missing.length > 0 && (
          <div className="goal-actions rise" style={rise(1)}>
            <button type="button" className="btn gold" onClick={addMissing}><Icon name="star" aria-hidden />Add missing to Wishlist</button>
            <button type="button" className="btn line" onClick={() => setAsking(true)}><Icon name="person_search" aria-hidden />Offer a trade</button>
          </div>
        )}
        {message && <div className="muted" role="status" style={{ marginTop: 8 }}>{message}</div>}

        <div className="chips" style={{ marginTop: 14 }}>
          <PillChip label="Missing" count={missing.length} selected={show === 'missing'} onClick={() => setShow('missing')} />
          <PillChip label="All cards" count={p.lines.length} selected={show === 'all'} onClick={() => setShow('all')} />
        </div>
        <div className="goal-cards">
          {lines.length === 0 && <div className="empty-state"><Icon name="task_alt" />{p.need === 0 ? 'No cards in this goal yet.' : 'Nothing missing.'}</div>}
          {lines.map((l) => (
            <button key={l.key} type="button" className={`goal-card${l.missing === 0 ? ' have' : ''}`}
              onClick={() => navigate(`/card/${encodeURIComponent(l.name)}${l.scryfallId ? `?id=${l.scryfallId}` : ''}`)}>
              <ArtImage className="thumb" src={toArtCrop(l.imageUrl ?? null)} seed={l.name} />
              <span className="txt">
                <b>{l.name}</b>
                <span>{[l.number ? `#${l.number}` : null, l.rarity ?? null, l.missing > 0 && l.usd != null ? `${money.format(l.usd)} each` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="qty">{l.have}/{l.need}</span>
            </button>
          ))}
        </div>
      </div>

      {asking && (
        <WhoHasCardsSheet
          title="Offer a trade"
          subtitle={`${goal.name} · friends who have the missing cards`}
          cards={missing.map((l) => ({ scryfallId: l.scryfallId ?? '', name: l.name, imageUrl: l.imageUrl ?? null }))}
          onClose={() => setAsking(false)}
        />
      )}
      {renaming != null && (
        <Dialog
          title="Rename goal"
          onDismiss={() => setRenaming(null)}
          actions={<>
            <button type="button" className="btn line" onClick={() => setRenaming(null)}>Cancel</button>
            <button type="button" className="btn gold" disabled={!renaming.trim()} onClick={() => { change({ ...goal, name: renaming }); setRenaming(null) }}>Save</button>
          </>}
        >
          <input className="input" aria-label="Name" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title={`Delete ${goal.name}?`}
          onDismiss={() => setDeleting(false)}
          actions={<>
            <button type="button" className="btn line" onClick={() => setDeleting(false)}>Keep it</button>
            <button type="button" className="btn danger" onClick={() => { changeStorage((c) => deleteGoal(c, goal.id)); navigate('/collections/goals', { replace: true }) }}>Delete</button>
          </>}
        >
          <p className="muted" style={{ margin: 0 }}>The goal goes from every device. Your cards stay where they are.</p>
        </Dialog>
      )}
    </>
  )
}

/** A card picked for a list goal. */
interface Picked { name: string; scryfallId?: string; imageUrl?: string; usd?: number; usdFoil?: number; qty: number }

const pickedOf = (c: ScryfallCard, qty: number): Picked => ({
  name: c.name, scryfallId: c.id, imageUrl: displayImageUrl(c) ?? undefined, usd: price(c.prices?.usd) ?? undefined, usdFoil: price(c.prices?.usd_foil) ?? undefined, qty,
})

export function NewGoalPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const back = useBack('/collections/goals')
  const { decks, changeStorage } = useSync()
  const [kind, setKind] = useState<GoalKind | null>(() => (GOAL_KINDS as string[]).includes(params.get('kind') ?? '') ? params.get('kind') as GoalKind : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set goals
  const [sets, setSets] = useState<SetInfo[] | null>(null)
  const [setQuery, setSetQuery] = useState('')
  const [set, setSet] = useState<SetInfo | null>(null)
  const [setCards, setSetCards] = useState<ScryfallCard[] | null>(null)
  const [rarities, setRarities] = useState<string[]>([])
  const [foil, setFoil] = useState(false)
  useEffect(() => {
    if (kind !== 'SET' || sets) return
    getSets().then((m) => setSets([...m.values()].filter((s) => !s.digital && s.cardCount > 0).sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '')))).catch(() => setError("Couldn't fetch the sets from Scryfall."))
  }, [kind, sets])
  useEffect(() => {
    if (!set) return
    let cancelled = false
    setSetCards(null)
    getSetCards(set.code).then((c) => { if (!cancelled) setSetCards(c) }).catch(() => { if (!cancelled) setError("Couldn't fetch this set's cards from Scryfall.") })
    return () => { cancelled = true }
  }, [set])
  const matchingSets = useMemo(() => {
    const q = setQuery.trim().toLowerCase()
    return (sets ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.code === q).slice(0, 30)
  }, [sets, setQuery])

  // Deck goals
  const usable = decks.filter((d) => !d.sample && !isArchived(d))
  const [deckId, setDeckId] = useState<string>(() => params.get('deck') ?? usable[0]?.id ?? '')
  const [deckFoil, setDeckFoil] = useState(true)

  // List goals
  const [name, setName] = useState('')
  const [qty, setQty] = useState(GOAL_PLAYSET)
  const [picked, setPicked] = useState<Picked[]>([])
  const [pasted, setPasted] = useState('')
  const [searching, setSearching] = useState(false)
  const add = (p: Picked) => setPicked((list) => {
    const at = list.findIndex((x) => goalNameKey(x.name) === goalNameKey(p.name))
    return at < 0 ? [...list, p] : list.map((x, i) => (i === at ? { ...x, qty: kind === 'CUSTOM' ? x.qty + p.qty : x.qty } : x))
  })

  const finish = (goal: Parameters<typeof saveGoal>[1]) => {
    changeStorage((c) => saveGoal(c, goal))
    navigate(`/collections/goals/${encodeURIComponent(goal.id)}`, { replace: true })
  }

  const create = async () => {
    setError(null)
    const now = Date.now()
    if (kind === 'SET') {
      if (!set || !setCards) return
      finish(newSetGoal(newGoalId(), set, setCards.map(goalSetCard), rarities, foil, now))
    } else if (kind === 'DECK') {
      const deck = decks.find((d) => d.id === deckId)
      if (deck) finish(newDeckGoal(newGoalId(), deck, deckFoil, now))
    } else if (kind === 'PLAYSET' || kind === 'CUSTOM') {
      // The pasted list's cards, looked up for their pictures and prices; ones Scryfall doesn't know stay, by name.
      setBusy(true)
      const lines = parseCardList(pasted).lines.filter((l) => l.name)
      const fromPaste: Picked[] = lines.map((l) => ({ name: l.name!, qty: Math.max(1, l.quantity) }))
      try {
        const names = [...new Map(fromPaste.map((p) => [goalNameKey(p.name), p.name])).values()]
        const found = new Map<string, ScryfallCard>()
        // Scryfall answers 75 at a time.
        for (let i = 0; i < names.length; i += 75) {
          const r = await getCollection(names.slice(i, i + 75).map((n) => ({ name: n })))
          for (const c of r.data) found.set(goalNameKey(c.name), c)
        }
        for (let i = 0; i < fromPaste.length; i++) {
          const c = found.get(goalNameKey(fromPaste[i].name))
          if (c) fromPaste[i] = pickedOf(c, fromPaste[i].qty)
        }
      } catch { /* offline: kept by name */ }
      setBusy(false)
      const cards: GoalCard[] = [...picked, ...fromPaste]
      if (cards.length === 0) { setError('Add some cards first — search for them or paste a list.'); return }
      const fallback = kind === 'PLAYSET' ? `Playsets of ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}` : 'My list'
      finish(newListGoal(newGoalId(), kind, name.trim() || fallback, cards, kind === 'PLAYSET' ? qty : null, now))
    }
  }

  const ready = kind === 'SET' ? !!set && !!setCards : kind === 'DECK' ? !!deckId : kind != null
  return (
    <>
      <PageHeader title="New goal" onBack={kind ? () => { setKind(null); setError(null) } : back} />
      <div className="content-scroll goal-page recipe-page">
        {!kind && (
          <div className="recipe-list">
            {GOAL_KINDS.map((k) => (
              <button key={k} type="button" className="recipe-card" onClick={() => setKind(k)}>
                <Icon name={k === 'SET' ? 'grid_view' : k === 'PLAYSET' ? 'filter_4' : k === 'DECK' ? 'auto_awesome' : 'checklist'} aria-hidden />
                <span className="txt"><b>{GOAL_KIND_LABELS[k]}</b><span className="sub">{GOAL_KIND_DETAILS[k]}</span></span>
              </button>
            ))}
          </div>
        )}

        {kind === 'SET' && (
          <>
            <div className="recipe-h" style={{ marginTop: 0 }}>Set</div>
            {set ? (
              <div className="recipe-box">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <b style={{ flex: 1 }}>{set.name} <span className="dim">· {set.code.toUpperCase()}</span></b>
                  <button type="button" className="link" onClick={() => { setSet(null); setSetCards(null) }}>Change</button>
                </div>
                {!setCards && <div className="dim">Fetching its cards…</div>}
              </div>
            ) : (
              <>
                <input className="input" aria-label="Find a set" placeholder="Find a set — Duskmourn, BLB…" value={setQuery} onChange={(e) => setSetQuery(e.target.value)} autoFocus />
                <div className="goal-sets" style={{ marginTop: 8 }}>
                  {!sets && !error && <div className="dim">Fetching the sets…</div>}
                  {matchingSets.map((s) => (
                    <button key={s.code} type="button" className="goal-card" onClick={() => setSet(s)}>
                      <span className="txt"><b>{s.name}</b><span>{s.code.toUpperCase()} · {s.cardCount} cards{s.releasedAt ? ` · ${s.releasedAt.slice(0, 4)}` : ''}</span></span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {set && (
              <div style={{ marginTop: 14 }}>
                <SetGoalOptions setName={set.name} rarities={rarities} foil={foil} onRarities={setRarities} onFoil={setFoil} cards={setCards ? setCards.map(goalSetCard) : null} />
              </div>
            )}
          </>
        )}

        {kind === 'DECK' && (
          <>
            <div className="recipe-h" style={{ marginTop: 0 }}>Deck</div>
            {usable.length === 0 ? <div className="empty-state">No decks yet.</div> : (
              <select className="input" aria-label="Deck" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <div className="recipe-box" style={{ marginTop: 10 }}>
              <label><input type="checkbox" checked={deckFoil} onChange={(e) => setDeckFoil(e.target.checked)} /><span>In foil — every card of the deck foil</span></label>
            </div>
            <p className="dim" style={{ fontSize: 13 }}>The goal follows the deck as it changes. Basic lands are left out; copies in decks count, so foils already in the deck do.</p>
          </>
        )}

        {(kind === 'PLAYSET' || kind === 'CUSTOM') && (
          <>
            <label className="recipe-h" htmlFor="goal-name" style={{ display: 'block', marginTop: 0 }}>Name</label>
            <input id="goal-name" className="input" placeholder={kind === 'PLAYSET' ? 'Shock lands' : 'My list'} value={name} onChange={(e) => setName(e.target.value)} />
            {kind === 'PLAYSET' && (
              <>
                <label className="recipe-h" htmlFor="goal-qty" style={{ display: 'block' }}>Copies of each</label>
                <input id="goal-qty" className="input" type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || GOAL_PLAYSET)))} style={{ maxWidth: 120 }} />
              </>
            )}
            <div className="recipe-h">Cards</div>
            <div className="goal-picked">
              {picked.map((p, i) => (
                <div key={goalNameKey(p.name)} className="goal-picked-row">
                  <span>{p.name}</span>
                  {kind === 'CUSTOM' && (
                    <input className="input" type="number" min={1} max={99} aria-label={`Copies of ${p.name}`} value={p.qty}
                      onChange={(e) => setPicked(picked.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.min(99, Number(e.target.value) || 1)) } : x)))} />
                  )}
                  <button type="button" className="link" onClick={() => setPicked(picked.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <button type="button" className="recipe-add" onClick={() => setSearching(true)}>+ Search for a card</button>
            </div>
            <label className="recipe-h" htmlFor="goal-paste" style={{ display: 'block' }}>Or paste a list</label>
            <textarea id="goal-paste" className="input" rows={6} placeholder={kind === 'PLAYSET' ? 'Steam Vents\nSacred Foundry\nBlood Crypt' : '4 Lightning Bolt\n2 Counterspell'} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </>
        )}

        {error && <div className="notice warn" style={{ marginTop: 12 }}>{error}</div>}
        {kind && (
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn gold" disabled={!ready || busy} onClick={() => void create()}>{busy ? 'Looking up the cards…' : 'Make it a goal'}</button>
          </div>
        )}
      </div>

      {searching && (
        <Dialog title="Search for a card" onDismiss={() => setSearching(false)} actions={<button type="button" className="btn gold" onClick={() => setSearching(false)}>Done</button>}>
          <CardSearchResults autoFocus onAdd={(c) => add(pickedOf(c, kind === 'PLAYSET' ? qty : 1))} />
        </Dialog>
      )}
    </>
  )
}
