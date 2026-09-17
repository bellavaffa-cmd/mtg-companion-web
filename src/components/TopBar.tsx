import type { CSSProperties, ReactNode } from 'react'
import { IconButton } from './kit'

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
  const style = overHero
    ? ({ ['--p' as string]: progress, ['--title' as string]: Math.max(0, Math.min(1, (progress - 0.55) * 3)) } as CSSProperties)
    : undefined
  return (
    <div className="top-bar" style={style}>
      {onBack && <IconButton icon="arrow_back" label="Back" onClick={onBack} variant={overHero ? 'glass' : ''} />}
      <div className="top-bar-title">{title}</div>
      {actions}
    </div>
  )
}
