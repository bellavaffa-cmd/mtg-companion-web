// A deck's history: what changed in its list, when and on which device, with saved named versions
// and the games played on each. The Android app's data/DeckHistory.kt, rule for rule, with the same
// tests (DeckHistoryTest.kt ↔ tests/decks/deckHistory.test.ts).
//
// It rides in the deck's JSON as "history" (oldest first), so the phone and manabind.com show the
// same one. Entries are small: what was added and cut, by name; the commanders when they changed; the
// deck's value before and after when its prices were known. A burst of edits on one device within
// ten minutes is one entry. To rebuild the list at any point, some entries also carry the whole list
// ("list", name -> copies): the first one, every named version, imports and going back, and one
// every SNAPSHOT_EVERY entries — the rest are replayed from the nearest one before.
//
// Two devices' histories merge entry by entry, by id (never doubled), and the newer copy of an entry
// wins (only the device that made an entry folds more edits into it). The history is capped — the
// last MAX_ENTRIES entries within a year of the newest; named versions are never dropped — and an
// entry left without its whole list by the cap gets it, so every point can still be rebuilt. The cap
// counts from the newest entry, not the clock, so both devices cap a merge the same way.
//
// An app from before the history drops it when it saves the deck: a deck saved without the key gets
// this device's back (keepHistoryFromOlderApp), and its list changes, which no entry recorded, become
// one "synced" entry the next time the list is changed here — so the replay never drifts.
//
// JSON, key for key the same in both apps (keys left out when empty):
//   "history": [{ "id": "k3x9…", "at": 1760000000000, "from": "web", "dev": "a1b2c3d4",
//                 "add": [{ "n": "Skullclamp", "q": 1 }], "cut": [{ "n": "Wood Elves", "q": 1 }],
//                 "cmd": ["Meren of Clan Nel Toth"], "v0": 412.3, "v1": 476.1,
//                 "list": { "Skullclamp": 1, … }, "kind": "named", "name": "Before game night",
//                 "note": "…", "to": 1759000000000 }]

import type { Deck, DeckCardEntry, DeckVersion } from '../types/models'

/** Edits on one device closer together than this are one entry. */
export const COALESCE_MS = 10 * 60 * 1000
/** Entries kept besides the named versions, newest first. */
export const MAX_ENTRIES = 100
/** Entries older than this (from the newest) go, named versions aside. */
export const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000
/** An entry carries the whole list once this many entries have gone by without one. */
export const SNAPSHOT_EVERY = 20

/** Copies of one card, by name. */
export interface HistoryLine {
  n: string
  q: number
}

/**
 * What an entry is: left out for an edit; "start" — the list from before the history was kept;
 * "import" — a whole list arriving into an empty deck; "named" — a version the user saved by name;
 * "restore" — going back to an earlier list; "synced" — changes made where no entry was recorded.
 */
export type HistoryKind = 'start' | 'import' | 'named' | 'restore' | 'synced'

export interface DeckHistoryEntry {
  id: string
  /** When: the latest change folded into it. */
  at: number
  kind?: HistoryKind
  /** The app that made it: "android" or "web". */
  from?: string
  /** That app's install. */
  dev?: string
  add?: HistoryLine[]
  cut?: HistoryLine[]
  /** The commanders after it, when they changed — and on every entry that has the whole list. */
  cmd?: string[]
  /** The deck's value before and after, in US dollars, when its prices were known. */
  v0?: number
  v1?: number
  /** The whole list after it: name -> copies. */
  list?: Record<string, number>
  /** A named version's name and note. */
  name?: string
  note?: string
  /** Going back: when the list gone back to was. */
  to?: number
}

/** A list as it stood: name -> copies (commanders included), and the commanders. */
export interface ListState {
  cards: Record<string, number>
  commanders: string[]
}

export const EMPTY_LIST: ListState = { cards: {}, commanders: [] }

