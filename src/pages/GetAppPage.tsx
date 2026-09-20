import { useEffect, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { rise, useBack, useLayoutSize } from '../components/kit'
import { QrCode } from '../social/ui'
import { publicUrl } from '../social/api'

/** The Android app's GitHub releases. "latest/download/<file>" always serves the newest release's file. */
const RELEASES = 'https://github.com/bellavaffa-cmd/mtg-companion-app/releases'
const LATEST_API = 'https://api.github.com/repos/bellavaffa-cmd/mtg-companion-app/releases/latest'
export const APK_MOST_PHONES = 'app-arm64-v8a-release.apk'
export const APK_UNIVERSAL = 'app-universal-release.apk'
export const apkUrl = (file: string) => `${RELEASES}/latest/download/${file}`

export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
export const isIos = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

interface Latest { version: string; date: string; sizes: Record<string, number> }

/** The newest release's version, date and file sizes; null until known (or if GitHub can't be reached). */
function useLatestRelease(): Latest | null {
  const [latest, setLatest] = useState<Latest | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { tag_name?: string; published_at?: string; assets?: { name: string; size: number }[] } | null) => {
        if (cancelled || !json?.tag_name) return
        setLatest({
          version: json.tag_name.replace(/^v/, ''),
          date: json.published_at ? new Date(json.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
          sizes: Object.fromEntries((json.assets ?? []).map((a) => [a.name, a.size])),
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return latest
}

const mb = (bytes: number | undefined) => (bytes ? ` · ${Math.round(bytes / 1_000_000)} MB` : '')

/** Where to get the Android app: its newest version straight from GitHub, and how to install it. */
export function GetAppPage() {
  const back = useBack('/')
  const size = useLayoutSize()
  const latest = useLatestRelease()
  const android = isAndroid()
  const ios = isIos()

  return (
    <>
      <TopBar title="Get the Android app" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width">
          <div className="link-card rise" style={rise(0)}>
            <Icon name="android" className="link-icon" />
            <h2 className="social-title">Manabind for Android</h2>
            <p className="muted">
              The same decks, binders and friends as here — sign in with the same account and they sync. Plus
              phone notifications, price alerts checked in the background, and card search that works offline.
            </p>
            {latest && <p className="dim" style={{ margin: 0 }}>Version {latest.version}{latest.date ? ` · ${latest.date}` : ''}</p>}

            {ios ? (
              <div className="notice" style={{ marginTop: 8 }}>
                There's no iPhone app. On an iPhone, use this web app — in Safari, tap <b>Share</b> then <b>Add to Home Screen</b> to keep it a tap away.
              </div>
            ) : (
              <>
                <a className="btn gold" href={apkUrl(APK_MOST_PHONES)} style={{ marginTop: 8 }}>
                  <Icon name="download" aria-hidden />Download for Android{mb(latest?.sizes[APK_MOST_PHONES])}
                </a>
                <a className="btn line sm" href={apkUrl(APK_UNIVERSAL)}>
                  Older phone, or it won't install? Universal version{mb(latest?.sizes[APK_UNIVERSAL])}
                </a>
              </>
            )}
          </div>

          {!android && !ios && size !== 'phone' && (
            <div className="panel rise get-app-qr" style={rise(1)}>
              <div className="p-h"><h3>On your phone</h3></div>
              <p className="muted" style={{ marginTop: 0 }}>Scan this with your Android phone's camera to open this page there.</p>
              <QrCode text={publicUrl('app')} size={200} label="QR code for this page" />
            </div>
          )}

          {!ios && (
            <div className="panel rise" style={{ ...rise(2), marginTop: 14 }}>
              <div className="p-h"><h3>Installing it</h3></div>
              <ol className="get-app-steps">
                <li>Tap <b>Download for Android</b>, and open the file when it's done.</li>
                <li>If your phone asks, let your browser <b>install unknown apps</b> — the app comes from GitHub, not the Play Store.</li>
                <li>Tap <b>Install</b>, then sign in with the same account you use here.</li>
              </ol>
              <p className="dim" style={{ marginBottom: 0 }}>
                The app checks for new versions when it opens and offers to update itself. Every version is on the{' '}
                <a href={RELEASES} target="_blank" rel="noreferrer">releases page</a>.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
