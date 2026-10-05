// Filing decks: folders on the decks list, and an Archived section for decks put away — kept, but out
// of the list and of every deck picker (game night, Add to…, the life counter's decks). A folder is
// only a name on its decks (Deck.folder), not a thing of its own: it exists while a deck is in it,
// renaming or deleting it rewrites its decks, and it syncs with them — so there's nothing new to merge
// and nothing an older app can lose but the name, which it keeps (see decks/deckExtras.ts). Pure, so
// it can be tested; the Android app's data/DeckFolders.kt files decks the same way.

import type { Deck } from '../types/models'

/** The longest folder name kept. */
export const MAX_FOLDER = 40

const key = (name: string) => name.toLowerCase()
const byName = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)

/** A folder name as it's kept: spaces tidied, at most MAX_FOLDER characters. */
export function tidyFolder(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER).trim()
}

/** The folder [deck] is in; null for none. */
export const folderOf = (deck: Deck): string | null => (deck.folder ? tidyFolder(deck.folder) || null : null)

export const isArchived = (deck: Deck): boolean => deck.archived === true

/** The decks a picker offers: every one not archived. */
export const activeDecks = (decks: Deck[]): Deck[] => decks.filter((d) => !isArchived(d))

/** [deck] in [folder]; null or "" takes it out (kept as "" once it's had one — see Deck.folder). */
export function withFolder(deck: Deck, folder: string | null): Deck {
  const next = tidyFolder(folder ?? '')
  if (!next && deck.folder === undefined) return deck
  return { ...deck, folder: next }
}

/** [deck] archived, or back on the list (kept as false once it's been archived). */
export function withArchived(deck: Deck, archived: boolean): Deck {
  if (!archived && deck.archived === undefined) return deck
  return { ...deck, archived }
}

/** The folders on the decks list, A–Z: each once, whatever its case, as its first deck spells it. */
export function folderNames(decks: Deck[]): string[] {
  const out: string[] = []
  for (const d of activeDecks(decks)) {
    const f = folderOf(d)
    if (f && !out.some((o) => key(o) === key(f))) out.push(f)
  }
  return out.sort(byName)
}

/** Every deck in folder [from] — archived ones too — moved to [to]; an empty [to] takes them out of it. */
export function renamedFolder(decks: Deck[], from: string, to: string): Deck[] {
  return decks.map((d) => (folderOf(d) != null && key(folderOf(d)!) === key(tidyFolder(from)) ? withFolder(d, to) : d))
}

/** Folder [name] deleted: its decks stay, out of any folder. */
export const withoutFolder = (decks: Deck[], name: string): Deck[] => renamedFolder(decks, name, '')

export interface DeckSections {
  /** Each folder with its decks, A–Z. */
  folders: { name: string; decks: Deck[] }[]
  /** The decks in no folder. */
  loose: Deck[]
  /** Every archived deck, folder or not. */
  archived: Deck[]
}

/** [decks] as the list shows them: folders first, then the rest, and archived decks apart. Order within each is kept. */
export function deckSections(decks: Deck[]): DeckSections {
  const names = folderNames(decks)
  const active = activeDecks(decks)
  return {
    folders: names.map((name) => ({ name, decks: active.filter((d) => folderOf(d) != null && key(folderOf(d)!) === key(name)) })),
    loose: active.filter((d) => folderOf(d) == null),
    archived: decks.filter(isArchived),
  }
}