/** Who is recording: the app, its install, the time, new ids and the deck's value when known. */
export interface HistoryContext {
  now: number
  from: 'web' | 'android'
  dev: string
  newId: () => string
  valueOf?: (deck: Deck) => number | null
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byTime = (a: DeckHistoryEntry, b: DeckHistoryEntry) => a.at - b.at || cmp(a.id, b.id)

/** Oldest first; the same time, by id. */
export const sortedHistory = (history: DeckHistoryEntry[]) => [...history].sort(byTime)

/** The deck's list: card name -> copies (commanders included), and its commanders. */
export function listStateOf(deck: Deck): ListState {
  const cards: Record<string, number> = {}
  for (const c of deck.cards) cards[c.name] = (cards[c.name] ?? 0) + c.quantity
  return { cards, commanders: [deck.commander?.name, deck.partnerCommander?.name].filter((n): n is string => !!n) }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function sameCards(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a).filter((k) => a[k] > 0)
  const bk = Object.keys(b).filter((k) => b[k] > 0)
  return ak.length === bk.length && ak.every((k) => a[k] === b[k])
}

export const sameState = (a: ListState, b: ListState) => sameCards(a.cards, b.cards) && sameList(a.commanders, b.commanders)

export const cardCount = (s: ListState) => Object.values(s.cards).reduce((n, q) => n + q, 0)

/** What changed from [from] to [to]: the cards added and cut, A–Z. */
export function diffStates(from: ListState, to: ListState): { add: HistoryLine[]; cut: HistoryLine[] } {
  const add: HistoryLine[] = []
  const cut: HistoryLine[] = []
  const names = [...new Set([...Object.keys(from.cards), ...Object.keys(to.cards)])].sort(cmp)
  for (const n of names) {
    const delta = (to.cards[n] ?? 0) - (from.cards[n] ?? 0)
    if (delta > 0) add.push({ n, q: delta })
    if (delta < 0) cut.push({ n, q: -delta })
  }
  return { add, cut }
}

/** [state] after [entry]. */
export function applyEntry(state: ListState, entry: DeckHistoryEntry): ListState {
  if (entry.list) return { cards: { ...entry.list }, commanders: entry.cmd ?? state.commanders }
  const cards = { ...state.cards }
  for (const l of entry.add ?? []) cards[l.n] = (cards[l.n] ?? 0) + l.q
  for (const l of entry.cut ?? []) {
    const left = (cards[l.n] ?? 0) - l.q
    if (left > 0) cards[l.n] = left
    else delete cards[l.n]
  }
  return { cards, commanders: entry.cmd ?? state.commanders }
}

/** The list after each of [sorted]'s entries, in the same order. */
export function statesThrough(sorted: DeckHistoryEntry[]): ListState[] {
  const out: ListState[] = []
  let state = EMPTY_LIST
  for (const e of sorted) {
    state = applyEntry(state, e)
    out.push(state)
  }
  return out
}

/** The list as it was right after the entry [id]; null when there's no such entry. */
export function stateAt(history: DeckHistoryEntry[], id: string): ListState | null {
  const sorted = sortedHistory(history)
  const i = sorted.findIndex((e) => e.id === id)
  return i === -1 ? null : statesThrough(sorted.slice(0, i + 1))[i]
}

/** The entry with only the keys it uses: empty lists and unknown values left out. */
function compact(e: DeckHistoryEntry): DeckHistoryEntry {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0 && k !== 'cmd') continue
    out[k] = v
  }
  return out as unknown as DeckHistoryEntry
}

/**
 * The history capped: named versions always, then the last MAX_ENTRIES other entries within
 * MAX_AGE_MS of the newest. An entry kept right after one that went gets the whole list, so the list
 * at every point left can still be rebuilt. [sorted] oldest first.
 */
export function capHistory(sorted: DeckHistoryEntry[]): DeckHistoryEntry[] {
  if (sorted.length === 0) return sorted
  const newest = sorted[sorted.length - 1].at
  const plain = sorted.filter((e) => e.kind !== 'named')
  const keep = new Set(plain.filter((e) => newest - e.at <= MAX_AGE_MS).slice(-MAX_ENTRIES).map((e) => e.id))
  if (keep.size === plain.length) return sorted
  const states = statesThrough(sorted)
  const out: DeckHistoryEntry[] = []
  let dropped = false
  sorted.forEach((e, i) => {
    if (e.kind !== 'named' && !keep.has(e.id)) {
      dropped = true
      return
    }
    out.push(dropped && !e.list ? { ...e, list: states[i].cards, cmd: states[i].commanders } : e)
    dropped = false
  })
  return out
}

