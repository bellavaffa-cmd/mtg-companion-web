import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'

// Matches the Android app's bottomNavRoutes — hidden on pushed detail screens (their own back
// button takes over instead), shown on the 4 top-level tabs.
const TAB_ROUTES = new Set(['/', '/collections', '/decks', '/search'])

export function Layout() {
  const location = useLocation()
  const showBottomNav = TAB_ROUTES.has(location.pathname)

  return (
    <div className="phone-shell">
      <div className="phone-frame">
        <Outlet />
        {showBottomNav && <BottomNav />}
      </div>
    </div>
  )
}
