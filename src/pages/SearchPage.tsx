import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CardSearchResults } from '../components/CardSearchResults'
import { ComboSearch } from '../components/ComboSearch'
import { PageHeader, PillChip, rise, useLayoutSize } from '../components/kit'
import { useNewSetsLine } from '../collection/newSetsStore'
import '../collection/collectionHome.css'

const EXAMPLES = [
  { label: 'Green creatures', query: 'c:g t:creature' },
  { label: 'Commanders', query: 'is:commander' },
  { label: 'Card draw', query: 'o:"draw a card" c<=u' },
  { label: 'Cheap ramp', query: 'otag:ramp usd<1' },
  { label: 'Board wipes', query: 'otag:board-wipe' },
]

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const wide = useLayoutSize() !== 'phone'
  // Cards (Scryfall) or Combos (Commander Spellbook), as the phone's Search; kept in the address.
  const combos = params.get('mode') === 'combos'
  const setMode = (toCombos: boolean) => setParams(toCombos ? { mode: 'combos' } : {}, { replace: true })
  // New sets: coming soon and just out (once on the Collection's home).
  const sets = useNewSetsLine()
  return (
    <>
      <PageHeader
        title="Search"
        eyebrow="Every card on Scryfall"
        actions={<button type="button" className="btn line" onClick={() => navigate('/scan')}><Icon name="photo_camera" />Scan</button>}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'} rise`} style={rise(1)}>
        {!combos && (
          <button type="button" className="chome-sets press" style={{ marginBottom: 12, maxWidth: 560 }} onClick={() => navigate('/new-sets')}>
            <Icon name="new_releases" aria-hidden />
            <span className="chome-sets-text"><b>New sets</b><span>{sets.line}</span></span>
            {sets.out > 0 && <span className="badge" aria-label={`${sets.out} followed ${sets.out === 1 ? 'set is' : 'sets are'} out`}>{sets.out}</span>}
            <Icon name="chevron_right" aria-hidden />
          </button>
        )}
        <div className="chips search-mode" role="group" aria-label="Search for">
          <PillChip label="Cards" selected={!combos} onClick={() => setMode(false)} />
          <PillChip label="Combos" selected={combos} onClick={() => setMode(true)} />
        </div>
        <div className="wide-search">
          {combos
            ? <ComboSearch />
            : <CardSearchResults examples={EXAMPLES} autoFocus initialQuery={params.get('q') ?? ''} wide={wide} filterable />}
        </div>
        {!combos && (
          <p className="dim" style={{ margin: '18px 4px 0' }}>
            Tap a card to see it up close. Use ⋮ (or right-click) to add it to a deck or binder.
          </p>
        )}
      </div>
    </>
  )
}
