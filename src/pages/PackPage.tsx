import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, useBack } from '../components/kit'
import { EmptyState } from '../components/EmptyState'
import { useCardData } from '../collection/cardData'
import { dayOf } from '../collection/copyHistoryStore'
import { deleteBag, saveBag, useBags } from '../collection/bagStore'
import {
  allTicked, BAG_SECTION_LABELS, bagHeading, bagLines, homeSummary, isTicked, namesFrom, newBag, setComingHome, shownLines, tickAll, toggleTick,
  type BagSection, type BorrowedFrom, type WantedBy,
} from '../collection/eventBag'
import { gearOf } from '../collection/gear'
import { cardsIn, placesOf } from '../collection/storagePlaces'
import { countersNeeded, tokensToBring, type TokenToBring } from '../decks/tokens'
import { useGameNight } from '../lifecounter/gameNightStore'
import { useEvents } from '../tournament/events'
import { useOverview } from '../social/SocialContext'
import * as more from '../social/more'
import { friendsWantHere } from '../social/friendsWant'
import { myBorrowedLoans } from '../social/api'
import type { Deck } from '../types/models'
import '../collection/storage.css'
import '../collection/bag.css'

const newId = () => crypto.randomUUID()

/** What a new bag starts with: from tonight's game night, an event, or nothing ("Pack for…"). */
interface Draft { name: string; day: string; who: string; deckIds: string[] }

/**
 * Pack your bag, the Android app's PackScreen: the bags being packed on this browser, and new ones —
 * for tonight's game night, an event, or a quick "Pack for…" with a name and a day. The logic is
 * collection/eventBag.ts; the ticks stay in this browser (bagStore.ts). At /play/pack.
 */
