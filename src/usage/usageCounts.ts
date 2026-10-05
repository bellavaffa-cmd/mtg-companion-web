// Anonymous feature-usage counts: the rules, with no storage or network (those are in ./usage).
// The Android app has the same rules and the same names (data/usage/UsageCounts.kt), and both send
// to the record_usage function in the owner's Supabase project.
//
// What's counted is a closed list: screens opened and a few feature actions. Never card names, deck
// contents, free text or the account — only an anonymous random install id (a new one every 90
// days), the platform, the app version and the day. Counts are kept per day and sent once the day
// is over, at most one try a day; a day that's never sent is dropped after a week.

/** Feature actions, the same in both apps. */
export const USAGE_ACTIONS = [
  'deck_created', 'card_scanned', 'cards_imported', 'game_started', 'game_recorded', 'pull_list_started',
  'place_created', 'loan_created', 'message_sent', 'trade_proposed', 'filter_saved', 'event_started',
] as const
export type UsageAction = (typeof USAGE_ACTIONS)[number]

/** Screens, by the names both apps count them under (as "screen_<name>"). */
export const USAGE_SCREENS = [
  'home', 'search', 'search_results', 'collection', 'collection_detail', 'decks', 'deck', 'new_deck', 'precons',
  'settings', 'settings_section', 'account', 'scan', 'rules', 'life_counter', 'play', 'events', 'event_new', 'event',
  'game_night', 'value_history', 'spread_thin', 'playgroup', 'friends', 'friend', 'trades', 'trade_new',
  'shared_item', 'shared_collection', 'friend_shared', 'messages', 'conversation', 'for_trade', 'qr_scan', 'remote',
  'card', 'place', 'check', 'check_results', 'place_fit', 'put_away', 'loans', 'lend', 'copy_history',
  'value_by_place', 'sort_pile', 'place_label', 'pull_list', 'put_back', 'scan_tick', 'tag_binder', 'set_cards',
  'token_badge', 'add_friend', 'approve_login', 'join_seat', 'get_app',
] as const
export type UsageScreen = (typeof USAGE_SCREENS)[number]

export const screenEvent = (screen: UsageScreen) => `screen_${screen}`

const ALLOWED = new Set<string>([...USAGE_ACTIONS, ...USAGE_SCREENS.map(screenEvent)])
export const isUsageEvent = (event: string) => ALLOWED.has(event)

export const ROTATE_DAYS = 90
export const KEEP_DAYS = 7
export const MAX_COUNT = 10000
export const MAX_EVENTS_PER_SEND = 100

export interface UsageBucket {
  day: string
  /** The install id the day was counted under, so a rotation doesn't tie old days to the new id. */
  install: string
  counts: Record<string, number>
}

export interface UsageState {
  install: string
  /** The day the install id was made. */
  installDay: string
  /** The last day a send was tried. */
  lastTry: string
  buckets: UsageBucket[]
}

export interface UsageBatch {
  day: string
  install: string
  counts: Record<string, number>
}

export const emptyUsage = (): UsageState => ({ install: '', installDay: '', lastTry: '', buckets: [] })

const DAY = /^\d{4}-\d{2}-\d{2}$/
const INSTALL = /^[0-9a-f]{32}$/

/** Days from [from] to [to] ("YYYY-MM-DD"); NaN when either isn't a day. */
export function daysBetween(from: string, to: string): number {
  const at = (d: string) => (DAY.test(d) ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) : NaN)
  return Math.round((at(to) - at(from)) / 86_400_000)
}

/** A day in local time, "YYYY-MM-DD". */
export function dayOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** A fresh install id: 32 random hex digits. */
export function newInstallId(random: () => string = () => crypto.randomUUID()): string {
  return random().replace(/-/g, '').toLowerCase()
}

/** Makes an install id when there's none, or the one there is 90 days old. */
export function withInstall(state: UsageState, today: string, newId: () => string): UsageState {
  const age = daysBetween(state.installDay, today)
  if (INSTALL.test(state.install) && age >= 0 && age < ROTATE_DAYS) return state
  return { ...state, install: newId(), installDay: today }
}

/** Drops days more than a week old (and days ahead of today, from a clock that moved back). */
export function expire(state: UsageState, today: string): UsageState {
  const buckets = state.buckets.filter((b) => {
    const age = daysBetween(b.day, today)
    return age >= -1 && age <= KEEP_DAYS
  })
  return buckets.length === state.buckets.length ? state : { ...state, buckets }
}

/** Counts one [event] today. Off, or an event not on the list, counts nothing. */
export function record(state: UsageState, event: string, today: string, enabled: boolean, newId: () => string): UsageState {
  if (!enabled || !isUsageEvent(event)) return state
  const s = expire(withInstall(state, today, newId), today)
  const i = s.buckets.findIndex((b) => b.day === today && b.install === s.install)
  const bucket = i >= 0 ? s.buckets[i] : { day: today, install: s.install, counts: {} }
  const counts = { ...bucket.counts, [event]: Math.min((bucket.counts[event] ?? 0) + 1, MAX_COUNT) }
  const buckets = i >= 0 ? s.buckets.map((b, j) => (j === i ? { ...b, counts } : b)) : [...s.buckets, { ...bucket, counts }]
  return { ...s, buckets }
}

/**
 * What to send now: each finished day (before today), at most [MAX_EVENTS_PER_SEND] events a batch —
 * nothing when off or already tried today.
 */
