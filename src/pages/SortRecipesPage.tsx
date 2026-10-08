import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { cardsIn, placesOf, placeTree } from '../collection/storagePlaces'
import { BY_RULE } from '../collection/sortPiles'
import { addedMove, putAwayMove } from '../collection/copyHistory'
import { recordMoves } from '../collection/copyHistoryStore'
import {
  APART_KINDS, APART_LABELS, capWarning, derivePiles, fileRecipe, isTemplate, LEVEL_BYS, LEVEL_LABELS, levelLine, MAX_LEVELS, newRecipe,
  pileGoesTo, pileSignsHtml, recipeLine, recipesOf, recipeTemplates, saveRecipe, deleteRecipe, SMART_KINDS, SMART_LABELS, sortRecipe, splitLevel,
  summarize, withGoTo, type LevelBy, type Paper, type RecipePile, type SortRecipe, type SplitLevel,
} from '../collection/sortRecipes'
import {
  lastRecipeId, loadRecipeSession, loadVoice, printHtml, saveRecipeSession, saveVoice, setLastRecipeId, startRecipeSession, type RecipeVoice,
} from '../collection/recipeSession'
import type { FiledPiles } from '../collection/sortPiles'
import '../collection/storage.css'
import '../collection/inventory.css'
import '../collection/recipes.css'

/**
 * Sorting a pile with a recipe — the Android app's SortRecipesScreen (the scansort mockups): pick a
 * recipe (yours, or start from one), build your own, lay out the piles (print their signs, how you'll
 * hear them), and, once the scanner's Done, what went where. The logic is collection/sortRecipes.ts;
 * the scanning is ScanPage.tsx's ?recipe mode. At /sort (?edit=<id>, ?layout=<id>, ?summary).
 */
export function SortRecipesPage() {
  const [params] = useSearchParams()
  const { collections } = useSync()
  // The sets the binders kept in order by set collect, for Binder by set.
  const setBinderIds = useMemo(() => placesOf(collections).filter((p) => p.kind === 'BINDER' && p.sortRule === 'SET')
    .flatMap((p) => cardsIn(collections, p.id).map((c) => c.entry.scryfallId)), [collections])
  const data = useCardData(setBinderIds)
  const sets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const id of setBinderIds) { const s = data?.get(id)?.set; if (s) counts.set(s, (counts.get(s) ?? 0) + 1) }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([s]) => s)
  }, [setBinderIds, data])
  const templates = recipeTemplates(sets)
  const find = (id: string | null): SortRecipe | null => (id ? recipesOf(collections).find((r) => r.id === id) ?? templates.find((r) => r.id === id) ?? null : null)
  const edit = params.get('edit')
  const layout = params.get('layout')
  if (params.has('summary')) return <RecipeSummaryView />
  if (edit) return <RecipeEditor key={edit} start={edit === 'new' ? null : find(edit)} />
  if (layout) {
    const r = find(layout)
    if (r) return <RecipeLayout key={layout} start={r} />
  }
  return <RecipePicker templates={templates} />
}

function useFmt() {
  const money = useMoney()
  return { money, fmt: (n: number) => money.formatLocal(n, Number.isInteger(n)) }
}

