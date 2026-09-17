import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

const TABS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search', end: false },
  { to: '/decks', icon: 'style', label: 'Decks', end: false },
  { to: '/collections', icon: 'collections', label: 'Collection', end: false },
]

/** The Android app's floating bottom bar (minus Scan, which needs the phone's camera). */
export function BottomNav() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <span className="pill"><Icon name={tab.icon} /></span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