export function dueBatches(state: UsageState, today: string, enabled: boolean): UsageBatch[] {
  if (!enabled || state.lastTry === today) return []
  const out: UsageBatch[] = []
  for (const b of expire(state, today).buckets) {
    if (daysBetween(b.day, today) < 1) continue
    const entries = Object.entries(b.counts).filter(([, n]) => n > 0)
    for (let i = 0; i < entries.length; i += MAX_EVENTS_PER_SEND) {
      out.push({ day: b.day, install: b.install, counts: Object.fromEntries(entries.slice(i, i + MAX_EVENTS_PER_SEND)) })
    }
  }
  return out
}

/** A send was tried today (it's not tried again until tomorrow, whatever came of it). */
export const markTried = (state: UsageState, today: string): UsageState => ({ ...expire(state, today), lastTry: today })

/** A batch went: its counts are dropped. */
export function markSent(state: UsageState, batch: UsageBatch): UsageState {
  const buckets = state.buckets.flatMap((b) => {
    if (b.day !== batch.day || b.install !== batch.install) return [b]
    const counts = Object.fromEntries(Object.entries(b.counts).filter(([event]) => !(event in batch.counts)))
    return Object.keys(counts).length > 0 ? [{ ...b, counts }] : []
  })
  return { ...state, buckets }
}

/** Turned off: everything kept is forgotten, install id included. */
export const optedOut = (): UsageState => emptyUsage()

/** A stored state, checked; anything that doesn't fit is dropped. */
export function parseUsage(json: string | null | undefined): UsageState {
  try {
    const raw = JSON.parse(json ?? '') as Partial<UsageState>
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    const buckets = (Array.isArray(raw.buckets) ? raw.buckets : []).flatMap((b: Partial<UsageBucket>) => {
      if (!b || !DAY.test(text(b.day)) || !INSTALL.test(text(b.install)) || typeof b.counts !== 'object' || !b.counts) return []
      const counts = Object.fromEntries(Object.entries(b.counts).filter(([e, n]) => isUsageEvent(e) && Number.isInteger(n) && n > 0)
        .map(([e, n]) => [e, Math.min(n as number, MAX_COUNT)]))
      return Object.keys(counts).length > 0 ? [{ day: text(b.day), install: text(b.install), counts }] : []
    })
    return { install: text(raw.install), installDay: text(raw.installDay), lastTry: text(raw.lastTry), buckets }
  } catch {
    return emptyUsage()
  }
}

// ---- Screens ----

/** The web app's routes (App.tsx), as the screen each is counted under. */
const ROUTES: [string, UsageScreen][] = [
  ['/', 'home'], ['/collections', 'collection'], ['/collections/:id', 'collection_detail'],
  ['/collections/tag/:id', 'tag_binder'], ['/collections/set/:code', 'set_cards'], ['/collections/place/:id', 'place'],
  ['/collections/place/:id/label', 'place_label'], ['/collections/place/:id/fit', 'place_fit'],
  ['/collections/place/:id/check', 'check_results'], ['/collections/labels', 'place_label'],
  ['/collections/value', 'value_by_place'], ['/collections/thin', 'spread_thin'], ['/loans', 'loans'],
  ['/loans/lend', 'lend'], ['/history', 'copy_history'], ['/place/:id', 'place'], ['/decks', 'decks'],
  ['/decks/new', 'new_deck'], ['/decks/:id', 'deck'], ['/decks/:id/pull', 'pull_list'], ['/decks/:id/put-back', 'put_back'],
  ['/precons', 'precons'], ['/rules', 'rules'], ['/play', 'play'], ['/play/playgroup', 'playgroup'],
  ['/play/events', 'events'], ['/play/events/new', 'event_new'], ['/play/events/:id', 'event'], ['/play/night', 'game_night'],
  ['/search', 'search'], ['/card/:name', 'card'], ['/scan', 'scan'], ['/account', 'account'], ['/settings', 'settings'],
  ['/settings/:section', 'settings_section'], ['/friends', 'friends'], ['/friends/:id', 'friend'], ['/trades', 'trades'],
  ['/trades/new', 'trade_new'], ['/messages', 'messages'], ['/messages/:id', 'conversation'], ['/for-trade', 'for_trade'],
  ['/shared/:owner', 'friend_shared'], ['/shared/:owner/collection', 'shared_collection'],
  ['/shared/:owner/:kind/:item', 'shared_item'], ['/s/:token', 'shared_item'], ['/add/:user', 'add_friend'],
  ['/login/:code', 'approve_login'], ['/join/:code/:seat', 'join_seat'], ['/app', 'get_app'], ['/value', 'value_history'],
  ['/life', 'life_counter'], ['/remote/:match/:seat', 'remote'],
]
const ROUTE_PARTS = ROUTES.map(([path, screen]) => ({ parts: path.split('/').filter(Boolean), screen }))

/** The screen a path shows, or null for one not on the list. Ids in the path are never kept. */
export function screenOfPath(pathname: string): UsageScreen | null {
  const parts = pathname.split('/').filter(Boolean)
  let best: { screen: UsageScreen; score: number } | null = null
  for (const r of ROUTE_PARTS) {
    if (r.parts.length !== parts.length) continue
    let score = 0
    const fits = r.parts.every((p, i) => {
      if (p.startsWith(':')) return true
      score++
      return p === parts[i]
    })
    if (fits && (!best || score > best.score)) best = { screen: r.screen, score }
  }
  return best?.screen ?? null
}