/** The history a deck from before it had: its saved versions, as entries. Empty when it had none. */
export function historyFromVersions(versions: DeckVersion[] | undefined): DeckHistoryEntry[] {
  const sorted = [...(versions ?? [])].sort((a, b) => a.savedAt - b.savedAt || cmp(a.id, b.id))
  let previous: ListState | null = null
  let sinceList = 0
  return sorted.map((v) => {
    const state = { cards: v.cards, commanders: v.commanders }
    const id = `v:${v.id}`
    let entry: DeckHistoryEntry
    if (!previous) {
      entry = { id, at: v.savedAt, kind: 'start', list: { ...v.cards }, cmd: v.commanders }
      sinceList = 0
    } else {
      sinceList++
      const { add, cut } = diffStates(previous, state)
      const withList = sinceList >= SNAPSHOT_EVERY
      if (withList) sinceList = 0
      entry = compact({
        id, at: v.savedAt, add, cut,
        cmd: withList || !sameList(previous.commanders, v.commanders) ? v.commanders : undefined,
        list: withList ? { ...v.cards } : undefined,
      })
    }
    previous = state
    return entry
  })
}

/** The deck's history: its own, or for a deck from before there was one, its saved versions. */
export const historyOf = (deck: Deck): DeckHistoryEntry[] =>
  sortedHistory(deck.history ?? historyFromVersions(deck.versions))

/** A "synced" entry for what changed between the history's last list and [actual], or null. */
function catchUp(states: ListState[], actual: ListState, at: number, ctx: HistoryContext): DeckHistoryEntry | null {
  const tip = states.length > 0 ? states[states.length - 1] : EMPTY_LIST
  if (sameState(tip, actual)) return null
  const { add, cut } = diffStates(tip, actual)
  return compact({
    id: ctx.newId(), at, kind: 'synced', add, cut,
    cmd: sameList(tip.commanders, actual.commanders) ? undefined : actual.commanders,
  })
}

/** Whether [after]'s history has an entry [before]'s didn't — the change was recorded already. */
function recordedAlready(before: Deck | undefined, after: Deck): boolean {
  if (!after.history || after.history === before?.history) return false
  const had = new Set((before?.history ?? []).map((e) => e.id))
  return after.history.some((e) => !had.has(e.id))
}

const valueOf = (ctx: HistoryContext, deck: Deck | undefined) => (deck && ctx.valueOf ? ctx.valueOf(deck) ?? undefined : undefined)

/**
 * [after] with its list change recorded in its history, when its list differs from [before]'s —
 * tags, flags, the sideboard or a card's printing don't count. Edits on this device within
 * COALESCE_MS of its last entry fold into it, unless a game was logged since (the game belongs to
 * the list it was played with). A whole list arriving into an empty deck is an import; a deck changed
 * for the first time since the history existed gets its list from before (or its saved versions)
 * first, so there's something to go back to.
 */
export function withHistory(before: Deck | undefined, after: Deck, ctx: HistoryContext): Deck {
  const afterState = listStateOf(after)
  const beforeState = before ? listStateOf(before) : EMPTY_LIST
  if (sameState(beforeState, afterState) || recordedAlready(before, after)) return after
  const now = ctx.now
  let hist = sortedHistory(after.history ?? historyFromVersions(before?.versions ?? after.versions))
  if (hist.length === 0) {
    if (cardCount(beforeState) === 0) {
      if (cardCount(afterState) > 1) {
        const entry = compact({ id: ctx.newId(), at: now, kind: 'import', from: ctx.from, dev: ctx.dev, list: afterState.cards, cmd: afterState.commanders, v1: valueOf(ctx, after) })
        return { ...after, history: [entry] }
      }
    } else {
      hist = [compact({ id: ctx.newId(), at: now - 1, kind: 'start', list: beforeState.cards, cmd: beforeState.commanders, v1: valueOf(ctx, before) })]
    }
  }
  const states = statesThrough(hist)
  const lastAt = hist.length > 0 ? hist[hist.length - 1].at : -Infinity
  const synced = hist.length > 0 ? catchUp(states, beforeState, Math.max(now - 1, lastAt + 1), ctx) : null
  if (synced) {
    hist = [...hist, synced]
    states.push(beforeState)
  }
  const last = hist.length > 0 ? hist[hist.length - 1] : undefined
  const fold = !!last && !synced && last.kind === undefined && last.dev === ctx.dev && last.from === ctx.from &&
    now - last.at < COALESCE_MS && !after.gameResults.some((g) => g.playedAt >= last.at)
  const v1 = valueOf(ctx, after)
  if (fold) {
    const prev = states.length > 1 ? states[states.length - 2] : EMPTY_LIST
    const { add, cut } = diffStates(prev, afterState)
    const entry = compact({
      ...last, at: Math.max(now, last.at), add, cut,
      cmd: last.list || !sameList(prev.commanders, afterState.commanders) ? afterState.commanders : undefined,
      list: last.list ? afterState.cards : undefined,
      v1: v1 ?? last.v1,
    })
    return { ...after, history: capHistory([...hist.slice(0, -1), entry]) }
  }
  let sinceList = 0
  for (let i = hist.length - 1; i >= 0 && !hist[i].list; i--) sinceList++
  const withList = hist.length === 0 || sinceList + 1 >= SNAPSHOT_EVERY
  const { add, cut } = diffStates(beforeState, afterState)
  const entry = compact({
    id: ctx.newId(), at: Math.max(now, (synced?.at ?? lastAt) + 1), from: ctx.from, dev: ctx.dev, add, cut,
    cmd: withList || !sameList(beforeState.commanders, afterState.commanders) ? afterState.commanders : undefined,
    list: withList ? afterState.cards : undefined,
    v0: valueOf(ctx, before), v1,
  })
  return { ...after, history: capHistory([...hist, entry]) }
}

