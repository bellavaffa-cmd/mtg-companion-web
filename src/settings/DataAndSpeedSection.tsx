// Settings › Data and speed: the collection's size, its card data kept for offline, how long All cards
// took to open, when it last synced, and the backup — Save a backup, Restore. The words are in
// dataAndSpeed.ts and the backup's rules in sync/backupFile.ts. Mirrors the Android app's
// DataAndSpeedScreen.kt.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSync } from '../sync/SyncContext'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { allCardsOf } from '../collection/allCards'
import { storageSummary } from '../collection/storagePlaces'
import { savedCount } from '../collection/cardDataStore'
import { lastAllCardsOpen } from './perfStats'
import { BACKUP_NOTE, lastSyncedLabel, offlineLabel, openLabel, QUICK_OPEN_MS } from './dataAndSpeed'
import { backupSummary, parseBackup, restoredMessage, summaryLines, type BackupFile, type RestoreMode } from '../sync/backupFile'
import { download, makeBackup, restoreExtras } from '../sync/backupIo'

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function DataAndSpeedSection() {
  const { collections, decks, account, cloud, restoreBackup } = useSync()
  const copies = useMemo(() => storageSummary(collections, decks).total, [collections, decks])
  const printings = useMemo(() => allCardsOf(collections, decks).map((c) => c.scryfallId), [collections, decks])
  const [saved, setSaved] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    void savedCount(printings).then((n) => { if (live) setSaved(n) })
    return () => { live = false }
  }, [printings])
  const [opened] = useState(lastAllCardsOpen)
  // "2 min ago" moves on while the page is open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; reload?: boolean } | null>(null)
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [mode, setMode] = useState<RestoreMode>('merge')
  const picker = useRef<HTMLInputElement>(null)

  const save = async () => {
    setBusy('Making the backup…')
    try {
      const { blob, name } = await makeBackup({ decks, collections })
      download(blob, name)
      setNotice({ text: `Saved ${name}.` })
    } catch {
      setProblem("Couldn't make the backup. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const open = async (file: File | undefined) => {
    if (!file) return
    setBusy('Reading the backup…')
    try {
      const read = parseBackup(await file.text())
      if (read.ok) { setMode('merge'); setPending(read.backup) } else setProblem(read.message)
    } catch {
      setProblem("Couldn't read that file.")
    } finally {
      setBusy(null)
      if (picker.current) picker.current.value = ''
    }
  }

  const restore = async () => {
    const backup = pending
    if (!backup) return
    setPending(null)
    setBusy('Restoring…')
    try {
      restoreBackup(backup, mode)
      const extras = await restoreExtras(backup, mode)
      const done = restoredMessage(backupSummary(backup), extras.photos)
      setNotice({ text: account ? `${done} It syncs to your account now.` : done, reload: extras.settings })
    } catch {
      setProblem("Couldn't restore everything from the backup. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const summary = pending ? backupSummary(pending) : null
  return (
    <>
      <section className="panel data-rows" aria-label="Data and speed">
        <div className="data-row"><span>Copies</span><b>{copies.toLocaleString('en-GB')}</b></div>
        <div className="data-row"><span>Card data saved for offline</span><b>{saved === null ? '…' : offlineLabel(saved, printings.length)}</b></div>
        <div className="data-row"><span>Opening All cards</span><b className={opened && opened.ms < QUICK_OPEN_MS ? 'quick' : undefined}>{openLabel(opened)}</b></div>
        <div className="data-row"><span>Last synced</span><b>{lastSyncedLabel(!!account, cloud.lastSyncedAt, now)}</b></div>
      </section>
      <section className="panel backup-panel">
        <h3>Backup</h3>
        <p className="dim">{BACKUP_NOTE}</p>
        <div className="backup-actions">
          <button type="button" className="btn gold" disabled={!!busy} onClick={() => { void save() }}>Save a backup</button>
          <button type="button" className="btn soft" disabled={!!busy} onClick={() => picker.current?.click()}>Restore</button>
        </div>
        <input ref={picker} type="file" accept=".json,application/json" hidden onChange={(e) => { void open(e.target.files?.[0]) }} />
        {busy && <p className="dim backup-status" role="status">{busy}</p>}
        {notice && (
          <div className="notice backup-status" role="status">
            <Icon name="check_circle" style={{ color: 'var(--ok)', fontSize: 18, marginRight: 6 }} />{notice.text}
            {notice.reload && <button type="button" className="link" onClick={() => window.location.reload()}> Reload to use its settings</button>}
          </div>
        )}
      </section>

      {problem && (
        <Dialog title="Can't restore this" onDismiss={() => setProblem(null)} actions={<button type="button" className="btn gold" onClick={() => setProblem(null)}>OK</button>}>
          <p className="muted" style={{ margin: 0 }}>{problem}</p>
        </Dialog>
      )}
      {pending && summary && (
        <Dialog
          title="Restore this backup?"
          onDismiss={() => setPending(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className="btn gold" onClick={() => { void restore() }}>Restore</button>
            </>
          }
        >
          <p className="dim" style={{ marginTop: 0 }}>Made {when(summary.createdAt)} {summary.from === 'android' ? 'on the phone' : 'on the web'}</p>
          <ul className="backup-summary">
            {summaryLines(summary).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <div className="backup-modes" role="radiogroup" aria-label="How to restore">
            <label className="backup-mode">
              <input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span><b>Merge with what's here</b><small>Keeps everything here and adds back what's only in the backup. Where both have a card, the larger count stays.</small></span>
            </label>
            <label className="backup-mode">
              <input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span><b>Replace with the backup</b><small>Decks and binders in the backup go back to how they were, settings too. Ones made since stay.</small></span>
            </label>
          </div>
          {account && <p className="dim" style={{ marginBottom: 0 }}>Signed in, it syncs to your account afterwards.</p>}
        </Dialog>
      )}
    </>
  )
}
