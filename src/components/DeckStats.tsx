import { useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../api/scryfall'
import { displayManaCost, type ScryfallCard } from '../types/scryfall'
import type { Deck, DeckCardEntry } from '../types/models'
import { COMMANDER_TARGETS, ROLE_TAGS, tagLabel, tagsOf, useRoleTags } from '../tags/roleTags'
import { useSync } from '../sync/SyncContext'
import { OwnedForTagDialog } from '../collection/TagBinders'
import { ownedCards, ownedForTag, type OwnedCard } from '../collection/owned'
import { ManaSymbol } from './ManaSymbols'
import { Icon } from './Icon'
import { MANA, TYPE_GROUPS, TYPE_PLURALS, primaryTypeOf, rise } from './kit'
import { DeckCombosPanel } from './RelayPanels'
import { DeckLegality } from './DeckLegality'

/** Canonical mana-color order, with generic {C} last. Mirrors the Android app's pipTotals. */
const PIP_ORDER = ['W', 'U', 'B', 'R', 'G', 'Colorless'] as const

const PIP_SYMBOL_PATTERN = /\{([^}]+)\}/g

/**
 * How many colored mana symbols of each color appear across every card's cast cost, weighted by
 * copies. Generic numbers are excluded; hybrid and Phyrexian symbols count toward each color they
 * represent. This is the deck's color-mana demand. Mirrors DeckDetailViewModel's colorPipCounts.
 */
function colorPipCounts(entries: { scryfallId: string; quantity: number }[], cardsById: Map<string, ScryfallCard>): [string, number][] {
  const totals = new Map<string, number>(PIP_ORDER.map((k) => [k, 0]))
  for (const entry of entries) {
    const card = cardsById.get(entry.scryfallId)
    const cost = card ? displayManaCost(card) : null
    if (!cost) continue
    for (const match of cost.matchAll(PIP_SYMBOL_PATTERN)) {
      const symbol = match[1].toUpperCase()
      if (symbol === 'C') {
        totals.set('Colorless', totals.get('Colorless')! + entry.quantity)
      } else {
        for (const part of symbol.split('/')) {
          const current = totals.get(part)
          if (current !== undefined) totals.set(part, current + entry.quantity)
        }
      }
    }
  }
  return PIP_ORDER.map((key) => [key, totals.get(key)!] as [string, number]).filter(([, n]) => n > 0)
}

/** undefined = loading, null = couldn't load. */
export type DeckCardData = Map<string, ScryfallCard> | null | undefined

/**
 * The full Scryfall cards behind a deck's entries (entries only cache a field subset: no mana cost,
 * mana value or price), fetched once per card list. Shared by the Stats panel and the deck header.
 */
