import { NavLink, Outlet } from 'react-router-dom'

export function Layout() {
  return (
    <div className="app-shell">
      <nav className="nav-bar">
        <div className="nav-title">MTG COMPANION</div>
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Home
        </NavLink>
        <NavLink to="/collections" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Collection
        </NavLink>
        <NavLink to="/decks" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Decks
        </NavLink>
        <NavLink to="/search" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Search
        </NavLink>
      </nav>
      <div className="main-content">
        <Outlet />
      </div>
    </div>
  )
}
