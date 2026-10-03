import { useEffect, useState } from 'react'
import { comboUrl, relayAvailable, searchCombos, type ComboVariant } from '../api/relay'
import { COMBO_COLORS, comboSearchQuery } from '../search/comboSearch'
import { ManaSymbol } from './ManaSymbols'
import { Icon } from './Icon'
import { SearchPill } from './kit'

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; combos: ComboVariant[] }

/**
 * The Search page's Combos mode: Commander Spellbook's combos by a card in them, what they produce,
 * and the commander colours they fit — searched as any of the three is filled in. The Android app's
 * ComboSearchBody (ui/search/SearchScreen.kt).
 */
export function ComboSearch() {
  const [card, setCard] = useState('')
  const [result, setResult] = useState('')
  const [colors, setColors] = useState<string[]>([])
  const [state, setState] = useState<State>({ kind: 'idle' })
  const query = comboSearchQuery(card, result, colors)

  useEffect(() => {
    if (!query) {
      setState({ kind: 'idle' })
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setState({ kind: 'loading' })
      searchCombos(query)
        .then((combos) => { if (!cancelled) setState({ kind: 'loaded', combos }) })
        .catch((e) => {
          if (cancelled) return
          setState({ kind: 'error', message: !navigator.onLine || e instanceof TypeError ? "You're offline — combo search needs an internet connection." : 'Search failed.' })
        })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])

  const toggle = (c: string) => setColors((now) => (now.includes(c) ? now.filter((x) => x !== c) : [...now, c]))

  if (!relayAvailable) {
    return <div className="empty-state"><Icon name="cloud_off" />Combo search isn't available in this build.</div>
  }

  return (
    <div className="combo-search">
      <SearchPill value={card} onChange={setCard} placeholder="Card used in the combo" />
      <input
        className="input" style={{ marginTop: 10 }} value={result} onChange={(e) => setResult(e.target.value)}
        placeholder="Produces (e.g. infinite mana, extra turns)" aria-label="What the combo produces"
      />
      <div className="field-label">Commander (color identity)</div>
      <div className="combo-colors" role="group" aria-label="Commander colour identity">
        {COMBO_COLORS.map((c) => (
          <button key={c} type="button" className={`combo-color press${colors.includes(c) ? ' on' : ''}`} aria-pressed={colors.includes(c)} onClick={() => toggle(c)} aria-label={c}>
            <ManaSymbol code={c} size={22} />
          </button>
        ))}
      </div>

      {state.kind === 'idle' && <p className="dim" style={{ fontStyle: 'italic', marginTop: 20 }}>Search by card, effect, or commander color identity to find combos.</p>}
      {state.kind === 'loading' && <div className="muted" style={{ marginTop: 20 }}>Searching…</div>}
      {state.kind === 'error' && <div className="muted" style={{ marginTop: 20, color: 'var(--error)' }}>{state.message}</div>}
      {state.kind === 'loaded' && state.combos.length === 0 && <div className="muted" style={{ marginTop: 20 }}>No combos match.</div>}
      {state.kind === 'loaded' && state.combos.length > 0 && (
        <ul className="combo-results-list">
          {state.combos.map((combo) => (
            <li key={combo.id}>
              <a className="combo-card press" href={comboUrl(combo.id)} target="_blank" rel="noreferrer noopener">
                <span className="combo-arts">
                  {combo.uses.map((u, i) => (
                    u.card.imageUriFrontArtCrop
                      ? <img key={`${u.card.name}-${i}`} src={u.card.imageUriFrontArtCrop} alt="" loading="lazy" />
                      : <span key={`${u.card.name}-${i}`} className="combo-art-blank" />
                  ))}
                </span>
                <span className="combo-names">{combo.uses.map((u) => u.card.name).join(' + ')}</span>
                {combo.produces.length > 0 && <span className="combo-produces">Produces: {combo.produces.map((p) => p.feature.name).join(', ')}</span>}
                <span className="combo-link">Commander Spellbook <Icon name="open_in_new" /></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
