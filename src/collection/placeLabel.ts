// Box labels: a printable label for a storage place, with a QR code that names the place. The code
// is a link, https://manabind.com/place/<id>, like the app's other codes (a friend's, a seat's, a
// share link): the scanner in either app opens the place's sheet, and a phone's own camera opens the
// place on manabind.com. It names the place only, so the label stays right as cards come and go.
//
// Pure, so it can be tested. Mirrors the Android app's data/PlaceLabel.kt, with the same tests
// (tests/collection/placeLabel.test.ts ↔ PlaceLabelTest.kt).

import type { StoragePlace } from '../types/models'
import { parentsOf, placeTree, SORT_RULE_LABELS } from './storagePlaces'

/** The start of a label's link; the place's id follows. */
export const PLACE_LINK_PREFIX = 'https://manabind.com/place/'

/** What a label's QR code holds: the link to the place. */
export const placeLabelLink = (placeId: string): string => PLACE_LINK_PREFIX + encodeURIComponent(placeId)

/** The app's own addresses: its site, and a dev build's; and where it lived before manabind.com. */
const APP_HOST = /^https?:\/\/(?:(?:www\.)?manabind\.com|localhost(?::\d+)?)\//i
const OLD_PATH = '/mtg-companion-web/'
const PLACE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** A place's id alone, as the first labels held it: the ids both apps make. */
const BARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The place a scanned code names, or null when it isn't a label. [bare]: the code was the place's id
 * on its own, as the first labels printed it — only worth acting on when it's one of the user's
 * places, since any id looks like that.
 */
export function placeIdFromLabel(text: string): { id: string; bare: boolean } | null {
  const trimmed = text.trim()
  if (BARE_ID.test(trimmed)) return { id: trimmed.toLowerCase(), bare: true }
  const at = trimmed.indexOf(OLD_PATH)
  const host = APP_HOST.exec(trimmed)
  const rest = at >= 0 ? trimmed.slice(at + OLD_PATH.length) : host ? trimmed.slice(host[0].length) : null
  if (rest === null) return null
  const parts = rest.split(/[?#]/)[0].replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'place') return null
  let id: string
  try { id = decodeURIComponent(parts[1]) } catch { return null }
  return PLACE_ID.test(id) ? { id, bare: false } : null
}

/** How big a label prints: a small sticker, the end of a card box, or a divider standing in a box. */
export type LabelSize = 'SMALL' | 'BOX_END' | 'DIVIDER'

export interface LabelSizeInfo { size: LabelSize; label: string; widthMm: number; heightMm: number }

export const LABEL_SIZES: LabelSizeInfo[] = [
  { size: 'SMALL', label: 'Small', widthMm: 62, heightMm: 29 },
  { size: 'BOX_END', label: 'Box end', widthMm: 90, heightMm: 50 },
  { size: 'DIVIDER', label: 'Divider', widthMm: 70, heightMm: 100 },
]

export const labelSizeInfo = (size: LabelSize): LabelSizeInfo => LABEL_SIZES.find((s) => s.size === size) ?? LABEL_SIZES[1]

/** What a label shows beside its name and code. */
export interface LabelShow {
  /** The places it sits in: "Shelf, study". */
  where: boolean
  sections: boolean
  rule: boolean
  count: boolean
}

export const DEFAULT_LABEL_SHOW: LabelShow = { where: true, sections: true, rule: true, count: false }

/** A label's lines, each null when it's hidden or there's nothing to say. */
export interface LabelText {
  where: string | null
  name: string
  sections: string | null
  rule: string | null
  count: string | null
}

/** The lines of [place]'s label: "Shelf, study", "Red box", "White · Blue · …", "By colour, then A–Z", "612 copies". */
export function labelText(place: StoragePlace, places: StoragePlace[], show: LabelShow, copies: number): LabelText {
  const where = parentsOf(places, place.id).map((p) => p.name).join(' › ')
  const sections = (place.sections ?? []).filter((s) => s.trim()).join(' · ')
  return {
    where: show.where && where ? where : null,
    name: place.name,
    sections: show.sections && sections ? sections : null,
    rule: show.rule && place.sortRule ? SORT_RULE_LABELS[place.sortRule] : null,
    count: show.count ? `${copies} ${copies === 1 ? 'copy' : 'copies'}` : null,
  }
}

/** Every place, for "All labels": in the Storage tree's order. */
export const labelOrder = (places: StoragePlace[]): StoragePlace[] => placeTree(places).map((n) => n.place)
