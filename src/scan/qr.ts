// QR codes read by the camera on the Scan page: a friend's code (add them), a life counter seat's
// code (sit there) or a share link (open what was shared). The Android app's scanner reads the same
// ones — see AppLink.parse in its data/social/SocialApi.kt.

/** Where the app lived before manabind.com: codes and links made then still carry it. */
const OLD_PATH = '/mtg-companion-web/'

/** The app's own addresses: its site, and a dev build's. */
const APP_HOST = /^https?:\/\/(?:(?:www\.)?manabind\.com|localhost(?::\d+)?)\//i

/**
 * The app route one of the app's links leads to — "/add/bob", "/join/<code>/2", "/s/<token>" —
 * or null for anything else. Links on manabind.com, and those from before it (any host serving the
 * app under /mtg-companion-web/, so an old dev build's codes work too).
 */
export function appLinkPath(text: string): string | null {
  const trimmed = text.trim()
  const at = trimmed.indexOf(OLD_PATH)
  const host = APP_HOST.exec(trimmed)
  const rest = at >= 0 ? trimmed.slice(at + OLD_PATH.length) : host ? trimmed.slice(host[0].length) : null
  if (rest === null) return null
  const path = rest.split(/[?#]/)[0].replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 2 && parts[0] === 'add' && /^[a-zA-Z0-9_]{3,20}$/.test(parts[1])) return `/add/${parts[1].toLowerCase()}`
  if (parts.length === 3 && parts[0] === 'join' && /^[0-9a-f]{16}$/.test(parts[1]) && /^\d+$/.test(parts[2])) return `/join/${parts[1]}/${Number(parts[2])}`
  if (parts.length === 2 && parts[0] === 's' && /^[0-9a-f]{32}$/.test(parts[1])) return `/s/${parts[1]}`
  return null
}

type Reader = (video: HTMLVideoElement) => Promise<string | null>

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorClass = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> }

let reader: Promise<Reader> | null = null

/**
 * Reads a QR code off the camera: with the browser's own reader where there is one (Chrome, Edge),
 * otherwise with jsQR, loaded the first time it's needed.
 */
export function qrReader(): Promise<Reader> {
  reader ??= (async (): Promise<Reader> => {
    const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector
    if (Native && (await Native.getSupportedFormats?.().catch((): string[] => []))?.includes('qr_code')) {
      const detector = new Native({ formats: ['qr_code'] })
      return async (video) => (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null
    }
    const jsQR = (await import('jsqr')).default
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    return async (video) => {
      if (!ctx || !video.videoWidth) return null
      // A code filling a fair part of the frame reads fine at this size, and it's quick.
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null
    }
  })()
  return reader
}
