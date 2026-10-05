// A friend's loans, sent to the server so the friend sees what they've borrowed (social/api.ts,
// supabase/migrations/20261006010000_loans.sql). Best effort, always: offline, signed out, or a server
// without the loans functions yet, and nothing happens — the loans themselves are the library's
// (loans.ts) and work without it. Every call can be made again safely. The Android app does the same
// in LoanServer.kt.

import type { Loan } from '../types/models'
import { isOpen } from './storagePlaces'
import { serverCards } from './loans'
import { markLoanReturned, remindLoan, upsertLoan } from '../social/api'

/** How long after a loan came back the server is still told so (it may have missed it). */
const TELL_RETURNED_MS = 30 * 24 * 60 * 60 * 1000

/** Sends one loan as it stands: its cards still out, or that it's all back. */
export async function sendLoan(loan: Loan): Promise<boolean> {
  if (!loan.friendId) return false
  try {
    if (isOpen(loan)) await upsertLoan({ ...loan, friendId: loan.friendId }, serverCards(loan))
    else await markLoanReturned(loan.id)
    return true
  } catch {
    return false
  }
}

/** Sends every friend's loan still out, and the ones back lately — when the Loans page opens. */
export async function sendFriendLoans(loans: Loan[], now: number): Promise<void> {
  for (const loan of loans) {
    if (!loan.friendId) continue
    if (!isOpen(loan) && (loan.returnedAt ?? 0) < now - TELL_RETURNED_MS) continue
    if (!(await sendLoan(loan))) return
  }
}

/** Asks a friend for their cards back. 'sent', 'already' (one went in the last 12 hours) or 'failed'. */
export async function remindFriend(loans: Loan[]): Promise<'sent' | 'already' | 'failed'> {
  let sent = false
  let tried = false
  for (const loan of loans) {
    if (!loan.friendId || !isOpen(loan)) continue
    tried = true
    try {
      // Sent first, in case the server never had it.
      await upsertLoan({ ...loan, friendId: loan.friendId }, serverCards(loan))
      if (await remindLoan(loan.id)) sent = true
    } catch {
      return 'failed'
    }
  }
  return sent ? 'sent' : tried ? 'already' : 'failed'
}
