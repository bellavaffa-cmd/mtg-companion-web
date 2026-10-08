// The friends' Activity feed, its privacy switches and comments on shared decks
// (src/social/activityLogic.ts). The Android app runs the same cases in ActivityCommentsLogicTest.kt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  askCards, commentActions, commentCount, commentHeader, commentsNote, commentsPath, commentsTabLabel, composerPlaceholder, cut, DEFAULT_ACTIVITY_PREFS,
  feedDeck, feedLine, leagueText, offerCard, parsePrefs, sellingAsk, swapReply, threadComments, mergeFeeds, GOAL_PREF_ROW, ACTIVITY_PREF_ROWS,
  type DeckComment, type FeedItem, type FeedLine, type LeagueSnapshot, type SellingCard,
} from '../../src/social/activityLogic.ts'
import type { ForTradeCard } from '../../src/social/more.ts'
import type { Collection } from '../../src/types/models.ts'

const priya = { user_id: 'p', username: 'priya', display_name: 'Priya' }
const sam = { user_id: 's', username: 'sam', display_name: 'Sam' }
const item = (kind: string, extra: Partial<FeedItem> = {}): FeedItem => ({ kind, actor: priya, at: 1000, ...extra })
const text = (l: FeedLine) => l.parts.map((p) => (p.bold ? `*${p.text}*` : p.text)).join('')

test('privacy defaults: decks, trade and leagues on, selling off', () => {
  assert.deepEqual(DEFAULT_ACTIVITY_PREFS, { decks: true, for_trade: true, selling: false, leagues: true })
  assert.deepEqual(parsePrefs(null), DEFAULT_ACTIVITY_PREFS)
  assert.deepEqual(parsePrefs({ decks: false, selling: true, leagues: 'yes' }), { decks: false, for_trade: true, selling: true, leagues: true })
})

test('a card on the user wishlist marked for trade asks for it', () => {
  const one = feedLine(item('for_trade', { count: 3, cards: [{ name: 'Rhystic Study' }], wanted: ['Rhystic Study'] }))
  assert.equal(text(one), '*Priya* added *Rhystic Study* to their trade binder')
  assert.equal(one.sub, "It's on your wishlist")
  assert.deepEqual(one.action, { label: 'Ask Priya for it', kind: 'ask' })
  const two = feedLine(item('for_trade', { wanted: ['Rhystic Study', 'Sol Ring'] }))
  assert.equal(text(two), '*Priya* added *Rhystic Study and Sol Ring* to their trade binder')
  assert.equal(two.sub, "They're on your wishlist")
  assert.equal(two.action?.label, 'Ask Priya for them')
  const none = feedLine(item('for_trade', { count: 3, cards: [{ name: 'Ponder' }, { name: 'Brainstorm' }], wanted: [] }))
  assert.equal(text(none), '*Priya* marked 3 cards for trade')
  assert.equal(none.sub, 'Ponder, Brainstorm and 1 more')
  assert.equal(none.action, null)
})

test('a new or shared deck opens its comments', () => {
  const built = feedLine(item('shared', { item_kind: 'deck', item_id: 'd1', name: 'Meren of Clan Nel Toth', new_deck: true }))
  assert.equal(text(built), '*Priya* built a new deck: *Meren of Clan Nel Toth*')
  assert.equal(built.sub, 'Shared with friends')
  assert.deepEqual(built.action, { label: 'Look and comment', kind: 'comments' })
  assert.equal(text(feedLine(item('shared', { item_kind: 'deck', item_id: 'd1', name: 'Meren' }))), '*Priya* shared a deck: *Meren*')
  assert.equal(text(feedLine(item('shared', { item_kind: 'deck' }))), '*Priya* shared all their decks')
  assert.equal(feedLine(item('shared', { item_kind: 'collection', item_id: 'b', name: 'Trade binder' })).action, null)
  assert.equal(text(feedLine(item('deck_updated', { item_kind: 'deck', item_id: 'd1', name: 'Meren' }))), '*Priya* updated a deck: *Meren*')
  assert.deepEqual(feedDeck(item('shared', { item_kind: 'deck', item_id: 'd1' })), { owner: 'p', deckId: 'd1' })
  assert.equal(feedDeck(item('shared', { item_kind: 'collection', item_id: 'b' })), null)
  assert.equal(commentsPath('p', 'd 1'), '/shared/p/deck/d%201?tab=comments')
})

test('selling says how many are on the wishlist', () => {
  const l = feedLine(item('selling', { actor: { ...priya, display_name: 'Jo' }, count: 12, wanted_count: 2, wanted: ['A', 'B'] }))
  assert.equal(text(l), '*Jo* is selling 12 cards')
  assert.equal(l.sub, '2 are on your wishlist')
  assert.deepEqual(l.action, { label: 'See them', kind: 'selling' })
  assert.equal(feedLine(item('selling', { count: 1, wanted_count: 1 })).sub, '1 is on your wishlist')
  assert.equal(feedLine(item('selling', { count: 1, wanted_count: 0 })).sub, null)
})

