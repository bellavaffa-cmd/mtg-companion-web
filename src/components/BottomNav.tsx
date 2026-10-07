import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { useSocial } from '../social/SocialContext'
import { badgeText, friendsBadge } from '../social/friendsHub'

/**
 * The Android app's bottom bar, in its order: Home, Search, Play | Decks, Collection, Friends (the
 * app's Scan sits in the middle; here the sidebar and rail have it, after Play — see Layout.tsx).
 */
export const NAV_TABS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search', end: false },
  { to: '/play', icon: 'favorite', label: 'Play', end: false },
  { to: '/decks', icon: 'style', label: 'Decks', end: false },
  { to: '/collections', icon: 'collections', label: 'Collection', end: false },
  { to: '/friends', icon: 'group', label: 'Friends', end: false },
]

/** The Friends tab's badge: friend requests, trades waiting on the user and unread messages. */
export function useFriendsBadge(): number {
  const { inbox, unread } = useSocial()
  return friendsBadge(inbox.friend_requests, unread, inbox.trades)
}

/** The gold count on Friends, wherever it's linked from the navigation. */
export function FriendsBadge({ dot }: { dot?: boolean }) {
  const n = useFriendsBadge()
  if (n === 0) return null
  return <span className={dot ? 'inbox-dot' : 'count-badge'} role="img" aria-label={`${n} waiting`}>{dot ? '' : badgeText(n)}</span>
}

/**
 * The Android app's floating bottom bar (minus Scan, which needs the phone's camera), in its order:
 * Home, Search, Play, Decks, Collection, Friends. Phone layout only; at 360px each tab is still
 * 48px wide, and a label that doesn't fit shortens.
 */
export function BottomNav() {
  return (
    <nav className="tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${NAV_TABS.length}, minmax(0, 1fr))` }}>
      {NAV_TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <span className="pill">
            <Icon name={tab.icon} />
            {tab.to === '/friends' && <FriendsBadge />}
          </span>
          <span className="nav-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
