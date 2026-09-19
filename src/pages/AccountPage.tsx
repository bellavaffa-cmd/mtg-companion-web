import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { AccountPanel } from '../components/AccountPanel'
import { rise, useBack } from '../components/kit'
import { PricesPanel } from '../components/PricesPanel'

/** Account & sync — the web counterpart of the Android app's Settings → Account & sync. */
export function AccountPage() {
  const back = useBack('/')
  return (
    <>
      <TopBar title="Account & sync" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <div className="narrow-width">
          <AccountPanel />
          <PricesPanel />
          <Link to="/app" className="banner press" style={{ marginTop: 16, textDecoration: 'none' }}>
            <Icon name="android" />
            <span style={{ flex: 1 }}>Get the Android app: the same account, with notifications and offline card search.</span>
            <Icon name="chevron_right" style={{ color: 'var(--t2)' }} />
          </Link>
        </div>
      </div>
    </>
  )
}
