import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { PageHeader, SegmentedTabs, useBack } from '../components/kit'
import { getCollection } from '../api/scryfall'
import { knownCards } from '../collection/cardData'
import { entryFromCard } from '../decks/newDeck'
import {
  cardCount, dayText, entryTitle, historyItems, historyOf, linesText, listStateOf, recordLine, restoreList, sourceText, stateAt,
  versionDiff, wholeList, withNamedVersion, withRestore, type HistoryItem, type HistoryLine,
} from '../decks/deckHistory'
import { historyContext, historyHere } from '../decks/historyDevice'
import { intoPile, pileEntryOf, realCopiesLeaving, withUnsortedPile } from '../collection/unsorted'
import { UNSORTED_COLLECTION_ID, type Collection, type Deck, type DeckCardEntry, type GameMode } from '../types/models'
import type { ScryfallCard } from '../types/scryfall'
import '../collection/storage.css'

/**
 * A deck's history, the Android app's DeckHistoryScreen: each change to its list, newest first —
 * when, on which device, the cards in and out, the value before and after — with the versions saved
 * by name and the games played on each, and "Save this version…". At /decks/:id/history.
 */
export function DeckHistoryPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { decks, changeDecksAndStorage } = useSync()
  const navigate = useNavigate()
  const back = useBack(`/decks/${id}`)
  const money = useMoney()
  const deck = decks.find((d) => d.id === id)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const items = useMemo(() => (deck ? historyItems(deck) : []), [deck])
  const now = Date.now()

  if (!deck) {
    return (
      <>
        <PageHeader title="History" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="history" /><div>This deck isn't here any more.</div></div></div>
      </>
    )
  }
  const total = cardCount(listStateOf(deck))
  const save = () => {
    if (!name.trim()) return
    changeDecksAndStorage((cols, ds) => ({ collections: cols, decks: ds.map((d) => (d.id === deck.id ? withNamedVersion(d, name, note, historyContext()) : d)) }))
    setNaming(false)
    setName('')
    setNote('')
  }

  return (
    <>
      <PageHeader title="History" eyebrow={`${deck.name} · ${total} ${total === 1 ? 'card' : 'cards'}`} onBack={back} />
      <div className="content-scroll pull-page">
        {items.length === 0 ? (
          <div className="empty-state"><Icon name="history" /><div>No changes yet. Each change to the list shows here, and you can save a version by name.</div></div>
        ) : (
          <div className="pull-groups">
            {items.map((item) => (
              <HistoryCard
                key={item.entry.id}
                item={item}
                now={now}
                usesCommander={!!deck.commander}
                format={(usd) => money.format(usd, true)}
                onOpen={() => navigate(`/decks/${deck.id}/history/${encodeURIComponent(item.entry.id)}`)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="pull-bar">
        <button type="button" className="btn gold" onClick={() => setNaming(true)}>Save this version…</button>
      </div>
      {naming && (
        <Dialog
          title="Save this version"
          onDismiss={() => setNaming(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setNaming(false)}>Cancel</button>
              <button type="button" className="btn gold" disabled={!name.trim()} onClick={save}>Save</button>
            </>
          }
        >
          <div className="field-label">Name</div>
          <input className="input" value={name} autoFocus maxLength={60} placeholder="Before game night" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
          <div className="field-label" style={{ marginTop: 12 }}>Note (optional)</div>
          <textarea className="input" value={note} maxLength={500} rows={3} placeholder="What you changed and why" onChange={(e) => setNote(e.target.value)} />
          <p className="muted" style={{ margin: '10px 0 0' }}>The list as it is now, kept for good. The games you play with it count for it.</p>
        </Dialog>
      )}
    </>
  )
}

function HistoryCard({ item, now, usesCommander, format, onOpen }: {
  item: HistoryItem; now: number; usesCommander: boolean; format: (usd: number) => string; onOpen: () => void
}) {
  const e = item.entry
  const source = sourceText(e, historyHere())
  const record = recordLine(item)
  const lines = (sign: '+' | '−', list: HistoryLine[]) => {
    if (list.length === 0) return null
    const { lead, rest } = linesText(sign, list)
    return <span><b className={sign === '+' ? 'hist-in' : 'hist-out'}>{lead}</b>{rest ? ` ${rest}` : ''}</span>
  }
  let body
  if (e.kind === 'named') {
    body = (
      <>
        {e.note && <div className="hist-note">{e.note}</div>}
        <div className="dim">Saved by you.{record ? ` ${record}` : ''}</div>
      </>
    )
  } else if (e.kind === 'import' || e.kind === 'start') {
    body = <div className="dim">{e.kind === 'import' ? 'Imported' : 'Starting list'} · {item.cards} {item.cards === 1 ? 'card' : 'cards'}{record ? `. ${record}` : ''}</div>
  } else {
    body = (
      <>
        <div className="hist-lines">
          {e.kind === 'restore' && e.to != null && <span className="dim">Went back to the list from {dayText(e.to, now)}</span>}
          {lines('+', item.added)}
          {lines('−', item.removed)}
          {item.commanders ? <span className="dim">Commander: {item.commanders.join(' & ') || 'none'}</span>
            : usesCommander && !item.latest ? <span className="dim">Commander unchanged</span> : null}
        </div>
        {e.v0 != null && e.v1 != null && Math.round(e.v0) !== Math.round(e.v1) && <span className="dim">Value {format(e.v0)} → {format(e.v1)}</span>}
        {record && <span className="dim">{record}</span>}
      </>
    )
  }
  return (
    <article className="pull-group hist-card">
      <div className="pull-group-h">
        <h2>{entryTitle(e, now)}</h2>
        {source && <span>{source}</span>}
      </div>
      {body}
      {!item.latest && <button type="button" className="link hist-open" onClick={onOpen}>See the deck as it was</button>}
    </article>
  )
}

/** Cards by name, for the cards a deck had then and hasn't now: prices to show, printings to put back. */
function useCardsByName(names: string[]): Map<string, ScryfallCard> {
  const key = [...names].sort().join('\n')
  const [found, setFound] = useState<Map<string, ScryfallCard>>(new Map())
  useEffect(() => {
    let cancelled = false
    const byName = new Map<string, ScryfallCard>()
    for (const c of knownCards.values()) if (names.includes(c.name) && !byName.has(c.name)) byName.set(c.name, c)
    const missing = names.filter((n) => !byName.has(n))
    setFound(new Map(byName))
    if (missing.length === 0) return
    void (async () => {
      for (let i = 0; i < missing.length; i += 75) {
        try {
          const { data } = await getCollection(missing.slice(i, i + 75).map((name) => ({ name })))
          for (const c of data) {
            knownCards.set(c.id, c)
            const asked = missing.find((n) => n === c.name || c.name.startsWith(`${n} // `)) ?? c.name
            byName.set(asked, c)
          }
        } catch {
          // Offline: no prices, and the cards come back by the printings the deck or binders know.
        }
      }
      if (!cancelled) setFound(new Map(byName))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return found
}

/** A card to put back in the deck, by name: its sideboard's or Considering's, a fetched one, a binder's. */
function knownEntry(deck: Deck, collections: Collection[], fetched: Map<string, ScryfallCard>, name: string): DeckCardEntry | undefined {
  const side = [...(deck.sideboard ?? []), ...(deck.considering ?? [])].find((e) => e.name === name)
  if (side) return side
  const card = fetched.get(name)
  if (card) return entryFromCard(card, 1)
  for (const c of collections) {
    const e = c.entries.find((x) => x.name === name)
    if (e) return { scryfallId: e.scryfallId, name: e.name, imageUrl: e.imageUrl, quantity: 1, canBeCommander: false, typeLine: null, partnerAbility: null, backImageUrl: e.backImageUrl ?? null, tags: e.tags ?? [] }
  }
  return undefined
}

/**
 * One earlier list, read only — the Android app's DeckVersionScreen: what was in it then and isn't
 * now, and what's been added since (or the whole list), with "Copy as new deck" and "Go back to this".
 * Going back keeps today's list in the history; a physical deck gets its pull list for the cards
 * coming back, and the ones going out land on the Unsorted pile. At /decks/:id/history/:entry.
 */
export function DeckVersionPage() {
  const { id = '', entry: entryId = '' } = useParams<{ id: string; entry: string }>()
  const { decks, collections, changeDecksAndStorage, createDeckWithCards } = useSync()
  const navigate = useNavigate()
  const back = useBack(`/decks/${id}/history`)
  const money = useMoney()
  const deck = decks.find((d) => d.id === id)
  const [whole, setWhole] = useState(false)
  const [done, setDone] = useState<{ title: string; text: string; pull: boolean } | null>(null)
  const history = useMemo(() => (deck ? historyOf(deck) : []), [deck])
  const entry = history.find((e) => e.id === entryId)
  const then = useMemo(() => (entry ? stateAt(history, entry.id) : null), [history, entry])
  const nowState = useMemo(() => (deck ? listStateOf(deck) : null), [deck])
  const diff = then && nowState ? versionDiff(then, nowState) : { gone: [], added: [] }
  const fetched = useCardsByName(then ? Object.keys(then.cards).filter((n) => !nowState?.cards[n]) : [])

  if (!deck || !entry || !then || !nowState) {
    return (
      <>
        <PageHeader title="An earlier version" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="history" /><div>This version isn't in the deck's history any more.</div></div></div>
      </>
    )
  }
  const now = Date.now()
  const day = dayText(entry.at, now)
  const priceOf = (name: string): string | null => {
    const inDeck = deck.cards.find((e) => e.name === name)
    const card = (inDeck && knownCards.get(inDeck.scryfallId)) || fetched.get(name)
    return card?.prices?.usd ? money.format(Number(card.prices.usd)) : null
  }
  const known = (name: string) => knownEntry(deck, collections, fetched, name)

  const copyAsNew = () => {
    const plan = restoreList({ ...deck, cards: [], commander: null, partnerCommander: null, ownership: 'VIRTUAL' }, then, (name) => deck.cards.find((e) => e.name === name) ?? known(name))
    const fresh = plan.deck.cards.map((e) => ({ ...e, proxyQuantity: undefined, replaceable: false }))
    const commander = plan.deck.commander ? fresh.find((e) => e.scryfallId === plan.deck.commander!.scryfallId) ?? null : null
    const partner = plan.deck.partnerCommander ? fresh.find((e) => e.scryfallId === plan.deck.partnerCommander!.scryfallId) ?? null : null
    const made = createDeckWithCards(`${deck.name} (${day})`, fresh, commander, partner, deck.gameMode as GameMode)
    navigate(`/decks/${made.id}`)
  }

  const goBack = () => {
    let result: { incoming: number; out: number; missing: number } | null = null
    changeDecksAndStorage((cols, ds) => {
      const current = ds.find((d) => d.id === deck.id)
      if (!current) return { collections: cols, decks: ds }
      const plan = restoreList(current, then, known)
      // Real copies going out land on the Unsorted pile, as when they're taken out by hand.
      const leaving = plan.cuts.map((c) => pileEntryOf(c.entry, realCopiesLeaving(current, c.entry, c.newQuantity))).filter((e) => e.quantity > 0)
      const restored = withRestore(current, plan.deck, entry.at, historyContext())
      const collections = leaving.length === 0 ? cols
        : withUnsortedPile(cols).map((c) => (c.id === UNSORTED_COLLECTION_ID ? { ...c, entries: intoPile(c.entries, leaving) } : c))
      result = { incoming: plan.incoming, out: leaving.reduce((n, e) => n + e.quantity, 0), missing: plan.missing.reduce((n, l) => n + l.q, 0) }
      return { collections, decks: ds.map((d) => (d.id === deck.id ? restored : d)) }
    })
    const r = result as { incoming: number; out: number; missing: number } | null
    if (!r) return
    const pull = deck.ownership === 'PHYSICAL' && r.incoming > 0
    const parts = [
      pull ? `Its pull list has the ${r.incoming} ${r.incoming === 1 ? 'card' : 'cards'} coming back.` : '',
      r.out > 0 ? `The ${r.out} ${r.out === 1 ? 'card' : 'cards'} taken out ${r.out === 1 ? 'is' : 'are'} on the Unsorted pile.` : '',
      r.missing > 0 ? `${r.missing} ${r.missing === 1 ? 'card' : 'cards'} couldn't be found, so ${r.missing === 1 ? "it's" : "they're"} left out.` : '',
      "Today's list is in the history, so you can go back to it.",
    ].filter(Boolean)
    setDone({ title: `Back to the list from ${day}`, text: parts.join(' '), pull })
  }

  const row = (sign: '+' | '−', l: HistoryLine) => (
    <div key={`${sign}${l.n}`} className="hist-row">
      <b className={sign === '+' ? 'hist-in' : 'hist-out'}>{sign}</b>
      <span className="nm">{l.q > 1 ? `${l.q} ${l.n}` : l.n}</span>
      <span className="dim">{priceOf(l.n) ?? ''}</span>
    </div>
  )
  const same = diff.gone.length === 0 && diff.added.length === 0

  return (
    <>
      <PageHeader title={`As it was on ${day}`} eyebrow={`${deck.name} · read only`} onBack={back} />
      <div className="content-scroll pull-page">
        <div className="hist-version">
          <SegmentedTabs labels={['Differences', 'Whole list']} selected={whole ? 1 : 0} onSelect={(i) => setWhole(i === 1)} />
          {whole ? (
            <>
              <div className="hist-section">WHOLE LIST · {cardCount(then)}</div>
              <div className="pull-group">
                {wholeList(then).map((l) => (
                  <div key={l.n} className="hist-row"><span className="nm">{l.q > 1 ? `${l.q} ${l.n}` : l.n}</span>{then.commanders.includes(l.n) && <span className="dim">Commander</span>}</div>
                ))}
              </div>
            </>
          ) : same ? (
            <p className="muted">The same list as now.</p>
          ) : (
            <>
              {diff.gone.length > 0 && (
                <>
                  <div className="hist-section">IN IT THEN, NOT NOW · {diff.gone.reduce((n, l) => n + l.q, 0)}</div>
                  <div className="pull-group">{diff.gone.map((l) => row('−', l))}</div>
                </>
              )}
              {diff.added.length > 0 && (
                <>
                  <div className="hist-section">ADDED SINCE · {diff.added.reduce((n, l) => n + l.q, 0)}</div>
                  <div className="pull-group">{diff.added.map((l) => row('+', l))}</div>
                </>
              )}
            </>
          )}
          <p className="muted hist-foot">Going back keeps today's list in the history too, so you can always return to it. Physical decks get a pull list for the cards that change.</p>
        </div>
      </div>
      <div className="pull-bar">
        <button type="button" className="btn line" onClick={copyAsNew}>Copy as new deck</button>
        <button type="button" className="btn gold" disabled={same} onClick={goBack}>Go back to this</button>
      </div>
      {done && (
        <Dialog
          title={done.title}
          onDismiss={() => navigate(`/decks/${deck.id}`)}
          actions={done.pull
            ? <>
                <button type="button" className="btn line" onClick={() => navigate(`/decks/${deck.id}`)}>Later</button>
                <button type="button" className="btn gold" onClick={() => navigate(`/decks/${deck.id}/pull`)}>Pull list</button>
              </>
            : <button type="button" className="btn gold" onClick={() => navigate(`/decks/${deck.id}`)}>Done</button>}
        >
          <p className="muted" style={{ margin: 0 }}>{done.text}</p>
        </Dialog>
      )}
    </>
  )
}
