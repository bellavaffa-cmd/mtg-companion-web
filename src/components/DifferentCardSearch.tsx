import { useEffect, useState } from 'react'
import { autocomplete } from '../api/scryfall'
import { Dialog } from './Dialog'

/**
 * "It's a different card": the card's name, searched as you type (Scryfall's autocomplete, as elsewhere
 * in the app), to fix a scan that read as another card altogether. [onPick] gets the name chosen; the
 * scanner then asks which printing. The Android app's DifferentCardDialog in ScanScreen.kt.
 */
export function DifferentCardSearch({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    const q = query.trim()
    if (!q) { setNames([]); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void autocomplete(q).then((found) => { if (!cancelled) setNames(found.slice(0, 8)) }).catch(() => {})
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])
  return (
    <Dialog title="Which card is it?" onDismiss={onClose} actions={<button type="button" className="btn line" onClick={onClose}>Cancel</button>}>
      <input
        className="input"
        style={{ width: '100%' }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && names[0]) onPick(names[0]) }}
        placeholder="Card name"
        aria-label="Card name"
        autoFocus
      />
      <div role="list" style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
        {names.map((n) => (
          <button key={n} type="button" role="listitem" className="link" style={{ textAlign: 'left', padding: '10px 0' }} onClick={() => onPick(n)}>{n}</button>
        ))}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>Pick it, then its printing. The scanner remembers, and gets this read right next time.</p>
    </Dialog>
  )
}
