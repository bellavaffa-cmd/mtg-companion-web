import type { Box } from './ocr'

/**
 * Where the guide box's card sits in the video's own pixels. The video fills its frame (cropping
 * the edges, like object-fit: cover), so the box on screen is mapped back through that.
 */
export function guideInVideo(
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight' | 'getBoundingClientRect'>,
  guide: Pick<HTMLElement, 'getBoundingClientRect'>,
): Box | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const view = video.getBoundingClientRect()
  const box = guide.getBoundingClientRect()
  const scale = Math.max(view.width / vw, view.height / vh)
  const offsetX = (vw * scale - view.width) / 2
  const offsetY = (vh * scale - view.height) / 2
  return {
    x: (box.left - view.left + offsetX) / scale,
    y: (box.top - view.top + offsetY) / scale,
    width: box.width / scale,
    height: box.height / scale,
  }
}

/**
 * How far the camera is zoomed in while scanning.
 *
 * The guide can only divide up the pixels the frame already has; the zoom decides how many of them
 * land on the card. A card held comfortably fills only about half the guide, which leaves the set
 * line's letters well under the size the reader needs, and the printing then has to be guessed from
 * the card's name instead of read off the card. Holding the card closer is not the answer — a phone's
 * main lens cannot focus much nearer than 10 cm, and the nearer it gets the likelier it blurs.
 *
 * This is not the empty magnification it sounds like: the video is a small downsample of a much
 * larger sensor, so zooming crops the sensor's own readout before that downsample and puts real
 * sensor pixels on the card rather than interpolated ones.
 *
 * Mirrors SCAN_ZOOM in the Android app's data/ScanCrop.kt, where it took the set code from reading
 * on 2% of scans to all of them.
 */
export const SCAN_ZOOM = 1.8

/**
 * Where a phone stops cropping its main lens and switches to a telephoto one. Those cannot focus
 * closer than about 40 cm, so a card held to be scanned would never come into focus at all. The
 * zoom must stay underneath this.
 */
export const LENS_SWITCH_ZOOM = 2.9

/**
 * The zoom to actually ask a camera for: what it can give, held under the lens switch. Null when the
 * camera reports no zoom at all, which is most laptops — there is then nothing to ask for.
 */
export function zoomFor(range: { min?: number; max?: number } | undefined): number | null {
  if (!range || typeof range.max !== 'number' || typeof range.min !== 'number') return null
  const ceiling = Math.min(range.max, LENS_SWITCH_ZOOM)
  if (!(ceiling > range.min)) return null
  return Math.min(Math.max(SCAN_ZOOM, range.min), ceiling)
}