function RecipePicker({ templates }: { templates: SortRecipe[] }) {
  const navigate = useNavigate()
  const back = useBack('/collections')
  const { collections } = useSync()
  const { fmt } = useFmt()
  const mine = recipesOf(collections)
  const last = lastRecipeId()
  const ordered = [...mine].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : 0))
  const session = loadRecipeSession()
  return (
    <>
      <PageHeader title="Sort a pile" eyebrow="How should this pile split?" onBack={back} />
      <div className="content-scroll recipe-page">
        {session && session.scans.length > 0 && (
          <div className="rsum-miss" style={{ background: 'var(--gold-soft)', marginTop: 0 }}>
            <span>{session.scans.length} {session.scans.length === 1 ? 'card' : 'cards'} sorted with {session.recipe.name}, not filed yet</span>
            <button type="button" className="link" onClick={() => navigate('/sort?summary')}>See them</button>
            <button type="button" className="link" onClick={() => navigate('/scan?recipe')}>Keep going</button>
          </div>
        )}
        {ordered.length > 0 && (
          <>
            <div className="recipe-h">Your recipes</div>
            <div className="recipe-list">
              {ordered.map((r) => (
                <button key={r.id} type="button" className="recipe-card mine" onClick={() => navigate(`/sort?layout=${encodeURIComponent(r.id)}`)}>
                  <span className="txt"><b>{r.name}</b><span className="sub">{recipeLine(r, fmt)}</span></span>
                  {r.id === last && <span className="tag">Last used</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="recipe-h">Start from</div>
        <div className="recipe-list">
          {templates.map((r) => (
            <button key={r.id} type="button" className="recipe-card" onClick={() => navigate(`/sort?layout=${r.id}`)}>
              <span className="txt"><b>{r.name}</b><span className="sub">{templateLine(r, fmt)}</span></span>
            </button>
          ))}
          {/* The first sorter, as it was: up to six piles by rules. */}
          <button type="button" className="recipe-card" onClick={() => navigate('/scan?sort')}>
            <span className="txt"><b>Keep, spares, decks, bulk</b><span className="sub">Rares worth keeping · spares · wanted by a deck · bulk by your boxes' rules</span></span>
          </button>
        </div>
        <div className="recipe-note">
          <Icon name="add" aria-hidden style={{ color: 'var(--gold)' }} />
          Smart piles go first in every recipe: deck needs, friends' wants, binder gaps.
        </div>
      </div>
      <div className="pull-bar">
        <button type="button" className="btn line" style={{ flex: 1 }} onClick={() => navigate('/sort?edit=new')}>Make your own recipe</button>
      </div>
    </>
  )
}

/** The templates' lines, as the mockup words them. */
function templateLine(r: SortRecipe, fmt: (n: number) => string): string {
  switch (r.id) {
    case 'tpl-colour': return 'W · U · B · R · G · Multi · Colourless · Lands'
    case 'tpl-set': return 'One pile per set, then collector number'
    case 'tpl-value': return levelLine(r.levels[0], fmt)
    case 'tpl-needs': return 'Decks need it · friends want it · binder gaps · trade · bulk'
    default: return recipeLine(r, fmt)
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`)

function RecipeEditor({ start }: { start: SortRecipe | null }) {
  const navigate = useNavigate()
  const back = useBack('/sort')
  const { changeStorage } = useSync()
  const { money, fmt } = useFmt()
  const [draft, setDraft] = useState<SortRecipe>(() => (start ? { ...sortRecipe(start), ...(isTemplate(start) ? { id: newId(), createdAt: Date.now() } : {}) } : newRecipe(newId(), Date.now())))
  const [open, setOpen] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const derived = derivePiles(draft, fmt)
  const warning = capWarning(derived)
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  const setLevel = (i: number, l: SplitLevel) => setDraft((d) => ({ ...d, levels: d.levels.map((x, j) => (j === i ? l : x)) }))
  const save = () => {
    const r = sortRecipe(draft)
    changeStorage((c) => saveRecipe(c, r))
    navigate(`/sort?layout=${encodeURIComponent(r.id)}`, { replace: true })
  }
  const saved = !!start && !isTemplate(start)
  return (
    <>
      <PageHeader
        title={saved ? 'Change recipe' : 'New recipe'}
        onBack={back}
        actions={saved ? <button type="button" className="btn line" onClick={() => setConfirmDelete(true)}>Delete</button> : undefined}
      />
      <div className="content-scroll recipe-page">
        <label className="recipe-h" htmlFor="recipe-name" style={{ display: 'block', marginTop: 0 }}>Name</label>
        <input id="recipe-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

        <div className="recipe-h">First, pull out</div>
        <div className="recipe-box">
          {SMART_KINDS.map((k) => (
            <label key={k}>
              <input type="checkbox" checked={draft.pullOut.includes(k)} onChange={() => setDraft({ ...draft, pullOut: SMART_KINDS.filter((x) => (x === k ? !draft.pullOut.includes(k) : draft.pullOut.includes(x))) })} />
              <span>{SMART_LABELS[k]}</span>
            </label>
          ))}
        </div>

        <div className="recipe-h">Then split the rest by</div>
        <div className="recipe-list">
          {draft.levels.map((l, i) => (
            <div key={i} className="recipe-level">
              <div className="recipe-level-h">
                <span className={`n${i === 0 ? ' first' : ''}`}>{i + 1}</span>
                <div className="txt"><b>{LEVEL_LABELS[l.by]}</b><span>{levelLine(l, fmt)}</span></div>
                <button type="button" className="link" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Done' : 'Change'}</button>
              </div>
              {open === i && (
                <LevelEditor
                  level={l}
                  currency={money.currency.code}
                  onChange={(next) => setLevel(i, next)}
                  onRemove={() => { setDraft({ ...draft, levels: draft.levels.filter((_, j) => j !== i) }); setOpen(null) }}
                />
              )}
            </div>
          ))}
          {draft.levels.length < MAX_LEVELS && (
            <button type="button" className="recipe-add" onClick={() => { setDraft({ ...draft, levels: [...draft.levels, splitLevel({ by: draft.levels.some((l) => l.by === 'COLOUR') ? 'RARITY' : 'COLOUR' })] }); setOpen(draft.levels.length) }}>
              + Add a level (set, mana value, rarity, type, A–Z…)
            </button>
          )}
        </div>

        <div className="recipe-h">Also keep apart</div>
        <div className="recipe-chips">
          {APART_KINDS.map((k) => (
            <button key={k} type="button" className={`pull-chip${draft.apart.includes(k) ? ' on' : ''}`} aria-pressed={draft.apart.includes(k)}
              onClick={() => setDraft({ ...draft, apart: APART_KINDS.filter((x) => toggle(draft.apart, k).includes(x)) })}
            >{APART_LABELS[k]}</button>
          ))}
        </div>
        {warning && <div className="space-warn" role="status" style={{ marginTop: 12 }}>{warning}</div>}
      </div>
      <div className="pull-bar recipe-foot">
        <span className="count">{derived.piles.length} {derived.piles.length === 1 ? 'pile' : 'piles'}</span>
        <button type="button" className="btn gold" onClick={save}>Save and lay out</button>
      </div>
      {confirmDelete && start && (
        <Dialog
          title={`Delete ${start.name}?`}
          onDismiss={() => setConfirmDelete(false)}
          actions={<>
            <button type="button" className="btn line" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button type="button" className="btn danger" onClick={() => { changeStorage((c) => deleteRecipe(c, start.id)); navigate('/sort', { replace: true }) }}>Delete</button>
          </>}
        >
          <p className="muted" style={{ margin: 0 }}>The recipe goes from every device. Cards already sorted stay where they are.</p>
        </Dialog>
      )}
    </>
  )
}

const numbers = (text: string) => text.split(/[,;\s]+/).map((t) => Number(t.replace(',', '.'))).filter((n) => Number.isFinite(n))

/** One level's settings: what it splits by, and its bands, ranges or sets. */
function LevelEditor({ level, currency, onChange, onRemove }: { level: SplitLevel; currency: string; onChange: (l: SplitLevel) => void; onRemove: () => void }) {
  const [text, setText] = useState(() => textOf(level))
  const change = (l: SplitLevel) => { onChange(splitLevel(l)); setText(textOf(splitLevel(l))) }
  const apply = (t: string) => {
    if (level.by === 'VALUE' || level.by === 'MANA_VALUE' || level.by === 'NUMBER') onChange(splitLevel({ ...level, cuts: numbers(t) }))
    else if (level.by === 'NAME') onChange(splitLevel({ ...level, letters: t.split(/[,;\s]+/) }))
    else if (level.by === 'SET') onChange(splitLevel({ ...level, sets: t.split(/[,;\s]+/) }))
  }
  const hint: Partial<Record<LevelBy, string>> = {
    VALUE: `Band edges in ${currency}, like 20, 5, 1`,
    MANA_VALUE: 'Where each pile starts, like 0, 2, 3, 4, 5',
    NUMBER: 'Where each pile starts, like 1, 100, 200',
    NAME: 'Where each range starts, like A, F, L, R',
    SET: 'Set codes, like DSK, BLB',
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select className="input" aria-label="Split by" value={level.by} onChange={(e) => change({ by: e.target.value as LevelBy })}>
        {LEVEL_BYS.map((b) => <option key={b} value={b}>{LEVEL_LABELS[b]}</option>)}
      </select>
      {hint[level.by] && (
        <input className="input" aria-label={hint[level.by]} placeholder={hint[level.by]} value={text}
          onChange={(e) => { setText(e.target.value); apply(e.target.value) }} onBlur={() => setText(textOf(level))} />
      )}
      {level.by === 'VALUE' && (
        <label className="recipe-box" style={{ padding: 0, background: 'none' }}>
          <input type="checkbox" checked={!!level.restOn} onChange={(e) => change({ ...level, restOn: e.target.checked })} />
          <span>Only the top bands apart; the rest go on to the next level</span>
        </label>
      )}
      {level.by === 'COLOUR' && (
        <label className="recipe-box" style={{ padding: 0, background: 'none' }}>
          <input type="checkbox" checked={!!level.lands} onChange={(e) => change({ ...level, lands: e.target.checked })} />
          <span>Lands in a pile of their own</span>
        </label>
      )}
      <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={onRemove}>Remove this level</button>
    </div>
  )
}

function textOf(l: SplitLevel): string {
  if (l.cuts) return l.cuts.join(', ')
  if (l.letters) return l.letters.join(', ')
  if (l.sets) return l.sets.map((s) => s.toUpperCase()).join(', ')
  return ''
}

function RecipeLayout({ start }: { start: SortRecipe }) {
  const navigate = useNavigate()
  const back = useBack('/sort')
  const { collections, changeStorage } = useSync()
  const { fmt } = useFmt()
  const [draft, setDraft] = useState(() => sortRecipe(start))
  const [voice, setVoiceState] = useState<RecipeVoice>(loadVoice)
  const [placing, setPlacing] = useState<RecipePile | null>(null)
  const [printing, setPrinting] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const derived = derivePiles(draft, fmt)
  const warning = capWarning(derived)
  const places = placesOf(collections)
  const setVoice = (v: RecipeVoice) => { setVoiceState(v); saveVoice(v) }
  const goesTo = (p: RecipePile) => {
    if (p.key === 'S:DECKS') return 'For their decks'
    if (p.key === 'S:BINDER') return 'Into its binder'
    const to = pileGoesTo(draft, p)
    return to === BY_RULE ? 'Box whose rule fits' : to ? places.find((x) => x.id === to)?.name ?? 'No place' : 'Unsorted'
  }
  const begin = () => {
    if (!isTemplate(draft) && JSON.stringify(sortRecipe(start)) !== JSON.stringify(draft)) changeStorage((c) => saveRecipe(c, draft))
    if (!isTemplate(draft)) setLastRecipeId(draft.id)
    saveRecipeSession(startRecipeSession(draft))
    navigate('/scan?recipe')
  }
  const session = loadRecipeSession()
  return (
    <>
      <PageHeader
        title={`Lay out ${derived.piles.length} ${derived.piles.length === 1 ? 'pile' : 'piles'}`}
        eyebrow={`${draft.name} · left to right on the table`}
        onBack={back}
        actions={<button type="button" className="btn line" onClick={() => navigate(`/sort?edit=${encodeURIComponent(draft.id)}`)}>Change</button>}
      />
      <div className="content-scroll recipe-page">
        {warning && <div className="space-warn" role="status" style={{ marginBottom: 10 }}>{warning}</div>}
        <div className="pile-grid">
          {derived.piles.map((p) => {
            const fixed = p.key === 'S:DECKS' || p.key === 'S:BINDER'
            return (
              <button key={p.key} type="button" className="pile-tile" style={{ ['--band' as string]: p.band }} disabled={fixed}
                aria-label={`Pile ${p.number}, ${p.name}, goes to ${goesTo(p)}${fixed ? '' : ' — change'}`} onClick={() => setPlacing(p)}
              >
                <span className="num">{p.number}</span>
                <span className="nm">{p.name}</span>
                <span className="to">{goesTo(p)}</span>
              </button>
            )
          })}
        </div>
        <section className="recipe-hear">
          <h2>How you'll hear it</h2>
          <label><span>Say the pile out loud ("Seven, blue")</span><input type="checkbox" checked={voice.speak} onChange={(e) => setVoice({ ...voice, speak: e.target.checked })} /></label>
          <label><span>Capture without tapping</span><input type="checkbox" checked={voice.auto} onChange={(e) => setVoice({ ...voice, auto: e.target.checked })} /></label>
          <span className="dim">{voice.auto ? 'Hold a card still under the camera; take it away and show the next.' : 'Tap Scan now for each card.'}</span>
        </section>
      </div>
      <div className="pull-bar">
        <button type="button" className="btn line" onClick={() => setPrinting(true)}><Icon name="print" aria-hidden />Print pile signs</button>
        <button type="button" className="btn gold" onClick={() => (session && session.scans.length > 0 ? setReplacing(true) : begin())}>Start scanning</button>
      </div>
      {placing && (
        <Dialog title={`Where pile ${placing.number} goes`} onDismiss={() => setPlacing(null)}>
          <div className="recipe-list">
            {[{ id: BY_RULE, name: 'The box whose rule fits' }, { id: '', name: 'No place (Unsorted)' }, ...placeTree(places).map((n) => ({ id: n.place.id, name: `${'  '.repeat(n.depth)}${n.place.name}` }))].map((o) => (
              <button key={o.id || 'none'} type="button" className={`recipe-card${pileGoesTo(draft, placing) === o.id ? ' mine' : ''}`}
                onClick={() => { setDraft(withGoTo(draft, placing.key, o.id)); setPlacing(null) }}
              ><span className="txt"><b>{o.name}</b></span></button>
            ))}
          </div>
        </Dialog>
      )}
      {printing && (
        <Dialog title="Print pile signs" onDismiss={() => setPrinting(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Two signs to a page: the pile's number, big, and its name — one by each pile.</p>
          <div className="recipe-chips">
            {(['A4', 'LETTER'] as Paper[]).map((paper) => (
              <button key={paper} type="button" className="btn line" onClick={() => { printHtml(pileSignsHtml(derived.piles, paper, `${draft.name}: pile signs`)); setPrinting(false) }}>
                <Icon name="print" aria-hidden />{paper === 'A4' ? 'A4' : 'Letter'}
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {replacing && session && (
        <Dialog
          title="Start a new sort?"
          onDismiss={() => setReplacing(false)}
          actions={<>
            <button type="button" className="btn line" onClick={() => navigate('/sort?summary')}>File those first</button>
            <button type="button" className="btn danger" onClick={begin}>Start again</button>
          </>}
        >
          <p className="muted" style={{ margin: 0 }}>{session.scans.length} {session.scans.length === 1 ? 'card' : 'cards'} sorted with {session.recipe.name} haven't been filed. Starting again forgets them.</p>
        </Dialog>
      )}
    </>
  )
}

function RecipeSummaryView() {
  const navigate = useNavigate()
  const back = useBack('/sort')
  const { collections, changeStorage } = useSync()
  const { money, fmt } = useFmt()
  const [session, setSession] = useState(loadRecipeSession)
  const [checkingMisses, setCheckingMisses] = useState(false)
  const [choosingPile, setChoosingPile] = useState(false)
  const [filed, setFiled] = useState<{ count: number; binders: { id: string; name: string }[] } | null>(null)
  if (filed) {
    return (
      <>
        <PageHeader title={`Filed ${filed.count} ${filed.count === 1 ? 'card' : 'cards'}`} onBack={() => navigate('/collections')} />
        <div className="content-scroll recipe-page">
          <p className="muted">They're in your collection, each where its pile goes. Cards for a binder in order wait beside it to be fitted in.</p>
          <div className="recipe-list">
            {filed.binders.map((b) => (
              <button key={b.id} type="button" className="recipe-card" onClick={() => navigate(`/collections/place/${b.id}/fit`)}>
                <span className="txt"><b>Fit in order: {b.name}</b><span className="sub">The steps say where each goes, page and slot.</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="pull-bar"><button type="button" className="btn gold" onClick={() => navigate('/sort')}>Done</button></div>
      </>
    )
  }
  if (!session) {
    return (
      <>
        <PageHeader title="Sorted" onBack={back} />
        <div className="content-scroll recipe-page"><div className="empty-state"><Icon name="call_split" /><div>Nothing being sorted right now.</div></div></div>
      </>
    )
  }
  const derived = derivePiles(session.recipe, fmt)
  const sum = summarize(session.recipe, derived, session.scans)
  const lastAt = session.scans.reduce((n, s) => Math.max(n, s.at ?? 0), 0)
  const minutes = lastAt > session.startedAt ? Math.max(1, Math.round((lastAt - session.startedAt) / 60000)) : 0
  const friendsPile = derived.piles.find((p) => p.key === 'S:FRIENDS')
  const byFriend = new Map<string, typeof session.scans>()
  for (const s of session.scans) if (friendsPile && s.pile === friendsPile.number && s.reason?.kind === 'FRIENDS') byFriend.set(s.reason.friend, [...(byFriend.get(s.reason.friend) ?? []), s])
  const fileWords = fileLine(session.recipe, derived.piles, session.scans, placesOf(collections).map((p) => ({ id: p.id, name: p.name })))
  const update = (next: typeof session) => { saveRecipeSession(next); setSession(next) }
  const fileAll = () => {
    const at = Date.now()
    let done: FiledPiles | null = null
    changeStorage((c) => { done = fileRecipe(c, session.recipe, derived, session.scans); return (done as FiledPiles).collections })
    const result = done as FiledPiles | null
    if (result) {
      const placeOf = (id: string | undefined) => (id ? placesOf(result.collections).find((p) => p.id === id) ?? null : null)
      recordMoves(result.steps.map(({ scan, step, to }) => {
        const place = placeOf(step?.to.placeId)
        return step?.from
          ? putAwayMove(at, scan, 1, place ? { id: place.id, name: to } : { id: '', name: to }, placeOf(step.from.placeId), 'sorting a pile')
          : addedMove(at, scan, 1, place ? { id: place.id, name: to } : null, session.recipe.name)
      }))
    }
    const binders = [...new Set(session.scans.filter((s) => !s.filed && s.reason?.kind === 'BINDER').map((s) => (s.reason as { placeId: string }).placeId))]
      .map((id) => ({ id, name: placesOf(collections).find((p) => p.id === id)?.name ?? 'Binder' }))
    saveRecipeSession(null)
    setFiled({ count: session.scans.filter((s) => !s.filed).length, binders })
  }
  return (
    <>
      <PageHeader title={`Sorted ${sum.cards} ${sum.cards === 1 ? 'card' : 'cards'}`} eyebrow={[session.recipe.name, minutes ? `${minutes} min` : '', `${money.format(sum.usd, true)} in all`].filter(Boolean).join(' · ')} onBack={back} />
      <div className="content-scroll recipe-page">
        <div className="rsum-rows">
          {sum.rows.map((r) => {
            const band = derived.piles.find((p) => p.number === r.from)?.band
            return (
              <div key={`${r.from}-${r.to}`} className="rsum-row">
                <span className="num" style={{ color: r.from === r.to ? band : 'var(--t1)' }}>{r.from === r.to ? r.from : `${r.from}–${r.to}`}</span>
                <span className="nm">{r.name} · {r.cards}</span>
                <span className="dim">{r.detail ?? money.format(r.usd, r.usd >= 10)}</span>
              </div>
            )
          })}
          {sum.rows.length === 0 && <div className="empty-state">No cards sorted yet.</div>}
        </div>
        {session.misses.length > 0 && (
          <div className="rsum-miss">
            <span>{session.misses.length} {session.misses.length === 1 ? "card couldn't" : "cards couldn't"} be read</span>
            <button type="button" className="link" onClick={() => setCheckingMisses(true)}>Check them</button>
          </div>
        )}
        {session.scans.length > 0 && (
          <section className="rsum-file">
            <h2>File them</h2>
            <span className="dim">{fileWords}</span>
            <button type="button" className="link" onClick={() => setChoosingPile(true)}>Check a pile (rescan to catch mistakes)</button>
            {friendsPile && byFriend.size > 0 && (
              <>
                <span className="dim">Offer pile {friendsPile.number} to {[...byFriend.keys()].join(' and ')}:</span>
                <div className="recipe-chips">
                  {[...byFriend].map(([friend, scans]) => (
                    <button key={friend} type="button" className="btn line"
                      onClick={() => navigate(`/trades/new?to=${encodeURIComponent(friend)}`, { state: { give: scans.map((s) => ({ scryfallId: s.scryfallId, name: s.name, imageUrl: s.entry.imageUrl, foil: !!s.card.foil, quantity: 1 })) } })}
                    >Offer to {friend}</button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
      <div className="pull-bar">
        <button type="button" className="btn line" onClick={() => navigate('/scan?recipe')}>Keep going</button>
        <button type="button" className="btn gold" disabled={session.scans.every((s) => s.filed)} onClick={fileAll}>File everything</button>
      </div>
      {checkingMisses && (
        <Dialog
          title="Couldn't read these"
          onDismiss={() => setCheckingMisses(false)}
          actions={<>
            <button type="button" className="btn line" onClick={() => { update({ ...session, misses: [] }); setCheckingMisses(false) }}>Clear the list</button>
            <button type="button" className="btn gold" onClick={() => navigate('/scan?recipe')}>Scan them again</button>
          </>}
        >
          <p className="muted" style={{ marginTop: 0 }}>Find them in the piles by what the camera made of them, then scan them again — or type their names on the scanner.</p>
          <div className="rsum-rows">
            {session.misses.map((m, i) => (
              <div key={i} className="rsum-row"><span className="nm">“{m.seen || '…'}”</span>
                <button type="button" className="link" onClick={() => update({ ...session, misses: session.misses.filter((_, j) => j !== i) })}>Found it</button>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {choosingPile && (
        <Dialog title="Check which pile?" onDismiss={() => setChoosingPile(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Scan the pile again: any card that doesn't belong in it is flagged.</p>
          <div className="recipe-list">
            {derived.piles.filter((p) => session.scans.some((s) => s.pile === p.number)).map((p) => (
              <button key={p.key} type="button" className="recipe-card" onClick={() => { update({ ...session, checking: { pile: p.number, checked: [], flagged: [] } }); navigate('/scan?recipe') }}>
                <span className="txt"><b>Pile {p.number} · {p.name}</b><span className="sub">{session.scans.filter((s) => s.pile === p.number).length} cards</span></span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}

/** "File them" in words: where the piles go — the boxes by rule, the binders with page and slot, the decks. */
function fileLine(recipe: SortRecipe, piles: RecipePile[], scans: { pile: number; filed?: boolean; reason?: { kind: string; binder?: string } | null }[], places: { id: string; name: string }[]): string {
  const live = scans.filter((s) => !s.filed)
  const used = piles.filter((p) => live.some((s) => s.pile === p.number))
  const parts: string[] = []
  const range = (list: RecipePile[]) => (list.length === 1 ? `Pile ${list[0].number}` : `Piles ${list[0].number}–${list[list.length - 1].number}`)
  const byRule = used.filter((p) => p.key !== 'S:DECKS' && p.key !== 'S:BINDER' && pileGoesTo(recipe, p) === BY_RULE)
  if (byRule.length > 0) parts.push(`${range(byRule)} ${byRule.length === 1 ? 'goes' : 'go'} to the boxes whose rules fit`)
  for (const p of used) {
    const to = pileGoesTo(recipe, p)
    if (p.key === 'S:BINDER') {
      const binders = [...new Set(live.filter((s) => s.pile === p.number).map((s) => s.reason?.binder).filter(Boolean))]
      parts.push(`${p.number} to the ${binders.join(' and ')} ${binders.length === 1 ? 'binder' : 'binders'} with page and slot`)
    } else if (p.key === 'S:DECKS') parts.push(`${p.number} with no place, for the decks' pull lists`)
    else if (to && to !== BY_RULE) parts.push(`${p.number} to ${places.find((x) => x.id === to)?.name ?? 'its place'}`)
    else if (!to) parts.push(`${p.number} to Unsorted`)
  }
  return parts.length > 0 ? `${parts.join('; ')}.` : 'Everything here is filed already.'
}
