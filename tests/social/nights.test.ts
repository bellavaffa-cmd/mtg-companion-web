// Game night invites and pod chat (src/social/nightsLogic.ts). The Android app runs the same cases in
// GameNightsTest.kt and PodChatTest.kt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attendeesOf, chatCardLine, chatDayLabel, chatItems, dateTile, deckNamed, foldIcsLine, headerLine, leagueLabel, membersLine, mergeChatRows,
  mergePodMessages, nextNight, nightIcs, nightWhen, notificationPath, parseNightInvite, parsePodChats, playLine, playersFromInvite, podPreview,
  reminderAt, reminderText, rsvpLine, tableLine, totalUnread, unreadIn, whoHeader, whoRows,
  type NightInvite, type NightInvitee, type PodMessage, type RsvpAnswer,
} from '../../src/social/nightsLogic.ts'

const UTC = 'UTC'
/** Fri 9 Oct 2026, 19:00 UTC. */
const FRI_7PM = Date.UTC(2026, 9, 9, 19, 0)
const HOUR = 3_600_000

const person = (id: string, name: string) => ({ user_id: id, username: name.toLowerCase(), display_name: name, avatar_path: null })
const inv = (id: string, name: string, answer: RsvpAnswer | null, deck: string | null = null): NightInvitee =>
  ({ user: person(id, name), member: true, answer, deck, answeredAt: answer ? 1 : null })

function night(over: Partial<NightInvite> = {}): NightInvite {
  return {
    id: 'n1', podId: 'p1', podName: 'Thursday crew', organiser: person('priya', 'Priya'), startsAt: FRI_7PM, tz: UTC, place: "Priya's",
    note: null, cancelled: false, createdAt: 0, updatedAt: 0, season: { id: 's2', name: 'Season 2' },
    invitees: [
      inv('priya', 'Priya', 'going'), inv('me', 'Me', 'going', 'Krenko'), inv('alex', 'Alex', 'going'), inv('jo', 'Jo', 'going'),
      inv('sam', 'Sam', 'maybe'), inv('max', 'Max', null),
    ],
    ...over,
  }
}

test('dates read the same in both apps', () => {
  assert.equal(nightWhen(FRI_7PM, UTC), 'Fri 9 Oct · 7pm')
  assert.equal(nightWhen(FRI_7PM + 30 * 60_000, UTC), 'Fri 9 Oct · 7:30pm')
  assert.equal(nightWhen(Date.UTC(2026, 9, 10, 0, 5), UTC), 'Sat 10 Oct · 12:05am')
  assert.equal(nightWhen(Date.UTC(2026, 9, 10, 12, 0), UTC), 'Sat 10 Oct · 12pm')
  assert.equal(nightWhen(FRI_7PM, 'Europe/London'), 'Fri 9 Oct · 8pm')
  assert.deepEqual(dateTile(FRI_7PM, UTC), { weekday: 'FRI', day: '9' })
})

test('the RSVP summaries', () => {
  const n = night({ invitees: night().invitees.map((i) => (i.user.user_id === 'me' ? { ...i, answer: null, deck: null } : i)) })
  assert.equal(rsvpLine(n, 'me'), "3 going · Sam maybe · you haven't answered")
  assert.equal(rsvpLine(night(), 'me'), "4 going · Sam maybe · you're going")
  assert.equal(rsvpLine(night({ cancelled: true }), 'me'), 'Called off')
  assert.equal(chatCardLine(night(), 'me'), "Priya's · 4 going, Sam maybe")
  assert.equal(playLine(night(), 'me'), "Priya's · you're going · Season 2")
  assert.equal(playLine(night({ season: null }), 'me'), "Priya's · you're going")
  assert.equal(headerLine(night(), 'me'), 'Thursday crew · counts for Season 2 · asked by Priya')
  assert.equal(headerLine(night({ season: null }), 'priya'), 'Thursday crew · asked by you')
  assert.equal(whoHeader(night()), "WHO'S COMING · 5 OF 6")
  const many = night({ invitees: [inv('priya', 'Priya', 'going'), inv('a', 'A', 'maybe'), inv('b', 'B', 'maybe'), inv('c', 'C', 'maybe')] })
  assert.equal(rsvpLine(many, 'me'), "1 going · 3 maybe · you haven't answered")
  assert.equal(rsvpLine(night({ invitees: [inv('priya', 'Priya', 'cant'), inv('me', 'Me', 'cant')] }), 'me'), "Nobody going yet · you can't make it")
})

