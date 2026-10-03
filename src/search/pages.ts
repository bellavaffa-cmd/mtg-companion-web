// Search results a page at a time: Scryfall answers 175 cards per page, and "Load more" adds the
// next page under the ones already showing.

/**
 * [shown] with the next page's [more] after it. A card already showing isn't added twice — Scryfall
 * can shift a card across a page boundary when its data changes between requests.
 */
export function appendPage<T extends { id: string }>(shown: T[], more: T[]): T[] {
  const ids = new Set(shown.map((c) => c.id))
  return [...shown, ...more.filter((c) => !ids.has(c.id))]
}