const table = (rows: [string | null, string, number, number][], nights = 3): LeagueSnapshot => ({
  standings: rows.map(([userId, name, points, rank]) => ({ userId, name, points, rank })),
  nights,
})

test('league news names the leader, unless they keep it quiet', () => {
  const season = item('league', { actor: null, pod_name: 'Thursday crew', name: 'Season 2', season_id: 's2', ended: false, max_nights: 5, quiet: [] })
  const t = table([['p', 'Priya', 12, 1], ['s', 'Sam', 9, 2]])
  const l = feedLine(season, t)
  assert.equal(text(l), '*Thursday crew*: Priya leads Season 2 by 3 points')
  assert.equal(l.sub, '2 game nights left')
  assert.equal(leagueText(season, table([['p', 'Priya', 10, 1], ['s', 'Sam', 9, 2]], 4)).text, 'Priya leads Season 2 by 1 point')
  assert.equal(leagueText(season, table([['p', 'Priya', 10, 1], ['s', 'Sam', 9, 2]], 4)).sub, '1 game night left')
  assert.equal(leagueText(season, table([['p', 'Priya', 10, 1], ['s', 'Sam', 9, 2]], 5)).sub, null)
  assert.equal(leagueText(season, table([['p', 'Priya', 10, 1], ['s', 'Sam', 10, 2]])).text, 'Priya leads Season 2')
  assert.equal(leagueText(season, table([['p', 'Priya', 10, 1]])).text, 'Priya leads Season 2')
  assert.equal(leagueText(season, table([['p', 'Priya', 10, 1], ['s', 'Sam', 10, 1]])).text, 'Priya and Sam share the lead in Season 2')
  assert.equal(leagueText(season, table([['p', 'A', 10, 1], ['s', 'B', 10, 1], [null, 'C', 10, 1]])).text, '3 players share the lead in Season 2')
  assert.equal(leagueText(season, table([], 0)).text, 'Season 2 has started')
  assert.equal(leagueText(season, null).text, 'New results in Season 2')
  assert.equal(leagueText({ ...season, quiet: ['p'] }, t).text, 'New results in Season 2')
  assert.equal(leagueText({ ...season, quiet: ['s'] }, t).text, 'Priya leads Season 2 by 3 points')
})

test('a season over names its champion, unless they keep it quiet', () => {
  const over = item('league', { actor: null, pod_name: 'Thursday crew', name: 'Season 1', ended: true, champion: 'Priya', champion_ids: ['p'], quiet: [] })
  assert.equal(text(feedLine(over)), '*Thursday crew*: Season 1 champion: Priya')
  assert.equal(leagueText({ ...over, champion: 'Priya & Sam', champion_ids: ['p', 's'] }, null).text, 'Season 1 champions: Priya & Sam')
  assert.equal(leagueText({ ...over, quiet: ['p'] }, null).text, 'Season 1 is over')
  assert.equal(leagueText({ ...over, champion: null }, null).text, 'Season 1 is over')
})

test('comments on the user decks, and replies to theirs', () => {
  const onCard = feedLine(item('comment', { item_kind: 'deck', item_id: 'd1', name: 'Meren', item_owner: 'me', on_mine: true, card_name: 'Gray Merchant of Asphodel', body: 'Cut this?' }))
  assert.equal(text(onCard), '*Priya* commented on *Gray Merchant of Asphodel* in *Meren*')
  assert.equal(onCard.sub, '“Cut this?”')
  assert.deepEqual(onCard.action, { label: 'Reply', kind: 'comments' })
  assert.equal(text(feedLine(item('comment', { name: 'Meren', on_mine: true }))), '*Priya* commented on *Meren*')
  assert.equal(text(feedLine(item('comment', { name: 'Meren', on_mine: true, reply: true }))), '*Priya* replied on *Meren*')
  assert.equal(text(feedLine(item('comment', { name: 'Meren', on_mine: false, reply: true }))), '*Priya* replied to your comment on *Meren*')
  assert.deepEqual(feedDeck(item('comment', { item_kind: 'deck', item_id: 'd1', item_owner: 'me' })), { owner: 'me', deckId: 'd1' })
  assert.equal(cut('a  b\n c', 10), 'a b c')
  assert.equal(cut('abcdefghij', 5), 'abcd…')
})