test("who's coming: host, you, named decks, then grouped by answer", () => {
  assert.deepEqual(whoRows(night(), 'me').map((r) => [r.names, r.status, r.tone]), [
    ['Priya', 'Going · hosting', 'going'],
    ['You', 'Going · Krenko', 'going'],
    ['Alex, Jo', 'Going', 'going'],
    ['Sam', 'Maybe', 'maybe'],
    ['Max', 'No answer yet', 'none'],
  ])
  const withDeck = night({ invitees: [inv('priya', 'Priya', 'going'), inv('sam', 'Sam', 'maybe', 'Atraxa'), inv('jo', 'Jo', 'cant', 'Ur-Dragon')] })
  assert.deepEqual(whoRows(withDeck, 'priya').map((r) => [r.names, r.status]), [['You', 'Going · hosting'], ['Sam', 'Maybe · Atraxa'], ['Jo', "Can't"]])
})

test('the next night, and who comes along', () => {
  const a = night({ id: 'a', startsAt: FRI_7PM + 48 * HOUR })
  const b = night({ id: 'b', startsAt: FRI_7PM, podId: 'p2' })
  const c = night({ id: 'c', startsAt: FRI_7PM - HOUR, cancelled: true })
  assert.equal(nextNight([a, b, c], FRI_7PM - 10 * HOUR)?.id, 'b')
  assert.equal(nextNight([a, b, c], FRI_7PM - 10 * HOUR, 'p1')?.id, 'a')
  assert.equal(nextNight([a, b], FRI_7PM + 5 * HOUR)?.id, 'b') // under way
  assert.equal(nextNight([a, b], FRI_7PM + 7 * HOUR)?.id, 'a')
  assert.equal(nextNight([], 0), null)
  assert.deepEqual(attendeesOf(night(), 'me').map((x) => x.name), ['Priya', 'Alex', 'Jo', 'Sam'])
})

test('the reminder comes a day before, for those coming', () => {
  assert.equal(reminderAt(night(), 'me', FRI_7PM - 48 * HOUR), FRI_7PM - 24 * HOUR)
  assert.equal(reminderAt(night(), 'me', FRI_7PM - 20 * HOUR), null) // already past
  assert.equal(reminderAt(night(), 'max', FRI_7PM - 48 * HOUR), FRI_7PM - 24 * HOUR) // no answer yet: still reminded
  assert.equal(reminderAt(night({ invitees: [inv('me', 'Me', 'cant')] }), 'me', 0), null)
  assert.equal(reminderAt(night({ cancelled: true }), 'me', 0), null)
  assert.equal(reminderAt(night(), 'stranger', 0), null)
  assert.deepEqual(reminderText(night(), UTC), { title: 'Game night tomorrow', body: "7pm at Priya's · 4 going" })
})

