// All cards → Filters → Advanced filters: a page of its own over the collection, with the same
// search as Scryfall syntax (read-only, to copy or open on Scryfall), the Scryfall-style fields, the
// Your copies fields, "Save as…" and a live "Show N cards". The filters here are a draft until Show
// is pressed; Back leaves them as they were. Mirrors the Android app's AdvancedFilterScreen.kt; the
// rules are in ./advancedFilter.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BackButton, IconButton } from '../components/kit'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { ManaSymbol } from '../components/ManaSymbols'
import { useMoney } from '../money/currency'
import {
  ADVANCED_COLORS, CARD_IS, CARD_IS_LABELS, COLOR_MODE_LABELS, COMPARE_OPS, CONDITION_LABELS, FILTER_FORMATS, FINISHES, FINISH_LABELS,
  IN_DECK_LABELS, LEGALITIES, LEGALITY_LABELS, NO_ADVANCED_FILTER, OP_SYMBOLS, scryfallQuery, scryfallSearchUrl,
  type AdvancedFilter, type ColorMode, type CompareOp, type InDeck, type SavedFilter,
} from './advancedFilter'
import { NO_COLLECTION_FILTER, type CollectionFilter } from './cardFilter'
import { CARD_CONDITIONS, CARD_LANGUAGES, languageName } from './copyDetails'
import { useSavedFilters } from './savedFilters'
import { NO_PLACE } from './storagePlaces'

const COLOR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' }
const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

export interface SetOption { code: string; name: string }