export function useDeckCardData(deck: Deck | undefined): DeckCardData {
  const [cardsById, setCardsById] = useState<DeckCardData>(undefined)
  const ids = deck ? [...new Set([deck.commander, deck.partnerCommander, ...deck.cards].filter((e) => e !== null).map((e) => e.scryfallId))] : []
  const idKey = ids.join(',')

  useEffect(() => {
    if (ids.length === 0) {
      setCardsById(new Map())
      return
    }
    let cancelled = false
    getCardsByIds(ids)
      .then((cards) => { if (!cancelled) setCardsById(new Map(cards.map((c) => [c.id, c]))) })
      .catch(() => { if (!cancelled) setCardsById(null) })
    return () => { cancelled = true }
    // idKey, not `ids`: a fresh array every render would restart the fetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey])

  return cardsById
}

/** Deck value (USD, non-foil) and average mana value of its non-land cards; null until cards load. */
export function deckFigures(deck: Deck, cardsById: DeckCardData): { value: number; avgMv: number } | null {
  if (!cardsById) return null
  let value = 0
  let spells = 0
  let mv = 0
  const seen = new Set<string>()
  for (const e of [deck.commander, deck.partnerCommander, ...deck.cards]) {
    if (!e || seen.has(e.scryfallId)) continue
    seen.add(e.scryfallId)
    const card = cardsById.get(e.scryfallId)
    if (!card) continue
    value += Number(card.prices?.usd ?? 0) * e.quantity
    if (primaryTypeOf(card.type_line ?? e.typeLine) !== 'Land') {
      spells += e.quantity
      mv += Math.floor(card.cmc ?? 0) * e.quantity
    }
  }
  return { value, avgMv: spells > 0 ? mv / spells : 0 }
}

/** The deck's stats: mana curve, card types and mana symbols. Pass [cardsById] from useDeckCardData. */
export function DeckStats({ deck, cardsById, roleTags, tagging = false, onTag }: {
  deck: Deck
  cardsById: DeckCardData
  /** Card name → tag ids (useRoleTags), for the "What the cards do" panel. */
  roleTags?: Map<string, string[]>
  tagging?: boolean
  /** Tapping a tag's row: show those cards. */
  onTag?: (label: string) => void
}) {
  const allEntries = [deck.commander, deck.partnerCommander, ...deck.cards].filter((e) => e !== null)
  // Commanders are also in deck.cards; count each card once.
  const entries = [...new Map(allEntries.map((e) => [e.scryfallId, e])).values()]

  if (entries.length === 0) return <div className="empty-state"><Icon name="bar_chart" />Add some cards to see this deck's stats.</div>
  if (cardsById === undefined) return <div className="empty-state">Loading card data…</div>
  if (cardsById === null) return <div className="empty-state">Couldn't load card data. Check your connection and try again.</div>

  // Mana curve: non-land spells by mana value, 7+ grouped.
  const curve = Array.from({ length: 8 }, () => 0)
  let spellCount = 0
  let mvTotal = 0
  for (const e of entries) {
    const card = cardsById.get(e.scryfallId)
    if (!card || primaryTypeOf(card.type_line ?? e.typeLine) === 'Land') continue
    const mv = Math.floor(card.cmc ?? 0)
    curve[Math.min(7, mv)] += e.quantity
    spellCount += e.quantity
    mvTotal += mv * e.quantity
  }
  const curveMax = Math.max(1, ...curve)

  const typeCounts = TYPE_GROUPS.map((t) => [t, entries.filter((e) => primaryTypeOf(e.typeLine) === t).reduce((s, e) => s + e.quantity, 0)] as [string, number])
    .filter(([, n]) => n > 0)
  const totalCards = typeCounts.reduce((s, [, n]) => s + n, 0)

  const pips = colorPipCounts(entries, cardsById)
  const totalPips = pips.reduce((sum, [, n]) => sum + n, 0)

  return (
    <div className="detail-grid">
      <div className="panel rise" style={rise(0)}>
        <div className="p-h">
          <h3>Mana curve</h3>
          {spellCount > 0 && <span className="p-sub">Average<b>{(mvTotal / spellCount).toFixed(2)}</b></span>}
        </div>
        <div className="curve">
          {curve.map((n, i) => (
            <div className="bcol" key={i}>
              <span className="bnum">{n}</span>
              <div className="btrack"><div className="bar" style={{ ['--h' as string]: `${(n / curveMax) * 100}%`, ['--i' as string]: i }} /></div>
              <span className="blbl">{i === 7 ? '7+' : i}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel rise" style={rise(1)}>
        <div className="p-h"><h3>Card types</h3><span className="p-sub">Total<b>{totalCards}</b></span></div>
        {typeCounts.map(([type, n], i) => (
          <div className="meter" key={type}>
            <div className="m-top">
              <span className="grow">{TYPE_PLURALS[type]}</span>
              <span className="m-n"><b>{n}</b>{Math.round((n * 100) / totalCards)}%</span>
            </div>
            <div className="m-track"><div className="m-fill" style={{ ['--w' as string]: `${(n / totalCards) * 100}%`, ['--i' as string]: i }} /></div>
          </div>
        ))}
      </div>

      <div className="panel rise" style={rise(2)}>
        <div className="p-h"><h3>Mana symbols</h3>{totalPips > 0 && <span className="p-sub">Total<b>{totalPips}</b></span>}</div>
        {totalPips === 0 ? (
          <div className="dim">No colored mana symbols — this deck's cards all cost generic mana.</div>
        ) : (
          <>
            {pips.map(([color, count], i) => (
              <div className="meter" key={color}>
                <div className="m-top">
                  <ManaSymbol code={color} size={18} />
                  <span className="grow">{color === 'Colorless' ? 'Colorless' : ({ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' } as Record<string, string>)[color]}</span>
                  <span className="m-n"><b>{count}</b>{Math.floor((count * 100) / totalPips)}%</span>
                </div>
                <div className="m-track">
                  <div className="m-fill" style={{ ['--w' as string]: `${(count / totalPips) * 100}%`, ['--i' as string]: i, ['--c' as string]: MANA[color === 'Colorless' ? 'C' : color] }} />
                </div>
              </div>
            ))}
            <div className="dim" style={{ marginTop: 10 }}>
              Coloured symbols across every card's cost — how much of each colour the deck actually asks for.
            </div>
          </>
        )}
      </div>

      {roleTags && <TagCounts deck={deck} entries={entries} roleTags={roleTags} tagging={tagging} onTag={onTag} />}

      <DeckLegality deck={deck} cardsById={cardsById} index={3} />

      <DeckCombosPanel deck={deck} index={4} />
    </div>
  )
}

/**
 * How many cards do each job (mana ramp, card draw…), most first. In Commander, the core jobs are
 * held against the usual targets for a 100-card deck.
 */
function TagCounts({ deck, entries, roleTags, tagging, onTag }: {
  deck: Deck
  entries: DeckCardEntry[]
  roleTags: Map<string, string[]>
  tagging: boolean
  onTag?: (label: string) => void
}) {
  const counts = new Map<string, number>()
  for (const e of entries) {
    for (const id of tagsOf(roleTags, e.name)) counts.set(id, (counts.get(id) ?? 0) + e.quantity)
  }
  const commander = deck.gameMode === 'COMMANDER'
  // The core jobs always show in Commander (a 0 there is worth knowing); the rest when present.
  const ids = ROLE_TAGS.map((t) => t.id).filter((id) => counts.has(id) || (commander && COMMANDER_TARGETS[id]))
  ids.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  const most = Math.max(1, ...ids.map((id) => counts.get(id) ?? 0))

  // For the core jobs: the cards already in the user's binders that would fill the gap.
  const { collections } = useSync()
  const owned = useMemo(() => ownedCards(collections), [collections])
  const commanders = [deck.commander, deck.partnerCommander].flatMap((c) => (c ? [c.name] : []))
  const { tags: ownedTags } = useRoleTags([...owned.map((c) => c.name), ...commanders])
  const gaps = useMemo(() => {
    const m = new Map<string, OwnedCard[]>()
    for (const id of Object.keys(COMMANDER_TARGETS)) {
      const found = ownedForTag(owned, deck, id)
      if (found.length) m.set(id, found)
    }
    return m
    // ownedTags: the tag cache filled in underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned, deck, ownedTags])
  const [ownedFor, setOwnedFor] = useState<string | null>(null)

  return (
    <div className="panel rise" style={rise(3)}>
      <div className="p-h"><h3>What the cards do</h3>{tagging && <span className="p-sub">Finding tags…</span>}</div>
      {ids.length === 0 ? (
        <div className="dim">{tagging ? 'Looking up what each card does…' : 'No tags for these cards yet.'}</div>
      ) : ids.map((id, i) => {
        const n = counts.get(id) ?? 0
        const target = commander ? COMMANDER_TARGETS[id] : undefined
        const status = !target ? '' : n < target[0] ? ' short' : n > target[1] ? ' over' : ' ok'
        const row = (
          <>
            <div className="m-top">
              <span className="grow">{tagLabel(id)}</span>
              {target && <span className={`tag-target${status}`}>{target[0]}–{target[1]}</span>}
              <span className="m-n"><b>{n}</b></span>
            </div>
            <div className="m-track"><div className="m-fill" style={{ ['--w' as string]: `${(n / most) * 100}%`, ['--i' as string]: i }} /></div>
          </>
        )
        const have = gaps.get(id) ?? []
        return (
          <div key={id} className="tag-row">
            {onTag ? (
              <button type="button" className="meter meter-button" onClick={() => onTag(tagLabel(id))}>{row}</button>
            ) : (
              <div className="meter">{row}</div>
            )}
            {have.length > 0 && status !== ' over' && (
              <button type="button" className={`owned-gap${status === ' short' ? ' short' : ''}`} onClick={() => setOwnedFor(id)}>
                <Icon name="add_circle" aria-hidden />You own {have.length} more · add from your binders
              </button>
            )}
          </div>
        )
      })}
      {ownedFor && (
        <OwnedForTagDialog label={tagLabel(ownedFor)} deck={deck} cards={gaps.get(ownedFor) ?? []} onDismiss={() => setOwnedFor(null)} />
      )}
      <div className="dim" style={{ marginTop: 10 }}>
        From Scryfall Tagger{commander ? '; the ranges are the usual amounts for a Commander deck' : ''}. Tap a tag to see its cards.
      </div>
    </div>
  )
}