test('the older feed items still read', () => {
  assert.equal(text(feedLine(item('pod_game', { pod_name: 'Thursday crew', winner: 'Sam', players: 4 }))), '*Priya* recorded a game in *Thursday crew*')
  assert.equal(feedLine(item('pod_game', { players: 4 })).sub, 'No winner · 4 players')
  assert.equal(text(feedLine(item('mystery'))), '*Priya* did something new')
})

const ft = (name: string, quantity = 1, id = name): ForTradeCard => ({ item_id: 'b1', item_name: 'Trades', scryfall_id: id, name, image_url: null, for_trade: 1, quantity, foil_quantity: quantity ? 0 : 1 })

test('asking for wanted cards takes one copy of each', () => {
  const cards = askCards([ft('Rhystic Study'), ft('rhystic study', 1, 'x'), ft('Ponder'), ft('Sol Ring', 0)], ['Rhystic Study', 'Sol Ring', 'Mana Crypt'])
  assert.deepEqual(cards.map((c) => [c.name, c.quantity, c.foil, c.collectionId]), [['Rhystic Study', 1, false, 'b1'], ['Sol Ring', 1, true, 'b1']])
  const sell = (name: string, wanted: boolean): SellingCard => ({ item_id: 'b', scryfall_id: name, name, for_sale: 2, quantity: 2, foil_quantity: 0, wanted })
  assert.deepEqual(sellingAsk([sell('A', true), sell('B', false), sell('A', true)]).map((c) => c.name), ['A'])
})

const comment = (id: string, author = priya, extra: Partial<DeckComment> = {}): DeckComment =>
  ({ id, parent: null, author, body: 'hi', card_name: null, card_image: null, hidden: false, created_at: Number(id.replace(/\D/g, '')) || 0, mine: false, ...extra })

test('comments thread one level deep, oldest first', () => {
  const list = [
    comment('c3', sam, { parent: 'c1' }),
    comment('c2'),
    comment('c1'),
    comment('c4', priya, { parent: 'c9' }), // its comment is gone
    comment('c5', sam, { parent: 'c3' }), // a reply to a reply
  ]
  const threads = threadComments(list)
  assert.deepEqual(threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)]), [['c1', ['c3']], ['c2', []]])
  assert.equal(commentCount(threads), 3)
  assert.equal(commentsTabLabel(3), 'Comments · 3')
  assert.equal(commentsTabLabel(0), 'Comments')
})

test('comment headers say who and what about', () => {
  const deck = ['Gray Merchant of Asphodel', 'Sol Ring']
  assert.equal(commentHeader(comment('c1', priya, { card_name: 'Gray Merchant of Asphodel' }), 'me', 's', deck), 'Priya · on Gray Merchant of Asphodel')
  assert.equal(commentHeader(comment('c2', sam, { parent: 'c1' }), 'me', 's', deck), 'Sam · owner')
  assert.equal(commentHeader(comment('c3', { ...priya, user_id: 'me' }), 'me', 's', deck), 'You · on the deck')
  assert.equal(commentHeader(comment('c4', priya, { card_name: 'Skullclamp' }), 'me', 's', deck), 'Priya · on the deck · suggests Skullclamp')
  assert.equal(commentHeader(comment('c5', sam), 's', 's', deck), 'You · on the deck')
  assert.equal(commentHeader(comment('c6', priya, { hidden: true }), 's', 's', deck), 'Priya · on the deck · hidden')
})

test('who may do what with a comment', () => {
  const deck = ['Gray Merchant of Asphodel']
  const onCard = comment('c1', priya, { card_name: 'Gray Merchant of Asphodel' })
  const suggest = comment('c2', { ...priya, user_id: 'me' }, { card_name: 'Skullclamp' })
  const base = { owner: 's', canComment: true, deckCards: deck, haveCard: false }
  // A friend looking at Priya's comment on a card in the deck.
  assert.deepEqual(commentActions(onCard, { ...base, me: 'me' }), { reply: true, swap: true, offer: false, remove: false, hide: false, report: true })
  // The owner on the same comment: may hide and delete it.
  assert.deepEqual(commentActions(onCard, { ...base, me: 's' }), { reply: true, swap: true, offer: false, remove: true, hide: true, report: true })
  // The user's own suggestion of a card they have: offer it, delete it.
  assert.deepEqual(commentActions(suggest, { ...base, me: 'me', haveCard: true }), { reply: true, swap: false, offer: true, remove: true, hide: false, report: false })
  assert.equal(commentActions(suggest, { ...base, me: 'me', haveCard: false }).offer, false)
  assert.equal(commentActions(suggest, { ...base, me: 's', haveCard: true }).offer, false)
  // A reply: no replying to it, no swap.
  const reply = comment('c3', sam, { parent: 'c1', card_name: 'Gray Merchant of Asphodel' })
  assert.deepEqual(commentActions(reply, { ...base, me: 'me' }), { reply: false, swap: false, offer: false, remove: false, hide: false, report: true })
  // Someone who can't comment (a pod-mate who isn't a friend) only reads and reports.
  assert.deepEqual(commentActions(onCard, { ...base, me: 'x', canComment: false }), { reply: false, swap: false, offer: false, remove: false, hide: false, report: true })
  // The owner's own comment: delete, not hide or report.
  assert.deepEqual(commentActions(comment('c4', sam), { ...base, me: 's' }), { reply: true, swap: false, offer: false, remove: true, hide: false, report: false })
})

