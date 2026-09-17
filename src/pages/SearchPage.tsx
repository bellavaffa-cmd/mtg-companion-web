import { CardSearchResults } from '../components/CardSearchResults'
import { PageHeader, rise } from '../components/kit'

const EXAMPLES = [
  { label: 'Green creatures', query: 'c:g t:creature' },
  { label: 'Commanders', query: 'is:commander' },
  { label: 'Card draw', query: 'o:"draw a card" c<=u' },
  { label: 'Ramp under $1', query: 'otag:ramp usd<1' },
  { label: 'Board wipes', query: 'otag:board-wipe' },
]

export function SearchPage() {
  return (
    <>
      <PageHeader title="Search" eyebrow="Every card on Scryfall" />
      <div className="content-scroll with-nav rise" style={rise(1)}>
        <CardSearchResults examples={EXAMPLES} autoFocus />
        <p className="dim" style={{ margin: '18px 4px 0' }}>
          Tap a card to see it up close. Use ⋮ (or right-click) to add it to a deck or binder.
        </p>
      </div>
    </>
  )
}
