import { matchedTags, matchesNameOrTag, tagLabel, tagsOf, useRoleTags } from './roleTags'

/**
 * One search over a list of cards by name or by what they do (a tag's label: "ramp", "removal"…),
 * as the user's own decks and binders have — for pages showing someone else's cards too. [tagHits]
 * are the tags that matched cards whose names didn't, for the note under the search.
 */
export function useNameTagSearch<T extends { name: string }>(items: T[], query: string) {
  const { tags, loading } = useRoleTags(items.map((i) => i.name))
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => matchesNameOrTag(i.name, tagsOf(tags, i.name), q)) : items
  const tagHits = q ? [...new Set(shown.filter((i) => !i.name.toLowerCase().includes(q)).flatMap((i) => matchedTags(tagsOf(tags, i.name), q)))] : []
  return {
    shown,
    tags,
    tagging: !!loading,
    /** A card's tags as labels, for the card zoom. */
    labelsOf: (name: string) => tagsOf(tags, name).map(tagLabel),
    /** Whether a card's tags are still being looked up. */
    tagsLoading: (name: string) => !!loading && !tags.has(name.trim().toLowerCase()),
    note: q ? <SearchNote count={shown.length} tagHits={tagHits} tagging={!!loading} /> : null,
  }
}

/** "12 cards · tag: Mana ramp" under a search. */
function SearchNote({ count, tagHits, tagging }: { count: number; tagHits: string[]; tagging: boolean }) {
  return (
    <div className="dim search-note">
      {count} {count === 1 ? 'card' : 'cards'}
      {tagHits.length > 0 && ` · tag: ${tagHits.slice(0, 2).map(tagLabel).join(', ')}${tagHits.length > 2 ? '…' : ''}`}
      {tagging && ' · finding tags…'}
    </div>
  )
}