test('comment wording', () => {
  assert.equal(swapReply('Gray Merchant of Asphodel'), 'Instead of Gray Merchant of Asphodel: ')
  assert.equal(composerPlaceholder('Sam', false, null), "Comment on Sam's deck")
  assert.equal(composerPlaceholder('Sam', true, null), 'Comment on your deck')
  assert.equal(composerPlaceholder('Sam', false, 'Priya'), 'Reply to Priya')
  assert.equal(commentsNote('Sam', false), 'Only friends Sam shares the deck with can comment. Sam can hide or delete comments.')
  assert.equal(commentsNote('Sam', true), 'Only friends you share the deck with can comment. You can hide or delete comments.')
})

test('offering a card takes one copy, marked for trade first', () => {
  const binder = (id: string, entries: Collection['entries'], type: Collection['type'] = 'OWNED'): Collection => ({ id, name: id, entries, createdAt: 0, type })
  const e = (name: string, quantity: number, foilQuantity: number, forTrade?: number) =>
    ({ scryfallId: `${name}-${quantity}-${foilQuantity}`, name, imageUrl: null, quantity, foilQuantity, ...(forTrade ? { forTrade } : {}) })
  const cols = [
    binder('wish', [e('Skullclamp', 4, 0)], 'WISHLIST'),
    binder('a', [e('Skullclamp', 3, 0)]),
    binder('b', [e('skullclamp', 1, 0, 1)]),
    binder('c', [e('Sol Ring', 0, 1)]),
  ]
  const card = offerCard(cols, 'Skullclamp')
  assert.equal(card?.collectionId, 'b')
  assert.equal(card?.quantity, 1)
  assert.equal(offerCard(cols.slice(0, 2), 'Skullclamp')?.collectionId, 'a')
  assert.equal(offerCard(cols, 'Sol Ring')?.foil, true)
  assert.equal(offerCard(cols, 'Mana Crypt'), null)
  assert.equal(offerCard([binder('wish', [e('Skullclamp', 4, 0)], 'WISHLIST')], 'Skullclamp'), null)
})

// ---- Completed goals (20261008110000_goal_activity.sql) ----

test('a completed goal: who, which goal, its kind and cards, no action', () => {
  const done = feedLine(item('goal_completed', { item_id: 'g1', name: 'Duskmourn uncommons', goal_kind: 'SET', count: 92 }))
  assert.equal(text(done), '*Priya* completed a goal: *Duskmourn uncommons*')
  assert.equal(done.sub, 'Set goal · 92 cards')
  assert.equal(done.action, null)
  assert.equal(feedLine(item('goal_completed', { name: 'Shock lands', goal_kind: 'PLAYSET', count: 1 })).sub, 'Playset goal · 1 card')
  assert.equal(feedLine(item('goal_completed', { name: 'x' })).sub, 'Card list goal')
  assert.equal(feedLine(item('goal_completed', { name: 'Foil Krenko', goal_kind: 'DECK', count: 60 })).sub, 'Deck goal · 60 cards')
})

test('completed goals are read beside the feed and merged newest first', () => {
  const goals = [item('goal_completed', { at: 1500, item_id: 'g1', name: 'Duskmourn uncommons', goal_kind: 'SET', count: 92 })]
  const main = [item('deck_updated', { at: 2000 }), item('selling', { at: 1000 }), item('for_trade', { at: 500 })]
  assert.deepEqual(mergeFeeds(main, goals, 3).map((i) => i.at), [2000, 1500, 1000])
  assert.deepEqual(mergeFeeds(main, goals, 30).map((i) => i.kind), ['deck_updated', 'goal_completed', 'selling', 'for_trade'])
  // No goals (an older server): the page as it came.
  assert.equal(mergeFeeds(main, [], 2), main)
})

test('share completed goals: its own switch, after the four', () => {
  assert.equal(GOAL_PREF_ROW.key, 'goals')
  assert.equal(GOAL_PREF_ROW.title, 'Share completed goals')
  assert.deepEqual(ACTIVITY_PREF_ROWS.map((r) => r.key), ['decks', 'for_trade', 'selling', 'leagues'])
})
