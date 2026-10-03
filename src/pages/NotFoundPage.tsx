import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'

/** Any address the app doesn't know — an old or mistyped link. */
export function NotFoundPage() {
  return (
    <>
      <TopBar title="Page not found" />
      <div className="content-scroll">
        <div className="empty-state">
          <Icon name="explore_off" />
          There's no page here. The link may be old or mistyped.
          <Link to="/" className="btn gold" style={{ marginTop: 16, textDecoration: 'none' }}>
            <Icon name="home" style={{ fontSize: 20, color: 'inherit' }} />Home
          </Link>
        </div>
      </div>
    </>
  )
}
