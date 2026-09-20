import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { BottomNav, NAV_TABS } from './BottomNav'
import { Icon } from './Icon'
import { ArtImage, toArtCrop, useLayoutSize } from './kit'
import { useSync } from '../sync/SyncContext'
import { useDeckColors } from './useDeckColors'
import { PullToSync } from './PullToSync'
import { SyncButton } from './SyncButton'
import { useSocial } from '../social/SocialContext'

// Matches the Android app's bottomNavRoutes — on a phone the bar hides on pushed detail screens
// (their own back button takes over). Tablet and desktop keep their rail/sidebar everywhere.
export const TAB_ROUTES = new Set(['/', '/collections', '/decks', '/search'])

export const LAST_DECK_KEY = 'mtgweb_last_deck'

export function Layout() {
  const location = useLocation()
  const size = useLayoutSize()

  // Each screen starts at the top, like a new screen in the app.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    document.documentElement.dataset.layout = size
  }, [size])

  if (size === 'phone') {
    return (
      <div className="phone-shell">
        <div className="phone-frame">
          <Outlet />
          {TAB_ROUTES.has(location.pathname) && <BottomNav />}
        </div>
        <PullToSync />
      </div>
    )
  }

  return (
    <div className={`wide-shell ${size}`}>
      {size === 'desktop' ? <Sidebar /> : <NavRail />}
      <div className="wide-main">
        <Outlet />
      </div>
      <PullToSync />
    </div>
  )
}

function AccountStatus({ compact }: { compact?: boolean }) {
  const { account, accountsAvailable, cloud } = useSync()
  if (!accountsAvailable) return null
  const initial = account ? account.email.slice(0, 1).toUpperCase() : null
  if (compact) {
    return (
      <>
        <SyncButton />
        <NavLink to="/account" className="rail-account" aria-label="Account & sync" title={account ? account.email : 'Sign in'}>
          {initial ? <span className="avatar sm">{initial}</span> : <Icon name="account_circle" style={{ fontSize: 30 }} />}
        </NavLink>
      </>
    )
  }
  return (
    <div className="side-account-row">
    <NavLink to="/account" className="side-account">
      {initial ? <span className="avatar sm">{initial}</span> : <span className="avatar sm"><Icon name="person" style={{ fontSize: 20 }} /></span>}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="side-account-name">{account ? account.email : 'Sign in'}</span>
        <span className={`side-account-status${account && !cloud.failed ? ' ok' : ''}`}>
          <Icon name={!account ? 'sync' : cloud.syncing ? 'sync' : cloud.failed ? 'cloud_off' : 'cloud_done'} style={{ fontSize: 15 }} />
          {!account ? 'Not syncing — sign in' : cloud.syncing ? 'Syncing…' : cloud.failed ? 'Not synced' : 'Synced'}
        </span>
      </span>
    </NavLink>
    <SyncButton />
    </div>
  )
}

/** How many friend requests and trades are waiting on the user. */
export function InboxBadge({ dot }: { dot?: boolean }) {
  const { inbox } = useSocial()
  const n = inbox.friend_requests + inbox.trades
  if (n === 0) return null
  return <span className={dot ? 'inbox-dot' : 'count-badge'} aria-label={`${n} waiting`}>{dot ? '' : n}</span>
}

function Sidebar() {
  const { decks } = useSync()
  const location = useLocation()
  const lastId = localStorage.getItem(LAST_DECK_KEY)
  const recent = [...decks].sort((a, b) => Number(b.id === lastId) - Number(a.id === lastId)).slice(0, 6)
  const colors = useDeckColors(recent)

  return (
    <nav className="sidebar" aria-label="Main">
      <NavLink to="/" className="side-logo">
        <span className="mark">M</span>
        <span>Manabind</span>
      </NavLink>
      {NAV_TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `side-nav${isActive ? ' active' : ''}`}>
          <Icon name={tab.icon} />
          {tab.label}
        </NavLink>
      ))}
      <NavLink to="/scan" className={({ isActive }) => `side-nav${isActive ? ' active' : ''}`}>
        <Icon name="photo_camera" />
        Scan cards
      </NavLink>
      <NavLink to="/life" className="side-nav">
        <Icon name="favorite" />
        Life counter
      </NavLink>
      <NavLink to="/rules" className={({ isActive }) => `side-nav${isActive ? ' active' : ''}`}>
        <Icon name="gavel" />
        Rules
      </NavLink>
      <NavLink to="/friends" className={({ isActive }) => `side-nav${isActive ? ' active' : ''}`}>
        <Icon name="group" />
        Friends
        <InboxBadge />
      </NavLink>
      {recent.length > 0 && (
        <>
          <div className="side-sec">
            <span>Recent decks</span>
            <NavLink to="/decks?new=1" aria-label="New deck" title="New deck"><Icon name="add" style={{ fontSize: 18 }} /></NavLink>
          </div>
          {recent.map((deck) => (
            <NavLink
              key={deck.id}
              to={`/decks/${deck.id}`}
              className={`side-deck${location.pathname === `/decks/${deck.id}` ? ' active' : ''}`}
            >
              <ArtImage className="side-deck-art" src={toArtCrop(deck.commander?.imageUrl)} seed={deck.name} colors={colors[deck.id]} />
              <span className="side-deck-name">{deck.name}</span>
            </NavLink>
          ))}
        </>
      )}
      <div style={{ flex: 1 }} />
      <NavLink to="/app" className={({ isActive }) => `side-nav${isActive ? ' active' : ''}`}>
        <Icon name="android" />
        Get the Android app
      </NavLink>
      <AccountStatus />
    </nav>
  )
}

function NavRail() {
  return (
    <nav className="navrail" aria-label="Main">
      <NavLink to="/" className="mark" aria-label="Home">M</NavLink>
      {NAV_TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <span className="pill"><Icon name={tab.icon} /></span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
      <NavLink to="/scan" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        <span className="pill"><Icon name="photo_camera" /></span>
        <span>Scan</span>
      </NavLink>
      <NavLink to="/life" className="nav-tab">
        <span className="pill"><Icon name="favorite" /></span>
        <span>Life</span>
      </NavLink>
      <NavLink to="/rules" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        <span className="pill"><Icon name="gavel" /></span>
        <span>Rules</span>
      </NavLink>
      <NavLink to="/friends" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        <span className="pill"><Icon name="group" /><InboxBadge dot /></span>
        <span>Friends</span>
      </NavLink>
      <div style={{ flex: 1 }} />
      <NavLink to="/app" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
        <span className="pill"><Icon name="android" /></span>
        <span>App</span>
      </NavLink>
      <AccountStatus compact />
    </nav>
  )
}
