import { createContext, useContext, type ReactNode } from 'react'
import { Icon } from './Icon'

/** A Stats panel's fold: whether it's open, and how to flip it. Set by [Fold]; read by [PanelHead]. */
interface FoldState { open: boolean; toggle: () => void }

const FoldContext = createContext<FoldState | null>(null)

/**
 * A Stats panel that folds away to its heading. The panel inside draws its own heading with
 * [PanelHead], which carries the chevron; folded, everything under the heading is hidden. A panel
 * with nothing to show renders nothing, folded or not.
 */
export function Fold({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <FoldContext.Provider value={{ open, toggle: onToggle }}>
      <div className={`fold${open ? '' : ' closed'}`}>{children}</div>
    </FoldContext.Provider>
  )
}

/**
 * A panel's heading row. Inside a [Fold] the title folds the panel, and [closed] — a short line on
 * what's inside — shows while it's folded; anywhere else it's the plain heading.
 */
export function PanelHead({ title, closed, children }: { title: string; closed?: ReactNode; children?: ReactNode }) {
  const fold = useContext(FoldContext)
  if (!fold) return <div className="p-h"><h3>{title}</h3>{children}</div>
  return (
    <div className="p-h">
      <button type="button" className="p-fold" aria-expanded={fold.open} onClick={fold.toggle}>
        <h3>{title}</h3>
        <Icon name={fold.open ? 'expand_less' : 'expand_more'} aria-hidden />
      </button>
      {!fold.open && closed != null ? <span className="p-sub">{closed}</span> : children}
    </div>
  )
}
