// Game night invites and pod chat — the rules behind the screens, kept apart so they can be tested.
// The server side is MtgCompanionApp/supabase/migrations/20261006070000_game_nights_chat.sql. The
// Android app's twin is data/social/GameNights.kt and data/social/PodChat.kt, case for case
// (tests/social/nights.test.ts ↔ GameNightsTest.kt, PodChatTest.kt).

import type { Profile } from './api'
import type { NightPlayer } from '../lifecounter/gameNight'

// ---- Invites ----

export type RsvpAnswer = 'going' | 'maybe' | 'cant'

/** One person invited to a night: a pod member, or a friend asked along ([member] false). */
export interface NightInvitee {
  user: Profile
  member: boolean
  answer: RsvpAnswer | null
  /** The deck they'll bring, as they named it. */
  deck: string | null
  /** ms */
  answeredAt: number | null
}

/** A game night as game_nights / game_night answer it. Times in ms. */
export interface NightInvite {
  id: string
  podId: string
  podName: string
  organiser: Profile
  startsAt: number
  /** The organiser's time zone (IANA). */
  tz: string
  /** Where: "Priya's". */
  place: string
  note: string | null
  cancelled: boolean
  createdAt: number
  updatedAt: number
  /** The pod's league season it counts for, if one runs that day. */
  season: { id: string; name: string } | null
  /** The organiser first, then by name. */
  invitees: NightInvitee[]
}

/** How long a night lasts, for calendars. */
export const NIGHT_HOURS = 4
/** The longest place the server takes. */
export const PLACE_MAX = 80
export const NOTE_MAX = 500
/** The reminder comes this long before the night. */
export const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const answerOf = (v: unknown): RsvpAnswer | null => (v === 'going' || v === 'maybe' || v === 'cant' ? v : null)

function profileOf(v: unknown): Profile {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { user_id: str(o.user_id) ?? '', username: str(o.username) ?? '', display_name: str(o.display_name) ?? 'Someone', avatar_path: str(o.avatar_path) }
}

/** One night from the server's JSON; null when it isn't one. */
export function parseNightInvite(raw: unknown): NightInvite | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  if (!id) return null
  const season = o.season && typeof o.season === 'object' ? (o.season as Record<string, unknown>) : null
  return {
    id,
    podId: str(o.podId) ?? '',
    podName: str(o.podName) ?? '',
    organiser: profileOf(o.organiser),
    startsAt: num(o.startsAt) ?? 0,
    tz: str(o.tz) ?? 'UTC',
    place: str(o.place) ?? '',
    note: str(o.note),
    cancelled: o.cancelled === true,
    createdAt: num(o.createdAt) ?? 0,
    updatedAt: num(o.updatedAt) ?? 0,
    season: season && str(season.id) ? { id: str(season.id)!, name: str(season.name) ?? '' } : null,
    invitees: (Array.isArray(o.invitees) ? o.invitees : []).map((i) => {
      const x = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>
      return { user: profileOf(x.user), member: x.member !== false, answer: answerOf(x.answer), deck: str(x.deck), answeredAt: num(x.answeredAt) }
    }),
  }
}

export const parseNightInvites = (raw: unknown): NightInvite[] =>
  (Array.isArray(raw) ? raw : []).map(parseNightInvite).filter((n): n is NightInvite => n !== null)

