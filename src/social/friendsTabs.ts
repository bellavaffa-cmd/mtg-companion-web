// The Friends page's tabs: People, Messages, Trades and Activity — Messages and Activity only when
// the server has the social_more functions. Which tab a link (?tab=…) or a tapped notification
// ("friends" / "trades" / "messages") opens, and the counts on each. Pure, so it's tested. The
// Android app's twin is data/social/FriendsTabs.kt (tests: FriendsTabsTest.kt /
// tests/social/friendsTabs.test.ts).

export type FriendsTab = 'people' | 'messages' | 'trades' | 'activity'

export const FRIENDS_TAB_LABELS: Record<FriendsTab, string> = {
  people: 'People',
  messages: 'Messages',
  trades: 'Trades',
  activity: 'Activity',
}

/** The tabs shown: all four with social_more ([more] true), else People and Trades. */
export const friendsTabs = (more: boolean | null | undefined): FriendsTab[] =>
  more ? ['people', 'messages', 'trades', 'activity'] : ['people', 'trades']

/**
 * The tab a link or notification asks for, among those shown. Anything else — no tab, "friends",
 * "requests", or Messages/Activity without social_more — is People.
 */
export function friendsTabFor(asked: string | null | undefined, more: boolean | null | undefined): FriendsTab {
  const tab = asked === 'trades' || asked === 'messages' || asked === 'activity' ? asked : 'people'
  return friendsTabs(more).includes(tab) ? tab : 'people'
}

/** What waits on each tab: friend requests on People, unread messages, trades waiting on the user. */
export interface FriendsWaiting { requests: number; unread: number; trades: number }

/** The badge counts for [tabs], by position; tabs with nothing waiting have none. */
export function friendsTabCounts(tabs: FriendsTab[], waiting: FriendsWaiting): Record<number, number> {
  const counts: Record<number, number> = {}
  tabs.forEach((tab, i) => {
    const n = tab === 'people' ? waiting.requests : tab === 'messages' ? waiting.unread : tab === 'trades' ? waiting.trades : 0
    if (n > 0) counts[i] = n
  })
  return counts
}

/** The address of a tab: People is plain /friends. */
export const friendsTabPath = (tab: FriendsTab) => (tab === 'people' ? '/friends' : `/friends?tab=${tab}`)
