import { useMemo, useState, type CSSProperties } from 'react'
import qrcode from 'qrcode-generator'
import { avatarUrl, type Profile } from './api'

/** A person's picture (a photo or a moving GIF), or their initial when they haven't added one. */
export function Avatar({ profile, size = 46, className = '' }: { profile: Pick<Profile, 'display_name' | 'avatar_path'> | null; size?: number; className?: string }) {
  const url = avatarUrl(profile?.avatar_path)
  const [failed, setFailed] = useState<string | null>(null)
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  if (url && failed !== url) {
    return <img className={`avatar avatar-img ${className}`} src={url} alt="" style={style} onError={() => setFailed(url)} />
  }
  return (
    <span className={`avatar ${className}`} style={style} aria-hidden>
      {(profile?.display_name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

/** A QR code for [text], drawn as SVG (dark on white, with the quiet margin scanners need). */
export function QrCode({ text, size = 240, label }: { text: string; size?: number; label: string }) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text, 'Byte')
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`
    }
    return { count: n + 8, path: d }
  }, [text])
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges">
      <rect width={count} height={count} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/** "@username" */
export const handle = (p: Pick<Profile, 'username'>) => `@${p.username}`