/** [deck] with its list as it is now saved as a named version. */
export function withNamedVersion(deck: Deck, name: string, note: string, ctx: HistoryContext): Deck {
  let hist = historyOf(deck)
  const state = listStateOf(deck)
  const lastAt = hist.length > 0 ? hist[hist.length - 1].at : -Infinity
  const synced = hist.length > 0 ? catchUp(statesThrough(hist), state, Math.max(ctx.now - 1, lastAt + 1), ctx) : null
  if (synced) hist = [...hist, synced]
  const entry = compact({
    id: ctx.newId(), at: Math.max(ctx.now, (synced?.at ?? lastAt) + 1), kind: 'named', from: ctx.from, dev: ctx.dev,
    name: name.trim(), note: note.trim() || undefined, list: state.cards, cmd: state.commanders, v1: valueOf(ctx, deck),
  })
  return { ...deck, history: capHistory([...hist, entry]) }
}

/**
 * [after] — [before] taken back to the list from [toAt] — with that recorded as one "restore" entry
 * holding the whole list. The list from before stays in the history, so going back is undone the
 * same way.
 */
export function withRestore(before: Deck, after: Deck, toAt: number, ctx: HistoryContext): Deck {
  let hist = historyOf(before)
  const beforeState = listStateOf(before)
  const afterState = listStateOf(after)
  const lastAt = hist.length > 0 ? hist[hist.length - 1].at : -Infinity
  const synced = hist.length > 0 ? catchUp(statesThrough(hist), beforeState, Math.max(ctx.now - 1, lastAt + 1), ctx) : null
  if (synced) hist = [...hist, synced]
  const { add, cut } = diffStates(beforeState, afterState)
  const entry = compact({
    id: ctx.newId(), at: Math.max(ctx.now, (synced?.at ?? lastAt) + 1), kind: 'restore', from: ctx.from, dev: ctx.dev,
    add, cut, list: afterState.cards, cmd: afterState.commanders, to: toAt, v0: valueOf(ctx, before), v1: valueOf(ctx, after),
  })
  return { ...after, history: capHistory([...hist, entry]) }
}

// ---- Sync ----

/** A stable order for two copies of one entry from the same moment, the same in both apps. */
const entryKey = (e: DeckHistoryEntry) =>
  [(e.add ?? []).map((l) => `${l.n}*${l.q}`).join(','), (e.cut ?? []).map((l) => `${l.n}*${l.q}`).join(','),
    String(Object.keys(e.list ?? {}).length), e.name ?? '', e.note ?? ''].join('|')

/**
 * Two devices' histories as one: every entry from either, once by id — the newer copy where both
 * have it — oldest first and capped. Undefined when neither has one.
 */
export function mergeHistory(mine: DeckHistoryEntry[] | undefined, theirs: DeckHistoryEntry[] | undefined): DeckHistoryEntry[] | undefined {
  if (mine === undefined && theirs === undefined) return undefined
  const byId = new Map<string, DeckHistoryEntry>()
  for (const e of [...(theirs ?? []), ...(mine ?? [])]) {
    const had = byId.get(e.id)
    if (!had) byId.set(e.id, e)
    else if (e.at !== had.at ? e.at > had.at : entryKey(e) > entryKey(had)) byId.set(e.id, e)
  }
  return capHistory(sortedHistory([...byId.values()]))
}

