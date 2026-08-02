// Minimal Google Drive v3 REST client — mirrors GoogleDriveClient.kt exactly (same folder/file
// names) so both apps read and write the identical backup file.
const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FOLDER_NAME = 'MTG Companion'
const BACKUP_NAME = 'mtg-companion-backup.json'

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function firstFileId(token: string, q: string): Promise<string | null> {
  const url = new URL(FILES)
  url.searchParams.set('q', q)
  url.searchParams.set('spaces', 'drive')
  url.searchParams.set('fields', 'files(id,name)')
  const res = await fetch(url, { headers: authHeader(token) })
  if (!res.ok) throw new Error(`Drive request failed (${res.status})`)
  const json = await res.json()
  return json.files?.[0]?.id ?? null
}

/** Find the app's Drive folder, creating it if missing. Returns the folder id. */
export async function ensureFolder(token: string): Promise<string> {
  const existing = await firstFileId(token, `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`)
  if (existing) return existing
  const res = await fetch(`${FILES}?fields=id`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  })
  if (!res.ok) throw new Error(`Couldn't create the Drive folder (${res.status})`)
  return (await res.json()).id
}

/** Id of the backup file in [folderId], or null if it doesn't exist yet. */
export async function findBackup(token: string, folderId: string): Promise<string | null> {
  return firstFileId(token, `name='${BACKUP_NAME}' and '${folderId}' in parents and trashed=false`)
}

export async function downloadText(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${FILES}/${fileId}?alt=media`, { headers: authHeader(token) })
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`)
  return res.text()
}

async function createEmptyBackup(token: string, folderId: string): Promise<string> {
  const res = await fetch(`${FILES}?fields=id`, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_NAME, mimeType: 'application/json', parents: [folderId] }),
  })
  if (!res.ok) throw new Error(`Couldn't create the backup file (${res.status})`)
  return (await res.json()).id
}

/** Write [content] to the backup file, creating it in [folderId] on first use. Returns the file id. */
export async function uploadBackup(
  token: string,
  folderId: string,
  existingFileId: string | null,
  content: string,
): Promise<string> {
  const fileId = existingFileId ?? (await createEmptyBackup(token, folderId))
  const res = await fetch(`${UPLOAD}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: content,
  })
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`)
  return fileId
}
