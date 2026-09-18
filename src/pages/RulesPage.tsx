import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRulings, OfflineError, type Ruling } from '../api/scryfall'
import { Icon } from '../components/Icon'
import { InlineManaText } from '../components/ManaSymbols'
import { ArtImage, PageHeader, SearchPill, SegmentedTabs, rise, toArtCrop, useBack, useLayoutSize } from '../components/kit'
import { searchKeywords } from '../rules/keywords'
import { displayImageUrl, type ScryfallCard } from '../types/scryfall'

type RulingsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; card: ScryfallCard; rulings: Ruling[] }
  | { kind: 'error'; message: string }

/**
 * The Android app's Rules tab: a keyword glossary that works offline, and the official rulings for
 * any card from Scryfall. Each tab keeps its own search — a keyword isn't a card name.
 */
export function RulesPage() {
  const [params, setParams] = useSearchParams()
  const rulingsTab = params.get('tab') === 'rulings'
  const wide = useLayoutSize() !== 'phone'
  const back = useBack('/')
  const [keywordQuery, setKeywordQuery] = useState('')
  const [cardQuery, setCardQuery] = useState(params.get('card') ?? '')
  const [rulings, setRulings] = useState<RulingsState>({ kind: 'idle' })

  const keywords = useMemo(() => searchKeywords(keywordQuery), [keywordQuery])

  // Look the card up as its name is typed, once typing pauses.
  useEffect(() => {
    if (!rulingsTab) return
    const name = cardQuery.trim()
    if (!name) {
      setRulings({ kind: 'idle' })
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setRulings({ kind: 'loading' })
      getRulings(name)
        .then(({ card, rulings: list }) => { if (!cancelled) setRulings({ kind: 'loaded', card, rulings: list }) })
        .catch((e) => {
          if (cancelled) return
          setRulings({
            kind: 'error',
            message: e instanceof OfflineError ? "You're offline — card rulings need an internet connection." : `No card found matching “${name}”.`,
          })
        })
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [cardQuery, rulingsTab])

  const selectTab = (i: number) => setParams(i === 1 ? { tab: 'rulings' } : {}, { replace: true })

  return (
    <>
      <PageHeader
        title="Rules"
        eyebrow="Keywords and card rulings"
        actions={wide ? undefined : <button type="button" className="btn line" onClick={back}><Icon name="arrow_back" />Back</button>}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        <div className="rules">
          <SegmentedTabs labels={['Keywords', 'Card rulings']} selected={rulingsTab ? 1 : 0} onSelect={selectTab} />
          {rulingsTab ? (
            <SearchPill key="card" value={cardQuery} onChange={setCardQuery} placeholder="Card name for rulings" autoFocus />
          ) : (
            <SearchPill key="keyword" value={keywordQuery} onChange={setKeywordQuery} placeholder="Search keywords (e.g. trample)" />
          )}
          {rulingsTab ? <RulingsBody state={rulings} /> : (
            keywords.length === 0 ? (
              <div className="empty-state">No keyword matches “{keywordQuery.trim()}”. Try the card rulings tab for a specific card.</div>
            ) : (
              <div className="rules-list">
                {keywords.map((k, i) => (
                  <article key={k.name} className="rule-card rise" style={rise(Math.min(i, 8))}>
                    <header>
                      <h3>{k.name}</h3>
                      <span>{k.category}</span>
                    </header>
                    <p><InlineManaText text={k.text} /></p>
                  </article>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </>
  )
}

function RulingsBody({ state }: { state: RulingsState }) {
  switch (state.kind) {
    case 'idle':
      return <div className="rules-hint">Enter a card name to see its official rulings from Scryfall.</div>
    case 'loading':
      return <div className="rules-hint">Looking up rulings…</div>
    case 'error':
      return <div className="notice warn" style={{ marginTop: 14 }}>{state.message}</div>
    case 'loaded':
      return (
        <>
          <div className="ruling-card-head rise">
            <ArtImage className="ruling-art" src={toArtCrop(displayImageUrl(state.card))} seed={state.card.name} />
            <h3>{state.card.name}</h3>
          </div>
          {state.rulings.length === 0 ? (
            <div className="rules-hint">No official rulings for this card.</div>
          ) : (
            <div className="rules-list">
              {state.rulings.map((r, i) => (
                <article key={`${r.published_at}${r.comment}`} className="rule-card rise" style={rise(Math.min(i + 1, 8))}>
                  <p><InlineManaText text={r.comment} /></p>
                  <footer>{r.source === 'wotc' ? 'Wizards of the Coast' : r.source.charAt(0).toUpperCase() + r.source.slice(1)} · {r.published_at}</footer>
                </article>
              ))}
            </div>
          )}
        </>
      )
  }
}
