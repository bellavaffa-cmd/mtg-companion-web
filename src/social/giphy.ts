// A profile picture from Giphy: paste the link to a GIF (its page, or the GIF itself) and the app
// fetches the best version of it that fits under the 2 MB picture limit. No Giphy account or key
// needed — these are the public files Giphy serves for every GIF.

export const GIPHY_SITE = 'https://giphy.com/'

/** Profile pictures are at most this big. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * The GIF's id in a Giphy link, or null if it isn't one:
 *   https://giphy.com/gifs/happy-dance-3o7TKSjRrfIPjeiVyM   (a GIF's page; also /stickers/, /clips/)
 *   https://giphy.com/embed/3o7TKSjRrfIPjeiVyM
 *   https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif   (media0–4, and /media/v1.…/ID/)
 *   https://i.giphy.com/3o7TKSjRrfIPjeiVyM.gif
 */
export function giphyId(link: string): string | null {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }
  if (!/(^|\.)giphy\.com$/.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const id = (s: string | undefined) => (s && /^[A-Za-z0-9]{6,40}$/.test(s) ? s : null)
  if (url.hostname === 'i.giphy.com') {
    return parts[0] === 'media' ? id(parts[1]) : id(parts[0]?.replace(/\.(gif|webp)$/, ''))
  }
  if (/^media\d?\.giphy\.com$/.test(url.hostname)) {
    // /media/ID/giphy.gif, or /media/v1.<token>/ID/giphy.gif
    return parts[0] === 'media' ? id(parts[1]?.startsWith('v1.') ? parts[2] : parts[1]) : null
  }
  if (['gifs', 'stickers', 'clips', 'embed'].includes(parts[0])) {
    // The id is the last dash-separated piece of the page's slug.
    return id(parts[1]?.split('-').pop())
  }
  return null
}

/** Versions of the GIF to try, best first: the original, Giphy's under-2 MB one, then smaller ones. */
export const giphyRenditions = (id: string) =>
  ['giphy.gif', 'giphy-downsized.gif', '200.gif', '100.gif'].map((name) => `https://media.giphy.com/media/${id}/${name}`)

/**
 * Giphy answers a GIF that doesn't exist (a mistyped link, a deleted GIF) with its "This content is
 * not available" GIF rather than an error. It's the same file every time, so its size gives it away.
 */
const NOT_AVAILABLE_SIZES = new Set([239321, 158134, 65583])

export class GiphyError extends Error {}

/** Fetches the best version of the GIF at [link] that fits the picture limit, as a file to upload. */
export async function fetchGiphyGif(link: string): Promise<File> {
  const id = giphyId(link)
  if (!id) throw new GiphyError("That isn't a Giphy link. Open the GIF on giphy.com and copy the address, or use Share → Copy link.")
  for (const url of giphyRenditions(id)) {
    try {
      // Asked first, so a huge original isn't downloaded just to be turned down.
      const head = await fetch(url, { method: 'HEAD' })
      const size = Number(head.headers.get('content-length') ?? 0)
      if (NOT_AVAILABLE_SIZES.has(size)) break
      if (!head.ok || size > MAX_BYTES) continue
      const res = await fetch(url)
      if (!res.ok) continue
      const blob = await res.blob()
      if (blob.size > MAX_BYTES || !blob.type.startsWith('image/gif')) continue
      return new File([blob], `giphy-${id}.gif`, { type: 'image/gif' })
    } catch {
      throw new GiphyError("Couldn't reach Giphy — check your connection and try again.")
    }
  }
  throw new GiphyError("Giphy doesn't have that GIF (or it's no longer there).")
}
