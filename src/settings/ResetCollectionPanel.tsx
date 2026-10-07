// Settings › Data and speed › Danger zone › Reset collection: choose what goes, see how much, save a
// backup first, type RESET, then Reset — with Undo for a few seconds after. The rules and words are in
// resetCollection.ts; the sync side in SyncContext (resetCollection). Mirrors the Android app's
// ResetCollectionPanel.kt.

import { useMemo, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { Icon } from '../components/Icon'
import { download, makeBackup } from '../sync/backupIo'
import { RESET_NOTHING, RESET_SCOPES, RESET_SYNC_NOTE, RESET_WORD, resetConfirmed, resetCounts, resetCountsText, type ResetScope } from './resetCollection'

export function ResetCollectionPanel() {
  const { decks, collections, account, resetCollection } = useSync()
  const [scope, setScope] = useState<ResetScope>('cards')
  const [typed, setTyped] = useState('')
  const [backedUp, setBackedUp] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const counts = useMemo(() => resetCounts({ decks, collections }, scope), [decks, collections, scope])
  const text = resetCountsText(counts)
  const nothing = text === RESET_NOTHING

  const save = async () => {
    setSaving(true)
    setProblem(null)
    try {
      const { blob, name } = await makeBackup({ decks, collections })
      download(blob, name)
      setBackedUp(name)
    } catch {
      setProblem("Couldn't make the backup. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    resetCollection(scope)
    setTyped('')
    setBackedUp(null)
  }

  return (
    <section className="panel backup-panel danger-zone" aria-label="Danger zone">
      <h3>Danger zone</h3>
      <p className="dim">Reset collection removes what you choose from this device and, signed in, from your account and other devices.</p>
      <div className="backup-modes" role="radiogroup" aria-label="What to reset" style={{ marginTop: 10 }}>
        {RESET_SCOPES.map((s) => (
          <label key={s.id} className="backup-mode">
            <input type="radio" name="reset-scope" checked={scope === s.id} onChange={() => setScope(s.id)} />
            <span><b>{s.title}</b><small>{s.detail}</small></span>
          </label>
        ))}
      </div>
      <p className="reset-counts" aria-live="polite"><b>Removes:</b> {text}</p>
      <div className="backup-actions">
        <button type="button" className="btn gold" disabled={saving} onClick={() => { void save() }}>
          {backedUp ? <><Icon name="check_circle" style={{ fontSize: 18, marginRight: 6 }} />Backup saved</> : saving ? 'Making the backup…' : 'Save a backup first'}
        </button>
      </div>
      {backedUp && <p className="dim backup-status" role="status">Saved {backedUp}.</p>}
      {problem && <div className="notice warn backup-status" role="alert">{problem}</div>}
      <label className="field-label reset-type">
        Type {RESET_WORD} to confirm
        <input
          type="text"
          value={typed}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={RESET_WORD}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <div className="backup-actions">
        <button type="button" className="btn danger solid" disabled={!resetConfirmed(typed) || nothing} onClick={reset}>Reset</button>
      </div>
      {account && <p className="dim backup-status">{RESET_SYNC_NOTE}</p>}
    </section>
  )
}
