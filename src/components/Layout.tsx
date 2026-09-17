import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'

// Matches the Android app's bottomNavRoutes — hidden on pushed detail screens (their own back
// button takes over instead), shown on the top-level tabs.
export const TAB_ROUTES = new Set(['/', '/collections', '/decks', '/search'])

export function Layout() {
  const location = useLocation()
  const showBottomNav = TAB_ROUTES.has(location.pathname)

  // Each screen starts at the top, like a new screen in the app.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="phone-shell">
      <div className="phone-frame">
        <Outlet />
        {showBottomNav && <BottomNav />}
      </div>
    </div>
  )
}
