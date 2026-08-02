import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

const TABS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/search', icon: 'search', label: 'Search', end: false },
  { to: '/collections', icon: 'collections', label: 'Collection', end: false },
  { to: '/decks', icon: 'style', label: 'Decks', end: false },
]

/** Mirrors the Android app's bottom NavigationBar. */
export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
        >
          <Icon name={tab.icon} className="nav-tab-icon" />
          <span className="nav-tab-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
