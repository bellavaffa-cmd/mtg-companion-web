import { TopBar } from '../components/TopBar'
import { CardSearchResults } from '../components/CardSearchResults'

export function SearchPage() {
  return (
    <>
      <TopBar title="SEARCH" />
      <div className="content-scroll">
        <CardSearchResults />
      </div>
    </>
  )
}
