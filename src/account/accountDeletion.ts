// Delete my account: what the server's answer means, and which profile pictures go with it. No
// network here, so it can be tested. The Android twin is data/supabase/AccountDeletion.kt
// (AccountDeletionTest.kt ↔ tests/account/accountDeletion.test.ts); the server side is
// public.delete_my_account() in the Android repo's supabase/migrations/20261006040000_delete_account.sql.

import { isMissingFunction } from '../social/moreLogic'

/**
 * deleted: the account and everything the server held for it are gone.
 * unavailable: the server doesn't have delete_my_account yet (its migration not run) — nothing deleted.
 * failed: the server refused or failed — nothing should be assumed deleted.
 */
export type AccountDeletion = 'deleted' | 'unavailable' | 'failed'

export function accountDeletionOutcome(status: number, code: string | null | undefined): AccountDeletion {
  if (status >= 200 && status < 300) return 'deleted'
  if (isMissingFunction(status, code)) return 'unavailable'
  return 'failed'
}

/** The object paths to remove from the avatars bucket, from a Storage list of the user's folder. */
export function avatarPaths(userId: string, list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { name, id } = item as { name?: unknown; id?: unknown }
    // Folders come back with a null id; there are none under a user's folder, but skip them anyway.
    if (id === null || id === undefined) return []
    return typeof name === 'string' && name !== '' && !name.includes('/') ? [`${userId}/${name}`] : []
  })
}