/** [theirs] with [source]'s history put back where an app that doesn't know it saved [theirs]. */
export function keepHistoryFromOlderApp(source: Deck, theirs: Deck): Deck {
  return theirs.history === undefined && source.history !== undefined ? { ...theirs, history: source.history } : theirs
}

// ---- Showing it ----

/** One entry as the History screen shows it, with the games played while it was the list. */
export interface HistoryItem {
  entry: DeckHistoryEntry
  added: HistoryLine[]
  removed: HistoryLine[]
  /** The commanders changed, to these. */
  commanders: string[] | null
  /** Copies in the list after it. */
  cards: number
  wins: number
  losses: number
  draws: number
  /** The newest entry: its list is the deck's now. */
  latest: boolean
}

/** Newest first; edits that changed nothing in the end left out. A game counts for the list it was played with. */
export function historyItems(deck: Deck): HistoryItem[] {
  const sorted = historyOf(deck)
  const states = statesThrough(sorted)
  const items: HistoryItem[] = []
  sorted.forEach((entry, i) => {
    const prev = i > 0 ? states[i - 1] : EMPTY_LIST
    const state = states[i]
    const listKind = entry.kind === 'start' || entry.kind === 'import' || entry.kind === 'named'
    const changedCommanders = !listKind && i > 0 && !sameList(prev.commanders, state.commanders)
    if (!listKind && !entry.add?.length && !entry.cut?.length && !changedCommanders) return
    items.push({
      entry, added: entry.add ?? [], removed: entry.cut ?? [],
      commanders: changedCommanders ? state.commanders : null,
      cards: cardCount(state), wins: 0, losses: 0, draws: 0, latest: false,
    })
  })
  items.forEach((item, i) => {
    const from = item.entry.at
    const until = items[i + 1]?.entry.at ?? Infinity
    for (const g of deck.gameResults) {
      if (g.playedAt < from || g.playedAt >= until) continue
      if (g.result === 'WIN') item.wins++
      else if (g.result === 'LOSS') item.losses++
      else if (g.result === 'DRAW') item.draws++
    }
  })
  if (items.length > 0) items[items.length - 1].latest = true
  return items.reverse()
}

/** "+ Sheoldred, the Apocalypse", or "+ 4" and "Skullclamp, Viscera Seer, …" — at most [most] names. */
export function linesText(sign: '+' | '−', lines: HistoryLine[], most = 5): { lead: string; rest: string } {
  const total = lines.reduce((n, l) => n + l.q, 0)
  if (lines.length === 1 && total === 1) return { lead: `${sign} ${lines[0].n}`, rest: '' }
  const names = lines.slice(0, most).map((l) => (l.q > 1 ? `${l.q} ${l.n}` : l.n))
  return { lead: `${sign} ${total}`, rest: names.join(', ') + (lines.length > most ? ', …' : '') }
}

