import { TopBar } from '../components/TopBar'
import { AccountPanel } from '../components/AccountPanel'
import { rise, useBack } from '../components/kit'

/** Account & sync — the web counterpart of the Android app's Settings → Account & sync. */
export function AccountPage() {
  const back = useBack('/')
  return (
    <>
      <TopBar title="Account & sync" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <AccountPanel />
      </div>
    </>
  )
}
