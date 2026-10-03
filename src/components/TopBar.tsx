import type { CSSProperties, ReactNode } from 'react'
import { BackButton, useLayoutSize } from './kit'
import { SyncButton } from './SyncButton'

interface Props {
  title: string
  onBack?: () => void
  actions?: ReactNode
  /**
   * 0..1 scroll progress for a bar that sits over hero art: transparent with the title hidden at 0,
   * solid with the title shown at 1. Omit for an always-solid bar.
   */
  progress?: number
}

/** Detail-screen top bar: round back button, title, trailing actions. */
export function TopBar({ title, onBack, actions, progress }: Props) {
  const overHero = progress !== undefined
  const phone = useLayoutSize() === 'phone'
  const style = overHero
    ? ({ ['--p' as string]: progress, ['--title' as string]: Math.max(0, Math.min(1, (progress - 0.55) * 3)) } as CSSProperties)
    : undefined
  return (
    <div className="top-bar" style={style}>
      {onBack && <BackButton onClick={onBack} overArt={overHero} />}
      <div className="top-bar-title">{title}</div>
      {phone && <SyncButton variant={overHero && progress < 0.6 ? 'glass' : ''} />}
      {actions}
    </div>
  )
}
