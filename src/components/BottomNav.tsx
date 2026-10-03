import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

/**
 * The Android app's bottom bar, in its order. Play (the life counter, joining a table, recent games)
 * sits further down the sidebar and rail, as it does there — see MAIN_TABS.
 */
export const NAV_TABS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search', end: false },
  { to: '/play', icon: 'favorite', label: 'Play', end: false },
  { to: '/decks', icon: 'style', label: 'Decks', end: false },
  { to: '/collections', icon: 'collections', label: 'Collection', end: false },
]

/**
 * The Android app's floating bottom bar (minus Scan, which needs the phone's camera), in its order:
 * Home, Search, Play, Decks, Collection. Phone layout only.
 */
export function BottomNav() {
  return (
    <nav className="tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${NAV_TABS.length}, 1fr)` }}>
      {NAV_TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <span className="pill"><Icon name={tab.icon} /></span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
