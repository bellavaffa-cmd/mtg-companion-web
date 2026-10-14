// A binder's deck copies (collection/binderViews.ts): the copies of a printing that are in decks but
// sorted into this binder (or, in No binder, into none). They stay in their decks — the row says which
// ("In Talrand deck", "In 2 decks"), its deck chip opens it, and its menu changes only which binder
// they show in. The binder's steppers, selling, lending and picking act on its own copies only.
// Mirrors the Android app's ui/collection/BinderViewsUi.kt.

import { useState } from 'react'
import type { Collection } from '../types/models'
import { inDecksBadge, type DeckCopyRow } from './binderViews'
import { LocationChips } from './LocationChips'
import { ActionSheet } from '../components/ActionSheet'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { ArtImage, toArtCrop } from '../components/kit'

/** One printing's deck copies in a binder. [inNoBinder]: shown in No binder, so there's no binder to take it out of. */
export function DeckCopyCardRow({ row, inNoBinder, onOpenDeck, onMove, onTakeOut }: {
  row: DeckCopyRow
  inNoBinder: boolean
  onOpenDeck: (deckId: string) => void
  onMove: () => void
  onTakeOut: () => void
}) {
  const [menu, setMenu] = useState(false)
  const chips = row.decks.map(([id, name]) => ({ kind: 'deck' as const, qty: row.copies.filter((c) => c.deckId === id).reduce((n, c) => n + c.qty, 0), deck: name, deckId: id }))
  return (
    <div className="crow">
      <div className="thumb-wrap" onClick={() => onOpenDeck(row.decks[0][0])} style={{ cursor: 'pointer' }}>
        <ArtImage className="thumb" src={toArtCrop(row.imageUrl)} seed={row.name} />
        {row.backImageUrl && <span className="flip-badge"><Icon name="autorenew" /></span>}
      </div>
      <div className="cbody">
        <div className="cmain">
          <div className="cname">{row.name}</div>
          <div className="cmeta">
            <span className="dim">×{row.qty}</span>
            <span className="badge gold">{inDecksBadge(row.decks.map((d) => d[1]))}</span>
          </div>
        </div>
        {/* The deck chip, as a card row anywhere says it: "Talrand deck ×1" — tap to open the deck. */}
        <LocationChips chips={chips} actions={{ onDeck: onOpenDeck }} />
      </div>
      <button type="button" className="more" onClick={() => setMenu(true)} aria-label={`Actions for ${row.name}, in a deck`}>
        <Icon name="more_vert" style={{ fontSize: 20 }} />
      </button>
      {menu && (
        <ActionSheet
          title={row.name}
          subtitle="In a deck — this binder only shows it"
          imageUrl={row.imageUrl}
          actions={[
            ...row.decks.map(([id, name]) => ({ label: row.decks.length === 1 ? 'Open deck' : `Open ${name}`, icon: 'open_in_new', onClick: () => { setMenu(false); onOpenDeck(id) } })),
            { label: inNoBinder ? 'Put in a binder…' : 'Move to another binder…', icon: 'drive_file_move', detail: 'The card stays in its deck', onClick: () => { setMenu(false); onMove() } },
            ...(inNoBinder ? [] : [{ label: 'Take out of binder', icon: 'remove_circle_outline', detail: 'It shows in No binder instead; it stays in its deck', onClick: () => { setMenu(false); onTakeOut() } }]),
          ]}
          onClose={() => setMenu(false)}
        />
      )}
    </div>
  )
}

/** The binders to pick from, for a deck card's copies: [binders] A to Z. [onNone]: "Take out of binder". */
export function BinderPickDialog({ title, binders, note, onNone, onPick, onDismiss }: {
  title: string
  binders: Collection[]
  note?: string
  onNone?: () => void
  onPick: (binder: Collection) => void
  onDismiss: () => void
}) {
  return (
    <Dialog
      title={title}
      onDismiss={onDismiss}
      actions={
        <>
          {onNone && <button type="button" className="btn line" onClick={onNone}>Take out of binder</button>}
          <button type="button" className="btn line" onClick={onDismiss}>Cancel</button>
        </>
      }
    >
      {note && <p className="muted" style={{ marginTop: 0 }}>{note}</p>}
      {binders.length === 0 && <p className="dim">No binders yet — make one on the Collection's Binders tab.</p>}
      <div className="list">
        {binders.map((b) => (
          <button key={b.id} type="button" className="brow press" onClick={() => onPick(b)}>
            <div className="icon-tile"><Icon name="collections_bookmark" /></div>
            <div style={{ minWidth: 0 }}><div className="brow-name">{b.name}</div></div>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