test('an .ics file for the calendar', () => {
  const ics = nightIcs(night({ note: 'Bring tokens, dice; and snacks\nsee you' }), Date.UTC(2026, 9, 7, 12, 0, 0))
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.ok(ics.includes('\r\nUID:n1@manabind.com\r\n'))
  assert.ok(ics.includes('\r\nDTSTAMP:20261007T120000Z\r\n'))
  assert.ok(ics.includes('\r\nDTSTART:20261009T190000Z\r\n'))
  assert.ok(ics.includes('\r\nDTEND:20261009T230000Z\r\n'))
  assert.ok(ics.includes('\r\nSUMMARY:Game night · Thursday crew\r\n'))
  assert.ok(ics.includes("\r\nLOCATION:Priya's\r\n"))
  assert.ok(ics.includes('\r\nDESCRIPTION:Bring tokens\\, dice\\; and snacks\\nsee you\r\n'))
  assert.ok(ics.includes('\r\nSTATUS:CONFIRMED\r\n'))
  assert.ok(nightIcs(night({ cancelled: true }), 0).includes('STATUS:CANCELLED'))
  const folded = foldIcsLine(`DESCRIPTION:${'é'.repeat(80)}`)
  const parts = folded.split('\r\n')
  assert.equal(parts.length, 3)
  for (const p of parts) assert.ok(new TextEncoder().encode(p).length <= 75)
  assert.equal(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join(''), `DESCRIPTION:${'é'.repeat(80)}`)
  assert.equal(foldIcsLine('SHORT:x'), 'SHORT:x')
})

test('make pods on the night: the user and everyone coming', () => {
  let n = 0
  const id = () => `p${++n}`
  const players = playersFromInvite([], night(), 'me', 'Me', { id: 'd1', name: 'Krenko', commander: 'Krenko, Mob Boss' }, id)
  assert.deepEqual(players.map((p) => [p.name, p.kind, p.userId ?? null, p.deck]), [
    ['Me', 'ME', null, 'Krenko'], ['Priya', 'FRIEND', 'priya', null], ['Alex', 'FRIEND', 'alex', null], ['Jo', 'FRIEND', 'jo', null], ['Sam', 'FRIEND', 'sam', null],
  ])
  assert.equal(players[0].deckId, 'd1')
  // Already there: kept, not doubled.
  const again = playersFromInvite(players, night(), 'me', 'Me', null, id)
  assert.equal(again.length, players.length)
  assert.equal(deckNamed([{ id: 'd1', name: 'Krenko ' }], 'krenko')?.id, 'd1')
  assert.equal(deckNamed([{ id: 'd1', name: 'Krenko' }], null), null)
})

test('parsing a night from the server', () => {
  const parsed = parseNightInvite({
    id: 'n1', podId: 'p1', podName: 'Thursday crew', organiser: person('priya', 'Priya'), startsAt: FRI_7PM, tz: 'Europe/London', place: "Priya's",
    note: null, cancelled: false, createdAt: 1, updatedAt: 2, season: null,
    invitees: [{ user: person('priya', 'Priya'), member: true, answer: 'going', deck: null, answeredAt: 3 }, { user: person('x', 'X'), member: false, answer: 'nope', deck: null, answeredAt: null }],
  })
  assert.equal(parsed?.invitees[1].answer, null)
  assert.equal(parsed?.invitees[1].member, false)
  assert.equal(parsed?.season, null)
  assert.equal(parseNightInvite(null), null)
})

const pm = (id: number, sender: string | null, at: number, kind: PodMessage['kind'] = 'text', body = 'hi'): PodMessage =>
  ({ id, podId: 'p1', sender, kind, body, ref: null, createdAt: at })

test('chat days and runs of messages', () => {
  const now = Date.UTC(2026, 9, 8, 15, 0) // Thursday
  assert.equal(chatDayLabel(Date.UTC(2026, 9, 8, 1, 0), now, UTC), 'Today')
  assert.equal(chatDayLabel(Date.UTC(2026, 9, 7, 23, 0), now, UTC), 'Yesterday')
  assert.equal(chatDayLabel(Date.UTC(2026, 9, 6, 9, 0), now, UTC), 'Tuesday')
  assert.equal(chatDayLabel(Date.UTC(2026, 8, 30, 9, 0), now, UTC), '30 Sep')
  assert.equal(chatDayLabel(Date.UTC(2025, 11, 30, 9, 0), now, UTC), '30 Dec 2025')

  const tue = Date.UTC(2026, 9, 6, 18, 0)
  const items = chatItems([
    pm(1, null, tue, 'league', 'Priya won with Atraxa.'),
    pm(2, 'priya', tue + 60_000),
    pm(3, 'priya', tue + 2 * 60_000),
    pm(4, 'priya', tue + 20 * 60_000),
    pm(5, 'me', tue + 21 * 60_000),
    pm(6, 'sam', Date.UTC(2026, 9, 8, 9, 0)),
  ], 'me', now, UTC)
  assert.deepEqual(items.map((i) => (i.type === 'day' ? `day:${i.label}` : `${i.message.id}:${i.showName ? 'name' : ''}${i.mine ? 'mine' : ''}`)), [
    'day:Tuesday', '1:', '2:name', '3:', '4:name', '5:mine', 'day:Today', '6:name',
  ])
})