/** "Went 2–1 with this list." (with draws, "2–1–1"); empty without games. */
export function recordLine(item: { wins: number; losses: number; draws: number }): string {
  if (item.wins + item.losses + item.draws === 0) return ''
  return `Went ${item.wins}–${item.losses}${item.draws > 0 ? `–${item.draws}` : ''} with this list.`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** "4 Oct", or "4 Oct 2025" in another year. */
export function dayText(at: number, now: number): string {
  const d = new Date(at)
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`
}

/** "Today, 14:20", "Yesterday, 09:05", or "12 Oct". */
export function whenText(at: number, now: number): string {
  const d = new Date(at)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (at >= startOfToday) return `Today, ${time}`
  if (at >= startOfToday - 24 * 60 * 60 * 1000) return `Yesterday, ${time}`
  return dayText(at, now)
}

/** The heading: a named version's name and day, otherwise when. */
export const entryTitle = (e: DeckHistoryEntry, now: number) => (e.kind === 'named' && e.name ? `${e.name} · ${dayText(e.at, now)}` : whenText(e.at, now))

/**
 * What goes beside the heading: "named", "imported", "synced", or where it was made — "this phone" /
 * "this browser" for this install, "manabind.com" for the web app, "phone" for another phone.
 */
export function sourceText(e: DeckHistoryEntry, here: { from: string; dev: string }): string {
  if (e.kind === 'named') return 'named'
  if (e.kind === 'import') return 'imported'
  if (e.kind === 'synced') return 'synced'
  if (!e.from) return ''
  if (e.from === here.from && e.dev === here.dev) return here.from === 'web' ? 'this browser' : 'this phone'
  return e.from === 'web' ? 'manabind.com' : here.from === 'web' ? 'phone' : 'another phone'
}

// ---- An earlier list ----

/** What differs between the list then and now: in it then, not now; and added since. A–Z. */
export function versionDiff(then: ListState, now: ListState): { gone: HistoryLine[]; added: HistoryLine[] } {
  const { add, cut } = diffStates(then, now)
  return { gone: cut, added: add }
}

/** The list then, A–Z. */
export const wholeList = (then: ListState): HistoryLine[] =>
  Object.keys(then.cards).sort(cmp).map((n) => ({ n, q: then.cards[n] }))

export interface RestorePlan {
  /** The deck with the list from then. */
  deck: Deck
  /** Entries that lost copies, and how many they have left (0: gone) — for the copies going back to the pile. */
  cuts: { entry: DeckCardEntry; newQuantity: number }[]
  /** Copies coming back into the deck. In a physical deck they're proxies until pulled from storage. */
  incoming: number
  /** Cards from then with nothing to make them from: fetch these and plan again. */
  missing: HistoryLine[]
}

/**
 * [deck] taken back to the list [then]. Cards in both keep their printings (copies come off the last
 * printing first); a card coming back takes the deck's own printing, else [known]'s (its sideboard,
 * Considering, binders, or fetched) — or goes in [missing]. In a physical deck, copies coming back are
 * proxies until they're pulled from storage, so its pull list fetches them. The commanders are set to
 * then's, where the deck has them.
 */
export function restoreList(deck: Deck, then: ListState, known: (name: string) => DeckCardEntry | undefined): RestorePlan {
  const physical = deck.ownership === 'PHYSICAL'
  const cuts: { entry: DeckCardEntry; newQuantity: number }[] = []
  const missing: HistoryLine[] = []
  let incoming = 0
  const have: Record<string, number> = {}
  for (const c of deck.cards) have[c.name] = (have[c.name] ?? 0) + c.quantity
  let cards = [...deck.cards]
  for (const name of Object.keys(have).sort(cmp)) {
    let over = have[name] - (then.cards[name] ?? 0)
    for (let i = cards.length - 1; i >= 0 && over > 0; i--) {
      const e = cards[i]
      if (e.name !== name) continue
      const take = Math.min(over, e.quantity)
      over -= take
      const newQuantity = e.quantity - take
      cuts.push({ entry: e, newQuantity })
      cards[i] = { ...e, quantity: newQuantity }
    }
  }
  cards = cards.filter((e) => e.quantity > 0).map((e) => {
    if (e.proxyQuantity == null || e.proxyQuantity <= e.quantity) return e
    return { ...e, proxyQuantity: e.quantity }
  })
  for (const name of Object.keys(then.cards).sort(cmp)) {
    const delta = then.cards[name] - (have[name] ?? 0)
    if (delta <= 0) continue
    const at = cards.findIndex((e) => e.name === name)
    if (at !== -1) {
      const e = cards[at]
      cards[at] = { ...e, quantity: e.quantity + delta, ...(physical ? { proxyQuantity: (e.proxyQuantity ?? 0) + delta } : {}) }
      incoming += delta
      continue
    }
    const from = known(name)
    if (!from) {
      missing.push({ n: name, q: delta })
      continue
    }
    const { proxyQuantity: _p, replaceable: _r, ...rest } = from
    cards.push({ ...rest, name, quantity: delta, ...(physical ? { proxyQuantity: delta } : {}) })
    incoming += delta
  }
  const leader = (n: string) => cards.find((e) => e.name === n) ?? null
  const inDeck = (e: DeckCardEntry | null) => (e ? cards.find((x) => x.scryfallId === e.scryfallId) ?? null : null)
  const commander = then.commanders.length > 0 ? leader(then.commanders[0]) ?? inDeck(deck.commander) : null
  const partnerCommander = then.commanders.length > 1 ? leader(then.commanders[1]) : null
  return { deck: { ...deck, cards, commander, partnerCommander }, cuts, incoming, missing }
}
