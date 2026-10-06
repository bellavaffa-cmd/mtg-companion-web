// Invitations to share storage at home, with Decline and Accept: on the Household page and on Friends.

import { useState } from 'react'
import { Avatar } from './ui'
import { householdError, respondHousehold } from './household'
import type { HouseholdInvite } from './householdLogic'

/** Invitations to share storage, with Decline and Accept — on this page and on Friends. */
export function HouseholdInvites({ invites, onDone }: { invites: HouseholdInvite[]; onDone: (accepted: string | null) => unknown }) {
  const [error, setError] = useState<string | null>(null)
  const answer = async (inv: HouseholdInvite, yes: boolean) => {
    setError(null)
    try {
      await respondHousehold(inv.id, yes)
      await onDone(yes ? inv.id : null)
    } catch (e) {
      setError(householdError(e))
    }
  }
  if (invites.length === 0) return null
  return (
    <div className="list">
      {invites.map((inv) => (
        <div key={inv.id} className="person-row">
          <Avatar profile={inv.invitedBy} size={44} />
          <span className="person-main">
            <span className="person-name">{inv.invitedBy?.display_name ?? 'Someone'} asked you to share storage at home</span>
            <span className="dim">{inv.name} · each of you still owns your own cards</span>
          </span>
          <button type="button" className="btn line sm" onClick={() => void answer(inv, false)}>Decline</button>
          <button type="button" className="btn gold sm" onClick={() => void answer(inv, true)}>Accept</button>
        </div>
      ))}
      {error && <div className="hh-error">{error}</div>}
    </div>
  )
}