test('unread counts and the merged Chats list', () => {
  const msgs = [pm(1, 'sam', 0), pm(2, 'me', 0), pm(3, null, 0, 'league'), pm(4, 'jo', 0)]
  assert.equal(unreadIn(msgs, 1, 'me'), 2)
  assert.equal(unreadIn(msgs, 0, 'me'), 3)
  assert.deepEqual(mergePodMessages([pm(3, 'a', 0), pm(1, 'a', 0)], [pm(2, 'a', 0), pm(3, 'b', 0)]).map((m) => [m.id, m.sender]), [[1, 'a'], [2, 'a'], [3, 'b']])
  const rows = mergeChatRows(
    [{ kind: 'dm', id: 'sam', at: 100, unread: 1 }, { kind: 'dm', id: 'jo', at: null, unread: 0 }],
    [{ kind: 'pod', id: 'p1', at: 200, unread: 3 }, { kind: 'pod', id: 'p2', at: 50, unread: 0 }],
  )
  assert.deepEqual(rows.map((r) => r.id), ['p1', 'sam', 'p2', 'jo'])
  assert.equal(totalUnread(rows), 4)
  const chats = parsePodChats([{ podId: 'p1', name: 'Thursday crew', members: 5, unread: 2, last: { id: 9, podId: 'p1', sender: 'sam', kind: 'text', body: 'See you', ref: null, createdAt: 5, senderName: 'Sam' } }, { podId: 'p2', name: 'Quiet', members: 2, unread: 0, last: null }])
  assert.equal(podPreview(chats[0].last, 'me'), 'Sam: See you')
  assert.equal(podPreview(chats[1].last, 'me'), 'No messages yet')
  assert.equal(podPreview({ sender: 'me', kind: 'text', body: 'x'.repeat(100), ref: null }, 'me'), `You: ${'x'.repeat(79)}…`)
  assert.equal(podPreview({ sender: null, kind: 'league', body: 'Priya won with Atraxa.', ref: null }, 'me'), 'Priya won with Atraxa.')
  assert.equal(podPreview({ sender: 'sam', senderName: 'Sam', kind: 'share', body: '', ref: { type: 'deck', name: 'Krenko' } }, 'me'), 'Sam: Shared a deck: Krenko')
  assert.equal(podPreview({ sender: 'priya', senderName: 'Priya', kind: 'night', body: '', ref: null }, 'me'), 'Priya: Planned a game night')
})

test('league posts and odds and ends', () => {
  assert.equal(tableLine([{ userId: 'priya', name: 'Priya', points: 14 }, { userId: 'me', name: 'Me', points: 11 }, { userId: null, name: 'Sam', points: 9 }, { userId: 'jo', name: 'Jo', points: 2 }], 'me'), 'Table: Priya 14 · you 11 · Sam 9')
  assert.equal(tableLine([], 'me'), null)
  assert.equal(leagueLabel({ season: 'Season 2' }), 'LEAGUE · SEASON 2')
  assert.equal(leagueLabel(null), 'GAME')
  assert.equal(membersLine(['Priya', 'Sam', 'Alex', 'Jo']), 'Priya, Sam, Alex, Jo and you')
  assert.equal(membersLine([]), 'Just you')
  assert.equal(notificationPath('night:abc'), 'play/nights/abc')
  assert.equal(notificationPath('pod:p1'), 'pods/p1/chat')
  assert.equal(notificationPath('messages'), null)
})
