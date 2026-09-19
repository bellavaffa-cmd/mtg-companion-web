import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CardSearchResults } from '../components/CardSearchResults'
import { PageHeader, rise, useLayoutSize } from '../components/kit'

const EXAMPLES = [
  { label: 'Green creatures', query: 'c:g t:creature' },
  { label: 'Commanders', query: 'is:commander' },
  { label: 'Card draw', query: 'o:"draw a card" c<=u' },
  { label: 'Cheap ramp', query: 'otag:ramp usd<1' },
  { label: 'Board wipes', query: 'otag:board-wipe' },
]

export function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const wide = useLayoutSize() !== 'phone'
  return (
    <>
      <PageHeader
        title="Search"
        eyebrow="Every card on Scryfall"
        actions={<button type="button" className="btn line" onClick={() => navigate('/scan')}><Icon name="photo_camera" />Scan</button>}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'} rise`} style={rise(1)}>
        <div className="wide-search">
          <CardSearchResults examples={EXAMPLES} autoFocus initialQuery={params.get('q') ?? ''} wide={wide} filterable />
        </div>
        <p className="dim" style={{ margin: '18px 4px 0' }}>
          Tap a card to see it up close. Use ⋮ (or right-click) to add it to a deck or binder.
        </p>
      </div>
    </>
  )
}
