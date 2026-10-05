import { useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { TopBar } from '../components/TopBar'
import { rise, useBack } from '../components/kit'
import { currentAccount, saveCommunityRulesVersion } from '../sync/supabaseAuth'
import {
  COMMUNITY_RULES,
  COMMUNITY_RULES_ENFORCEMENT,
  COMMUNITY_RULES_REPORTING,
  COMMUNITY_RULES_VERSION,
  communityRules,
} from './communityRules'

/** The community rules store, re-rendering when it changes. Posting code calls `communityRules.require(post)` directly. */
function useCommunityRules() {
  useSyncExternalStore(communityRules.subscribe, communityRules.getState)
  return communityRules
}

function RulesList() {
  return (
    <ul className="community-rules">
      {COMMUNITY_RULES.map((r) => (
        <li key={r.title}><strong>{r.title}.</strong> {r.detail}</li>
      ))}
    </ul>
  )
}

/**
 * The one-time community rules dialog, shown whenever communityRules.require() or show() asks for
 * it. Lives once in App. Agree remembers it in this browser and, signed in, on the account; then
 * whatever was waiting (saving a profile, sending a message…) goes ahead. Mirrors the Android
 * app's CommunityRulesHost.
 */
export function CommunityRulesHost() {
  const state = useSyncExternalStore(communityRules.subscribe, communityRules.getState)
  if (!state.pending) return null
  const alreadyAgreed = state.deviceVersion >= COMMUNITY_RULES_VERSION
  const agree = () => {
    const action = communityRules.agree()
    if (currentAccount()) void saveCommunityRulesVersion(COMMUNITY_RULES_VERSION).catch(() => {})
    action?.()
  }
  return (
    <Dialog
      title="Community rules"
      onDismiss={() => communityRules.dismiss()}
      actions={alreadyAgreed
        ? <button type="button" className="btn gold" onClick={() => communityRules.dismiss()}>Close</button>
        : <>
            <button type="button" className="btn line" onClick={() => communityRules.dismiss()}>Not now</button>
            <button type="button" className="btn gold" onClick={agree}>Agree</button>
          </>}
    >
      <p className="dim">Your profile, messages, trades and what you share are seen by other players. Keep it friendly:</p>
      <RulesList />
      <p>{COMMUNITY_RULES_ENFORCEMENT}</p>
      <p className="dim">{COMMUNITY_RULES_REPORTING}</p>
      <p><Link to="/community-rules" onClick={() => communityRules.dismiss()}>Read the full rules</Link></p>
    </Dialog>
  )
}

/** manabind.com/community-rules: the public page the apps link to (and Google Play can read). */
export function CommunityRulesPage() {
  const back = useBack('/settings')
  const rules = useCommunityRules()
  const agreed = rules.agreed()
  return (
    <>
      <TopBar title="Community rules" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <article className="narrow-width prose-page">
          <p className="dim">
            These apply to everything other people can see in Manabind and on manabind.com: your username, display name and
            profile picture, messages, trades and trade messages, and the decks and binders you share.
          </p>
          <h2>The rules</h2>
          <RulesList />
          <h2>What happens if they're broken</h2>
          <p>{COMMUNITY_RULES_ENFORCEMENT} We may also remove a profile picture or name that breaks them without notice.</p>
          <h2>Reporting and blocking</h2>
          <p>{COMMUNITY_RULES_REPORTING}</p>
          <p>
            How we handle what you report is covered by the <Link to="/privacy">privacy policy</Link>.
          </p>
          {!agreed && (
            <p>
              <button type="button" className="btn gold" onClick={() => rules.show()}>Agree to the rules</button>
            </p>
          )}
        </article>
      </div>
    </>
  )
}