export function AdvancedFilterPage({ basic, advanced, countFor, binders, places = [], sets, onApply, onClose }: {
  basic: CollectionFilter
  advanced: AdvancedFilter
  /** How many cards the list would show with these filters. */
  countFor: (basic: CollectionFilter, advanced: AdvancedFilter) => number
  /** The owned binders, for "Binder". */
  binders: { id: string; name: string }[]
  /** The storage places, in tree order with their depth, for "Place". */
  places?: { id: string; name: string; depth: number }[]
  /** The sets of the cards owned, for "Find a set". */
  sets: SetOption[]
  onApply: (basic: CollectionFilter, advanced: AdvancedFilter) => void
  onClose: () => void
}) {
  const [b, setB] = useState(basic)
  const [a, setA] = useState(advanced)
  const money = useMoney()
  const { saved, add, rename, remove } = useSavedFilters()
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [setQuery, setSetQuery] = useState('')
  const query = scryfallQuery(b, a, (n) => money.toUsd(n))
  const count = useMemo(() => countFor(b, a), [countFor, b, a])
  const set = <K extends keyof AdvancedFilter>(key: K, value: AdvancedFilter[K]) => setA((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !naming) onClose() }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [onClose, naming])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(t)
  }, [copied])

  const copy = () => { void navigator.clipboard?.writeText(query).then(() => setCopied(true), () => {}) }
  const load = (s: SavedFilter) => { setB(s.basic); setA(s.advanced) }
  const setName = (code: string) => sets.find((s) => s.code === code)?.name ?? code.toUpperCase()
  const q = setQuery.trim().toLowerCase()
  const setHits = q ? sets.filter((s) => !a.sets.includes(s.code) && (s.name.toLowerCase().includes(q) || s.code === q)).slice(0, 8) : []

  const pickColor = (c: string) => {
    if (c === 'C') set('colors', a.colors.includes('C') ? [] : ['C'])
    else set('colors', toggle(a.colors.filter((x) => x !== 'C'), c))
  }

  return createPortal(
    <div className="adv-page" role="dialog" aria-modal="true" aria-labelledby="adv-title">
      <header className="adv-head">
        <BackButton onClick={onClose} />
        <h1 id="adv-title">Advanced filters</h1>
        <button type="button" className="btn btn-link sm" onClick={() => { setB(NO_COLLECTION_FILTER); setA(NO_ADVANCED_FILTER) }}>Clear all</button>
      </header>

      <div className="adv-body">
        {saved.length > 0 && (
          <Section title="Saved filters">
            <div className="adv-saved">
              {saved.map((s) => (
                <div key={s.id} className="adv-saved-row">
                  <button type="button" className="adv-saved-name" onClick={() => load(s)}>{s.name}</button>
                  <IconButton icon="edit" label={`Rename ${s.name}`} onClick={() => setNaming({ id: s.id, name: s.name })} />
                  <IconButton icon="delete" label={`Delete ${s.name}`} onClick={() => remove(s.id)} />
                </div>
              ))}
            </div>
          </Section>
        )}

        <div className="adv-query">
          <div className="adv-eyebrow">Same search on Scryfall</div>
          <output className="adv-query-line">{query || 'No Scryfall filters yet'}</output>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="chip on-g2" onClick={copy} disabled={!query}>
              <Icon name={copied ? 'check' : 'content_copy'} aria-hidden />{copied ? 'Copied' : 'Copy'}
            </button>
            {query && (
              <a className="chip on-g2" href={scryfallSearchUrl(query)} target="_blank" rel="noreferrer">
                <Icon name="open_in_new" aria-hidden />Open on Scryfall
              </a>
            )}
          </div>
          <div className="adv-note">Updates as you choose filters below. Your copies filters only apply here, not on Scryfall.</div>
        </div>

        <Section title="Colours">
          <Seg
            options={[['color', 'Card colour'], ['identity', 'Commander identity']]}
            value={a.colorTarget}
            onPick={(v) => set('colorTarget', v as AdvancedFilter['colorTarget'])}
          />
          <Seg
            options={(Object.keys(COLOR_MODE_LABELS) as ColorMode[]).map((m) => [m, COLOR_MODE_LABELS[m]])}
            value={a.colorMode}
            onPick={(v) => set('colorMode', v as ColorMode)}
          />
          <div className="sf-colors adv-colors">
            {ADVANCED_COLORS.map((c) => (
              <button key={c} type="button" className="sf-color" aria-pressed={a.colors.includes(c)} aria-label={COLOR_NAMES[c]} onClick={() => pickColor(c)}>
                <ManaSymbol code={c} size={26} />
              </button>
            ))}
            <button type="button" className="chip on-g2" aria-pressed={a.multicolor} onClick={() => set('multicolor', !a.multicolor)}>Multicolour</button>
          </div>
        </Section>

        <Section title="Mana">
          <NumberRow label="Mana value" op={a.mvOp} value={a.mv} onOp={(o) => set('mvOp', o)} onValue={(v) => set('mv', v)} />
          <Field label="Mana cost">
            <input className="input" value={a.manaCost} onChange={(e) => set('manaCost', e.target.value)} placeholder="e.g. {2}{U}{U}" />
          </Field>
        </Section>

        <Section title="Stats">
          <NumberRow label="Power" op={a.powerOp} value={a.power} onOp={(o) => set('powerOp', o)} onValue={(v) => set('power', v)} />
          <NumberRow label="Toughness" op={a.toughnessOp} value={a.toughness} onOp={(o) => set('toughnessOp', o)} onValue={(v) => set('toughness', v)} />
          <NumberRow label="Loyalty" op={a.loyaltyOp} value={a.loyalty} onOp={(o) => set('loyaltyOp', o)} onValue={(v) => set('loyalty', v)} />
        </Section>

        <Section title="Format">
          <select className="input" aria-label="Format" value={a.format} onChange={(e) => set('format', e.target.value)}>
            <option value="">Any format</option>
            {FILTER_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <Seg options={LEGALITIES.map((l) => [l, LEGALITY_LABELS[l]])} value={a.legality} onPick={(v) => set('legality', v as AdvancedFilter['legality'])} />
        </Section>

        <Section title="Sets">
          <input className="input" aria-label="Find a set" placeholder="Find a set" value={setQuery} onChange={(e) => setSetQuery(e.target.value)} />
          {setHits.length > 0 && (
            <div className="adv-set-hits">
              {setHits.map((s) => (
                <button key={s.code} type="button" className="adv-set-hit" onClick={() => { set('sets', [...a.sets, s.code]); setSetQuery('') }}>
                  <span>{s.name}</span><span className="dim">{s.code.toUpperCase()}</span>
                </button>
              ))}
            </div>
          )}
          {q && setHits.length === 0 && <div className="adv-note">No set of yours matches.</div>}
          {a.sets.length > 0 && (
            <div className="chips wrap">
              {a.sets.map((code) => (
                <button key={code} type="button" className="chip" aria-pressed="true" aria-label={`Remove ${setName(code)}`} onClick={() => set('sets', a.sets.filter((s) => s !== code))}>
                  {setName(code)}<Icon name="close" />
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Card is">
          <div className="chips wrap">
            {CARD_IS.map((is) => (
              <button key={is} type="button" className="chip on-g2" aria-pressed={a.cardIs.includes(is)} onClick={() => set('cardIs', toggle(a.cardIs, is))}>
                {CARD_IS_LABELS[is]}
              </button>
            ))}
          </div>
          <Field label="Keywords">
            <input className="input" value={a.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="e.g. flying, deathtouch" />
          </Field>
        </Section>

        <Section title="Price">
          <div className="sf-range">
            <input className="input" inputMode="decimal" aria-label="Lowest price" placeholder={`${money.currency.symbol.trim()} min`} value={a.priceMin} onChange={(e) => set('priceMin', e.target.value)} />
            <span>to</span>
            <input className="input" inputMode="decimal" aria-label="Highest price" placeholder={`${money.currency.symbol.trim()} max`} value={a.priceMax} onChange={(e) => set('priceMax', e.target.value)} />
          </div>
          <div className="adv-note">Per copy, in your currency.</div>
        </Section>

        <Section title="Art and words">
          <Field label="Artist">
            <input className="input" value={a.artist} onChange={(e) => set('artist', e.target.value)} placeholder="e.g. Rebecca Guay" />
          </Field>
          <Field label="Flavour text">
            <input className="input" value={a.flavor} onChange={(e) => set('flavor', e.target.value)} placeholder="any words" />
          </Field>
        </Section>

        <Section title="Your copies" badge="Not on Scryfall">
          <Field label="Finish">
            <div className="chips wrap">
              {FINISHES.map((f) => (
                <button key={f} type="button" className="chip on-g2" aria-pressed={a.finishes.includes(f)} onClick={() => set('finishes', toggle(a.finishes, f))}>{FINISH_LABELS[f]}</button>
              ))}
            </div>
          </Field>
          <Field label="Condition">
            <div className="chips wrap">
              {CARD_CONDITIONS.map((c) => (
                <button key={c} type="button" className="chip on-g2" aria-pressed={a.conditions.includes(c)} onClick={() => set('conditions', toggle(a.conditions, c))}>{CONDITION_LABELS[c]}</button>
              ))}
            </div>
          </Field>
          <Field label="Language">
            <select className="input" aria-label="Language" value={a.language} onChange={(e) => set('language', e.target.value)}>
              <option value="">Any</option>
              {CARD_LANGUAGES.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
            </select>
          </Field>
          <Field label="Binder">
            <select className="input" aria-label="Binder" value={a.binder} onChange={(e) => set('binder', e.target.value)}>
              <option value="">Any binder</option>
              {binders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Place">
            <select className="input" aria-label="Place" value={a.place} onChange={(e) => set('place', e.target.value)}>
              <option value="">Any place</option>
              <option value={NO_PLACE}>No place yet</option>
              {places.map((x) => <option key={x.id} value={x.id}>{`${'\u2003'.repeat(x.depth)}${x.name}`}</option>)}
            </select>
          </Field>
          <Field label="In a deck">
            <Seg options={(Object.keys(IN_DECK_LABELS) as InDeck[]).map((d) => [d, IN_DECK_LABELS[d]])} value={a.inDeck} onPick={(v) => set('inDeck', v as InDeck)} />
          </Field>
          <NumberRow label="Copies" op={a.copiesOp} value={a.copies} onOp={(o) => set('copiesOp', o)} onValue={(v) => set('copies', v)} ariaLabel="Copies owned" />
        </Section>
      </div>

      <footer className="adv-foot">
        <button type="button" className="btn line" onClick={() => setNaming({ id: null, name: '' })}>Save as…</button>
        <button type="button" className="btn gold" onClick={() => onApply(b, a)}>Show {count} {count === 1 ? 'card' : 'cards'}</button>
      </footer>

      {naming && (
        <Dialog
          title={naming.id ? 'Rename filter' : 'Save filters as'}
          onDismiss={() => setNaming(null)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setNaming(null)}>Cancel</button>
              <button
                type="button"
                className="btn gold"
                disabled={!naming.name.trim()}
                onClick={() => {
                  if (naming.id) rename(naming.id, naming.name)
                  else add(naming.name, { basic: b, advanced: a })
                  setNaming(null)
                }}
              >
                {naming.id ? 'Rename' : 'Save'}
              </button>
            </>
          }
        >
          <input
            className="input"
            autoFocus
            aria-label="Name"
            placeholder="e.g. Cheap blue creatures"
            value={naming.name}
            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
          />
        </Dialog>
      )}
    </div>,
    document.body,
  )
}

function Section({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="adv-sec">
      <div className="adv-sec-h">
        <h2>{title}</h2>
        {badge && <span className="adv-badge">{badge}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="adv-field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  )
}

function Seg({ options, value, onPick }: { options: string[][]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="adv-seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>{label}</button>
      ))}
    </div>
  )
}

function NumberRow({ label, op, value, onOp, onValue, ariaLabel }: {
  label: string; op: CompareOp; value: string; onOp: (op: CompareOp) => void; onValue: (v: string) => void; ariaLabel?: string
}) {
  return (
    <div className="adv-num">
      <span className="adv-num-label">{label}</span>
      <select className="input adv-op" aria-label={`${label}: compare`} value={op} onChange={(e) => onOp(e.target.value as CompareOp)}>
        {COMPARE_OPS.map((o) => <option key={o} value={o}>{OP_SYMBOLS[o]}</option>)}
      </select>
      <input className="input adv-num-input" inputMode="decimal" aria-label={ariaLabel ?? label} placeholder="any" value={value} onChange={(e) => onValue(e.target.value)} />
    </div>
  )
}
