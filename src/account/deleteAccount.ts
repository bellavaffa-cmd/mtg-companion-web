// The network half of Delete my account (the rules are in accountDeletion.ts).

import { accessToken, apiHeaders, OfflineError, restUrl } from '../sync/supabaseAuth'
import { accountDeletionOutcome, avatarPaths, type AccountDeletion } from './accountDeletion'

/**
 * Removes the user's profile pictures through the Storage API (the server function can't always do
 * it from SQL). Best effort: a failure here never stops the account being deleted.
 */
async function deleteOwnAvatars(token: string, userId: string): Promise<void> {
  try {
    const listed = await fetch(restUrl('/storage/v1/object/list/avatars'), {
      method: 'POST',
      headers: apiHeaders(token),
      body: JSON.stringify({ prefix: `${userId}/`, limit: 100 }),
    })
    if (!listed.ok) return
    const paths = avatarPaths(userId, await listed.json())
    if (paths.length === 0) return
    await fetch(restUrl('/storage/v1/object/avatars'), {
      method: 'DELETE',
      headers: apiHeaders(token),
      body: JSON.stringify({ prefixes: paths }),
    })
  } catch {
    // Left for the server function's own attempt.
  }
}

/**
 * Deletes the signed-in account on the server (delete_my_account). The caller signs out afterwards
 * when this answers 'deleted'. Throws OfflineError when the server can't be reached.
 */
export async function deleteMyAccount(userId: string): Promise<AccountDeletion> {
  const token = await accessToken()
  if (!token) return 'failed'
  await deleteOwnAvatars(token, userId)
  let res: Response
  try {
    res = await fetch(restUrl('/rest/v1/rpc/delete_my_account'), {
      method: 'POST',
      headers: apiHeaders(token),
      body: '{}',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new OfflineError("You're offline — try again when you're connected. Nothing was deleted.")
  }
  const body = res.ok ? null : ((await res.json().catch(() => ({}))) as { code?: string })
  return accountDeletionOutcome(res.status, body?.code)
}