// ---- Dates, as both apps write them ----

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The wall-clock parts of [ms] in [tz] (an IANA zone; undefined: this device's). */
export function localParts(ms: number, tz?: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  return { year, month, day, hour: get('hour') % 24, minute: get('minute'), weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() }
}

/** "Fri 10 Oct". */
export function nightDay(ms: number, tz?: string): string {
  const p = localParts(ms, tz)
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`
}

/** "7pm", "7:30pm", "12am". */
export function nightTime(ms: number, tz?: string): string {
  const p = localParts(ms, tz)
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12
  return `${h}${p.minute === 0 ? '' : `:${String(p.minute).padStart(2, '0')}`}${p.hour < 12 ? 'am' : 'pm'}`
}

/** "Fri 10 Oct · 7pm". */
export const nightWhen = (ms: number, tz?: string) => `${nightDay(ms, tz)} · ${nightTime(ms, tz)}`

/** The date tile: "FRI" over "10". */
export function dateTile(ms: number, tz?: string): { weekday: string; day: string } {
  const p = localParts(ms, tz)
  return { weekday: DAYS[p.weekday].toUpperCase(), day: String(p.day) }
}

// ---- Who's coming ----

export const myInvite = (night: NightInvite, me: string) => night.invitees.find((i) => i.user.user_id === me) ?? null
export const myAnswer = (night: NightInvite, me: string): RsvpAnswer | null => myInvite(night, me)?.answer ?? null
export const goingCount = (night: NightInvite) => night.invitees.filter((i) => i.answer === 'going').length
/** Going or maybe. */
export const comingCount = (night: NightInvite) => night.invitees.filter((i) => i.answer === 'going' || i.answer === 'maybe').length

/** "Sam", "Sam, Jo", or "3" — those who said maybe, other than the user. */
function maybePart(night: NightInvite, me: string): string | null {
  const names = night.invitees.filter((i) => i.answer === 'maybe' && i.user.user_id !== me).map((i) => i.user.display_name)
  if (names.length === 0) return null
  return names.length <= 2 ? `${names.join(', ')} maybe` : `${names.length} maybe`
}

/** The user's own answer, as the card says it. */
export function myPart(answer: RsvpAnswer | null): string {
  switch (answer) {
    case 'going': return "you're going"
    case 'maybe': return 'you said maybe'
    case 'cant': return "you can't make it"
    default: return "you haven't answered"
  }
}

/** The People card: "4 going · Sam maybe · you haven't answered" (or "Called off"). */
export function rsvpLine(night: NightInvite, me: string): string {
  if (night.cancelled) return 'Called off'
  const going = goingCount(night)
  return [going > 0 ? `${going} going` : 'Nobody going yet', maybePart(night, me), myPart(myAnswer(night, me))].filter(Boolean).join(' · ')
}

/** The chat's card: "Priya's · 4 going, Sam maybe". */
export function chatCardLine(night: NightInvite, me: string): string {
  if (night.cancelled) return `${night.place} · called off`
  const going = goingCount(night)
  return [night.place, [going > 0 ? `${going} going` : 'nobody going yet', maybePart(night, me)].filter(Boolean).join(', ')].join(' · ')
}

/** The Play card: "Priya's · you're going · Season 2". */
export function playLine(night: NightInvite, me: string): string {
  if (night.cancelled) return `${night.place} · called off`
  return [night.place, myPart(myAnswer(night, me)), night.season?.name ?? null].filter(Boolean).join(' · ')
}

/** Under the date: "Thursday crew · counts for Season 2 · asked by Priya". */
export function headerLine(night: NightInvite, me: string): string {
  return [
    night.podName || null,
    night.season ? `counts for ${night.season.name}` : null,
    `asked by ${night.organiser.user_id === me ? 'you' : night.organiser.display_name}`,
  ].filter(Boolean).join(' · ')
}

/** "WHO'S COMING · 5 OF 6": going or maybe, of everyone asked. */
export const whoHeader = (night: NightInvite) => `WHO'S COMING · ${comingCount(night)} OF ${night.invitees.length}`

export type WhoTone = 'going' | 'maybe' | 'cant' | 'none'

/** One line of Who's coming: one person, or several with the same answer. */
export interface WhoRow { key: string; names: string; status: string; tone: WhoTone }

const STATUS: Record<WhoTone, string> = { going: 'Going', maybe: 'Maybe', cant: "Can't", none: 'No answer yet' }
const toneOf = (a: RsvpAnswer | null): WhoTone => a ?? 'none'

/**
 * Who's coming, as the invite shows it: the organiser ("Going · hosting"), the user ("You"), anyone
 * bringing a named deck on a line of their own ("Going · Krenko"), then everyone else grouped by
 * answer — going, maybe, can't, no answer yet ("Alex, Jo · Going").
 */
export function whoRows(night: NightInvite, me: string): WhoRow[] {
  const rows: WhoRow[] = []
  const status = (i: NightInvitee, extra: string | null) => [STATUS[toneOf(i.answer)], extra].filter(Boolean).join(' · ')
  const host = night.invitees.find((i) => i.user.user_id === night.organiser.user_id)
  if (host) {
    rows.push({ key: host.user.user_id, names: host.user.user_id === me ? 'You' : host.user.display_name, status: status(host, host.answer === 'cant' ? null : 'hosting'), tone: toneOf(host.answer) })
  }
  const mine = night.invitees.find((i) => i.user.user_id === me && i.user.user_id !== night.organiser.user_id)
  if (mine) rows.push({ key: me, names: 'You', status: status(mine, mine.answer !== 'cant' ? mine.deck : null), tone: toneOf(mine.answer) })
  const rest = night.invitees.filter((i) => i.user.user_id !== night.organiser.user_id && i.user.user_id !== me)
  for (const i of rest) {
    if (i.deck && (i.answer === 'going' || i.answer === 'maybe')) rows.push({ key: i.user.user_id, names: i.user.display_name, status: status(i, i.deck), tone: toneOf(i.answer) })
  }
  for (const tone of ['going', 'maybe', 'cant', 'none'] as WhoTone[]) {
    const group = rest.filter((i) => toneOf(i.answer) === tone && !(i.deck && (i.answer === 'going' || i.answer === 'maybe')))
    if (group.length > 0) rows.push({ key: `group-${tone}`, names: group.map((i) => i.user.display_name).join(', '), status: STATUS[tone], tone })
  }
  return rows
}

/** Whether the user may change or call off [night]: they organise it, or own its pod. */
export const canManageNight = (night: NightInvite, me: string, podOwner: string | null | undefined) =>
  night.organiser.user_id === me || podOwner === me

/** Nights still to come (or under way: begun less than 6 hours ago), not called off, soonest first. */
export function upcomingNights(nights: NightInvite[], now: number): NightInvite[] {
  return nights.filter((n) => !n.cancelled && n.startsAt > now - 6 * 60 * 60 * 1000).sort((a, b) => a.startsAt - b.startsAt)
}

/** The night the cards show: the soonest still to come, in [podId] when given. */
export function nextNight(nights: NightInvite[], now: number, podId?: string | null): NightInvite | null {
  return upcomingNights(nights, now).find((n) => !podId || n.podId === podId) ?? null
}

/** Everyone coming (going or maybe) but the user — for Pack your bag and Trade matches tonight. */
export function attendeesOf(night: NightInvite, me: string): { name: string; userId: string; deck: string | null }[] {
  return night.invitees
    .filter((i) => i.user.user_id !== me && (i.answer === 'going' || i.answer === 'maybe'))
    .map((i) => ({ name: i.user.display_name, userId: i.user.user_id, deck: i.deck }))
}

// ---- The reminder the day before ----

/** When to remind the user: a day before it starts. Null when called off, they can't make it, or that's past. */
export function reminderAt(night: NightInvite, me: string, now: number): number | null {
  if (night.cancelled || myAnswer(night, me) === 'cant' || !myInvite(night, me)) return null
  const at = night.startsAt - REMINDER_BEFORE_MS
  return at > now ? at : null
}

/** "Game night tomorrow" / "7pm at Priya's · 4 going". */
export function reminderText(night: NightInvite, tz?: string): { title: string; body: string } {
  const going = goingCount(night)
  return { title: 'Game night tomorrow', body: `${nightTime(night.startsAt, tz)} at ${night.place} · ${going > 0 ? `${going} going` : 'nobody going yet'}` }
}

// ---- Calendar (.ics) ----

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

function icsTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length

/** A content line folded at 75 octets (RFC 5545), never inside a character. */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = utf8Length(ch)
    const limit = out.length === 0 ? 75 : 74 // continuation lines start with a space
    if (size + n > limit) {
      out.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  out.push(current)
  return out.join('\r\n ')
}

/** The night as an iCalendar file, for "Add to calendar". [now]: when it's made. */
export function nightIcs(night: NightInvite, now: number): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Manabind//Game night//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${night.id}@manabind.com`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(night.startsAt)}`,
    `DTEND:${icsTime(night.startsAt + NIGHT_HOURS * 60 * 60 * 1000)}`,
    `SUMMARY:${icsText(calendarTitle(night))}`,
    `LOCATION:${icsText(night.place)}`,
    ...(night.note ? [`DESCRIPTION:${icsText(night.note)}`] : []),
    `STATUS:${night.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/** "Game night · Thursday crew". */
export const calendarTitle = (night: NightInvite) => (night.podName ? `Game night · ${night.podName}` : 'Game night')

// ---- Make pods on the night ----

/**
 * Tonight's game night players with everyone coming to [night] added: the user (with [myDeckId],
 * their deck by that name, when they have one) and each friend coming, by account, with the deck
 * they named. Players already there stay as they are.
 */
export function playersFromInvite(
  players: NightPlayer[],
  night: NightInvite,
  me: string,
  myName: string,
  myDeck: { id: string; name: string; commander: string | null } | null,
  newId: () => string,
): NightPlayer[] {
  const out = [...players]
  if (!out.some((p) => p.kind === 'ME')) {
    out.push({ id: newId(), name: myName || 'Me', kind: 'ME', deckId: myDeck?.id ?? null, deck: myDeck?.name ?? null, commander: myDeck?.commander ?? null, bracket: null })
  }
  for (const a of attendeesOf(night, me)) {
    if (out.some((p) => p.userId === a.userId)) continue
    out.push({ id: newId(), name: a.name, kind: 'FRIEND', userId: a.userId, deck: a.deck, commander: null, bracket: null })
  }
  return out
}

/** The user's deck of the name they gave in their answer (case aside), if they have one. */
export function deckNamed<D extends { id: string; name: string }>(decks: D[], name: string | null | undefined): D | null {
  const n = name?.trim().toLowerCase()
  if (!n) return null
  return decks.find((d) => d.name.trim().toLowerCase() === n) ?? null
}

// ---- Pod chat ----

export type PodMessageKind = 'text' | 'share' | 'night' | 'league' | 'system'

/** What a message shares or points at (see the migration's pod_messages.ref). */
export interface PodMessageRef {
  type?: 'night' | 'deck' | 'card'
  nightId?: string
  startsAt?: number
  place?: string
  ownerId?: string
  itemId?: string
  name?: string
  gameId?: string
  seasonId?: string | null
  season?: string | null
}

export interface PodMessage {
  id: number
  podId: string
  /** Null: posted by Manabind (a league result, a night moved or called off). */
  sender: string | null
  kind: PodMessageKind
  body: string
  ref: PodMessageRef | null
  /** ms */
  createdAt: number
}

/** One pod's chat in the list: its last message and how many wait unread. */
export interface PodChat {
  podId: string
  name: string
  members: number
  last: (PodMessage & { senderName: string | null }) | null
  unread: number
}

const KINDS: PodMessageKind[] = ['text', 'share', 'night', 'league', 'system']

export function parsePodMessage(raw: unknown): PodMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = num(o.id)
  if (id == null) return null
  const kind = KINDS.includes(o.kind as PodMessageKind) ? (o.kind as PodMessageKind) : 'text'
  return {
    id,
    podId: str(o.podId) ?? '',
    sender: str(o.sender),
    kind,
    body: str(o.body) ?? '',
    ref: o.ref && typeof o.ref === 'object' ? (o.ref as PodMessageRef) : null,
    createdAt: num(o.createdAt) ?? 0,
  }
}

export const parsePodMessages = (raw: unknown): PodMessage[] =>
  (Array.isArray(raw) ? raw : []).map(parsePodMessage).filter((m): m is PodMessage => m !== null)

export function parsePodChats(raw: unknown): PodChat[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const podId = str(o.podId)
    if (!podId) return []
    const last = parsePodMessage(o.last)
    const lastRaw = (o.last && typeof o.last === 'object' ? o.last : {}) as Record<string, unknown>
    return [{ podId, name: str(o.name) ?? '', members: num(o.members) ?? 0, last: last ? { ...last, senderName: str(lastRaw.senderName) } : null, unread: num(o.unread) ?? 0 }]
  })
}

/** [list] with [incoming] added: each message once (by id), oldest first. */
export function mergePodMessages(list: PodMessage[], incoming: PodMessage[]): PodMessage[] {
  const byId = new Map<number, PodMessage>()
  for (const m of [...list, ...incoming]) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** What a shared thing is, in a few words: "Shared a game night", "Shared a deck: Krenko". */
export function shareLine(ref: PodMessageRef | null): string {
  switch (ref?.type) {
    case 'night': return 'Shared a game night'
    case 'deck': return `Shared a deck: ${ref.name ?? ''}`.trim()
    case 'card': return `Shared a card: ${ref.name ?? ''}`.trim()
    default: return 'Shared something'
  }
}

/** A chat's last message for the list: "You: …", "Sam: …", or what Manabind posted, cut to 80 characters. */
export function podPreview(last: (Pick<PodMessage, 'sender' | 'kind' | 'body' | 'ref'> & { senderName?: string | null }) | null, me: string): string {
  if (!last) return 'No messages yet'
  const what = last.kind === 'night' ? 'Planned a game night' : last.kind === 'share' ? (last.body.trim() || shareLine(last.ref)) : last.body
  const text = what.replace(/\s+/g, ' ').trim()
  const cut = text.length > 80 ? `${text.slice(0, 79)}…` : text
  if (!last.sender) return cut
  return `${last.sender === me ? 'You' : last.senderName || 'Someone'}: ${cut}`
}

/** "Priya, Sam, Alex, Jo and you" — the pod's people under its name ([others]: everyone but the user). */
export function membersLine(others: string[]): string {
  if (others.length === 0) return 'Just you'
  return `${others.join(', ')} and you`
}

/** A day heading in the chat: "Today", "Yesterday", "Tuesday" (this past week), then "10 Oct" (with the year when it isn't this one). */
export function chatDayLabel(ms: number, now: number, tz?: string): string {
  const a = localParts(ms, tz)
  const b = localParts(now, tz)
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return LONG_DAYS[a.weekday]
  return `${a.day} ${MONTHS[a.month - 1]}${a.year === b.year ? '' : ` ${a.year}`}`
}

/** Messages within this long of the one before, from the same person, don't repeat the name. */
export const GROUP_MS = 5 * 60 * 1000

export type ChatItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'message'; key: string; message: PodMessage; mine: boolean; showName: boolean }

/** The chat as shown: a heading for each day, and each person's name over the first of a run of their messages. */
export function chatItems(messages: PodMessage[], me: string, now: number, tz?: string): ChatItem[] {
  const out: ChatItem[] = []
  let lastDay = ''
  let prev: PodMessage | null = null
  for (const m of messages) {
    const day = chatDayLabel(m.createdAt, now, tz)
    const dayKey = (() => { const p = localParts(m.createdAt, tz); return `${p.year}-${p.month}-${p.day}` })()
    let newDay = false
    if (dayKey !== lastDay) {
      out.push({ type: 'day', key: `day-${dayKey}`, label: day })
      lastDay = dayKey
      newDay = true
    }
    const person = m.sender && (m.kind === 'text' || m.kind === 'share' || m.kind === 'night')
    const runs = !newDay && prev != null && prev.sender === m.sender && (prev.kind === 'text' || prev.kind === 'share' || prev.kind === 'night') && m.createdAt - prev.createdAt <= GROUP_MS
    out.push({ type: 'message', key: `m-${m.id}`, message: m, mine: m.sender === me, showName: !!person && m.sender !== me && !runs })
    prev = m
  }
  return out
}

/** How many of [messages] wait unread past [readId] — others' and Manabind's, not the user's own. */
export const unreadIn = (messages: PodMessage[], readId: number, me: string) => messages.filter((m) => m.id > readId && m.sender !== me).length

/** One line of the Chats list: a direct conversation or a pod's chat, by when it last had a message. */
export interface ChatRow { kind: 'dm' | 'pod'; id: string; at: number | null; unread: number }

/** Direct conversations and pod chats in one list, newest first; ones with no messages last, by name order given. */
export function mergeChatRows(dms: ChatRow[], pods: ChatRow[]): ChatRow[] {
  return [...dms, ...pods].map((r, i) => ({ r, i })).sort((x, y) => (y.r.at ?? -1) - (x.r.at ?? -1) || x.i - y.i).map((x) => x.r)
}

export const totalUnread = (rows: Pick<ChatRow, 'unread'>[]) => rows.reduce((n, r) => n + Math.max(0, r.unread), 0)

/** Under a league result: "Table: Priya 14 · you 11 · Sam 9" (the top [top]). Null before any points. */
export function tableLine(standings: { userId: string | null; name: string; points: number }[], me: string, top = 3): string | null {
  if (standings.length === 0) return null
  return `Table: ${standings.slice(0, top).map((s) => `${s.userId === me ? 'you' : s.name} ${s.points}`).join(' · ')}`
}

/** The label over a league result: "LEAGUE · SEASON 2", or "GAME" outside a season. */
export const leagueLabel = (ref: PodMessageRef | null) => (ref?.season ? `LEAGUE · ${ref.season.toUpperCase()}` : 'GAME')

/** The longest message the server takes. */
export const POD_MESSAGE_MAX = 2000

/** A tapped notification's "open": a night ("night:<id>") or a pod's chat ("pod:<id>") — the web path to go to. */
export function notificationPath(open: string): string | null {
  if (open.startsWith('night:')) return `play/nights/${open.slice(6)}`
  if (open.startsWith('pod:')) return `pods/${open.slice(4)}/chat`
  return null
}
