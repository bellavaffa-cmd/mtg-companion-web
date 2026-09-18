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