export function PackListPage() {
  const navigate = useNavigate()
  const back = useBack('/play')
  const bags = useBags()
  const { decks } = useSync()
  const { night } = useGameNight()
  const events = useEvents().filter((e) => !e.finished)
  const [draft, setDraft] = useState<Draft | null>(null)
  const today = dayOf(Date.now())

  const fromNight = (): Draft => ({
    name: 'Game night', day: today,
    who: night.players.filter((p) => p.kind !== 'ME').map((p) => p.name).join(', '),
    deckIds: night.players.filter((p) => p.kind === 'ME' && p.deckId).map((p) => p.deckId!),
  })

  return (
    <>
      <PageHeader title="Pack your bag" onBack={back} />
      <div className="content-scroll pull-page">
        <div className="storage-list">
          {bags.length === 0 && (
            <EmptyState icon="backpack" text="Pack for a game night or an event: the decks, their tokens and counters, dice and playmat, the cards friends want and what to give back." />
          )}
          {bags.map((b) => (
            <button key={b.id} type="button" className="storage-card storage-row press" onClick={() => navigate(`/play/pack/${b.id}`)}>
              <Icon name={b.comingHome ? 'home' : 'backpack'} className="storage-icon gold" />
              <div className="storage-text"><b>{b.name}</b><span>{bagHeading(b, today).split(' · ')[0]}{b.comingHome ? ' · Coming home' : ''}</span></div>
              <Icon name="chevron_right" aria-hidden />
            </button>
          ))}
          <div className="place-actions">
            {night.players.length > 1 && <button type="button" className="btn soft" onClick={() => setDraft(fromNight())}><Icon name="groups" aria-hidden />Tonight's game night</button>}
            {events.map((e) => (
              <button key={e.id} type="button" className="btn line" onClick={() => setDraft({ name: e.name, day: dayOf(e.createdAt), who: e.players.map((p) => p.name).join(', '), deckIds: [] })}>
                <Icon name="emoji_events" aria-hidden />{e.name}
              </button>
            ))}
            <button type="button" className="btn gold" onClick={() => setDraft({ name: '', day: today, who: '', deckIds: [] })}><Icon name="add" aria-hidden />Pack for…</button>
          </div>
        </div>
      </div>
      {draft && (
        <BagDialog
          draft={draft}
          decks={decks}
          onDismiss={() => setDraft(null)}
          onSave={(d) => {
            const bag = newBag(newId(), d.name, d.day, namesFrom(d.who), d.deckIds, Date.now())
            saveBag(bag)
            setDraft(null)
            navigate(`/play/pack/${bag.id}`)
          }}
        />
      )}
    </>
  )
}

/** Name, day, who's coming and which decks: making a bag, or changing one. */
function BagDialog({ draft, decks, onDismiss, onSave, title = 'Pack for…' }: {
  draft: Draft; decks: Deck[]; onDismiss: () => void; onSave: (d: Draft) => void; title?: string
}) {
  const [d, setD] = useState(draft)
  const shown = decks.filter((x) => !x.archived && !x.sample)
  const flip = (id: string) => setD({ ...d, deckIds: d.deckIds.includes(id) ? d.deckIds.filter((x) => x !== id) : [...d.deckIds, id] })
  return (
    <Dialog
      title={title}
      onDismiss={onDismiss}
      actions={<>
        <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
        <button type="button" className="btn gold" onClick={() => onSave(d)}>Pack your bag</button>
      </>}
    >
      <div className="field-label">Name</div>
      <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Game night at Priya's" autoFocus />
      <div className="field-label" style={{ marginTop: 12 }}>Day</div>
      <input className="input" type="date" value={d.day} onChange={(e) => setD({ ...d, day: e.target.value })} />
      <div className="field-label" style={{ marginTop: 12 }}>Who's coming</div>
      <input className="input" value={d.who} onChange={(e) => setD({ ...d, who: e.target.value })} placeholder="Priya, Sam" />
      <div className="dim" style={{ marginTop: 6 }}>With commas between. Friends' wants and what you borrowed from them go in the bag.</div>
      <div className="field-label" style={{ marginTop: 12 }}>Decks</div>
      <div className="chips wrap">
        {shown.map((x) => <button key={x.id} type="button" className="chip" aria-pressed={d.deckIds.includes(x.id)} onClick={() => flip(x.id)}>{x.name}</button>)}
      </div>
    </Dialog>
  )
}

/** One bag's checklist (the EventBag mockup): Decks, Tokens and extras, For trades; Coming home; All packed. At /play/pack/:id. */
export function PackPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const back = useBack('/play/pack')
  const bags = useBags()
  const bag = bags.find((b) => b.id === id)
  const { collections, decks, account } = useSync()
  const { person } = useOverview()
  const available = more.useSocialMore()
  const [matches, setMatches] = useState<more.TradeMatch[]>([])
  const [borrowed, setBorrowed] = useState<BorrowedFrom[]>([])
  const [editing, setEditing] = useState(false)
  const chosen = useMemo(() => (bag?.deckIds ?? []).map((x) => decks.find((d) => d.id === x)).filter((d): d is Deck => !!d), [bag, decks])
  const ids = useMemo(() => chosen.flatMap((d) => [d.commander, d.partnerCommander, ...d.cards].filter((c) => !!c).map((c) => c!.scryfallId)), [chosen])
  const cards = useCardData(ids)

  useEffect(() => {
    if (!available) return
    let cancelled = false
    more.tradeMatches().then((m) => { if (!cancelled) setMatches(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [available])
  useEffect(() => {
    if (!account) return
    let cancelled = false
    myBorrowedLoans().then((loans) => {
      if (cancelled) return
      const byName = new Map<string, number>()
      for (const l of loans) {
        const name = l.lender?.display_name
        if (name) byName.set(name, (byName.get(name) ?? 0) + l.cards.reduce((n, c) => n + c.qty, 0))
      }
      setBorrowed([...byName.entries()].map(([from, n]) => ({ from, cards: n })))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [account])

  const lines = useMemo(() => {
    if (!bag) return []
    const tokens: Record<string, TokenToBring[]> = {}
    const counters: Record<string, string[]> = {}
    for (const d of chosen) { tokens[d.id] = tokensToBring(d, cards); counters[d.id] = countersNeeded(d, cards) }
    const placed = placesOf(collections).flatMap((p) => cardsIn(collections, p.id))
    const wants: WantedBy[] = friendsWantHere(matches, placed, () => null)
      .map((w) => ({ friend: person(w.friend)?.display_name ?? '', cards: w.cards.map((c) => c.card) }))
      .filter((w) => w.friend)
    return bagLines({ decks: chosen, collections, gear: gearOf(collections), tokens, counters, wants, borrowed, attendees: bag.attendees })
  }, [bag, chosen, cards, collections, matches, person, borrowed])

  if (!bag) {
    return (
      <>
        <PageHeader title="Pack your bag" onBack={back} />
        <div className="content-scroll pull-page"><p className="muted">This bag isn't on this device any more.</p></div>
      </>
    )
  }
  const shown = shownLines(bag, lines)
  const done = allTicked(bag, lines)
  const sections = (['DECKS', 'EXTRAS', 'TRADES'] as BagSection[]).filter((s) => shown.some((l) => l.section === s))

  return (
    <>
      <PageHeader
        title={bag.comingHome ? 'Coming home' : 'Pack your bag'}
        eyebrow={bagHeading(bag, dayOf(Date.now()))}
        onBack={back}
        actions={<button type="button" className="btn line sm" onClick={() => setEditing(true)}>Change</button>}
      />
      <div className="content-scroll pull-page bag-page">
        {bag.comingHome && <p className="bag-home">{homeSummary(bag, lines)}</p>}
        {chosen.length === 0 && !bag.comingHome && <p className="muted">No decks chosen yet — Change to pick the decks you're bringing.</p>}
        <div className="storage-list">
          {sections.map((s) => (
            <section key={s} className="storage-card bag-section">
              <h2>{BAG_SECTION_LABELS[s]}</h2>
              {shown.filter((l) => l.section === s).map((l) => (
                <label key={l.key} className="bag-line">
                  <input type="checkbox" checked={isTicked(bag, l.key)} onChange={() => saveBag(toggleTick(bag, l.key))} />
                  <span className="bag-title">{l.title}</span>
                  {l.detail && <span className={l.warn ? 'bag-detail warn' : 'bag-detail'}>{l.detail}</span>}
                </label>
              ))}
            </section>
          ))}
          {bag.comingHome && shown.length === 0 && <p className="muted">Nothing was ticked as packed, so there's nothing to check off.</p>}
          <button type="button" className="link" onClick={() => { deleteBag(bag.id); navigate('/play/pack') }}>Delete this bag</button>
        </div>
      </div>
      <div className="bag-bar">
        <button type="button" className="btn soft" onClick={() => saveBag(setComingHome(bag, !bag.comingHome))}>{bag.comingHome ? 'Packing' : 'Coming home'}</button>
        <button type="button" className="btn gold bag-all" disabled={done} onClick={() => saveBag(tickAll(bag, lines))}>
          {bag.comingHome ? 'All home' : 'All packed'}
        </button>
      </div>
      {editing && (
        <BagDialog
          title="Change bag"
          draft={{ name: bag.name, day: bag.day, who: bag.attendees.join(', '), deckIds: bag.deckIds }}
          decks={decks}
          onDismiss={() => setEditing(false)}
          onSave={(d) => {
            saveBag({ ...bag, name: d.name.trim() || bag.name, day: d.day || bag.day, attendees: namesFrom(d.who), deckIds: d.deckIds })
            setEditing(false)
          }}
        />
      )}
    </>
  )
}
