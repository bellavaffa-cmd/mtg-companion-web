import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { EmptyState } from '../components/EmptyState'
import { ArtImage, PageHeader, rise, toArtCrop, useBack, useLayoutSize } from '../components/kit'
import { gradedOf, gradedWhereLabel, gradeLabel } from '../collection/graded'
import '../collection/storage.css'

/**
 * Every graded copy (graded.ts), from the Collection's Storage tab: the card, its slab ("PSA 10"), what
 * it's worth as the user entered it and where it's kept, the dearest first. A slab opens its card's page
 * (where it can be changed). At /collections/graded-list. The Android app's GradedListScreen.kt.
 */
export function GradedListPage() {
  const { collections } = useSync()
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const money = useMoney()
  const wide = useLayoutSize() !== 'phone'
  const graded = useMemo(
    () => [...gradedOf(collections)].sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    [collections],
  )
  const total = graded.reduce((n, g) => n + (g.valueUsd ?? 0), 0)
  return (
    <>
      <PageHeader
        title="Graded cards"
        eyebrow={graded.length > 0 ? `${graded.length} ${graded.length === 1 ? 'slab' : 'slabs'}${total > 0 ? ` · ${money.format(total, true)}` : ''}` : undefined}
        onBack={back}
      />
      <div className={`content-scroll${wide ? '' : ' with-nav'}`}>
        {graded.length === 0 ? (
          <EmptyState icon="verified" text="No graded cards yet. On a card's page, Where it is › Mark a copy as graded." />
        ) : (
          <div className="storage-list">
            {graded.map((g, i) => (
              <button key={g.id} type="button" className="storage-row storage-card press rise" style={rise(Math.min(i, 8) + 1)} onClick={() => navigate(`/card/${encodeURIComponent(g.name)}`)}>
                <ArtImage className="thumb" src={toArtCrop(g.imageUrl ?? null)} seed={g.name} />
                <div className="storage-text">
                  <b>{g.name}{g.foil ? ' · foil' : ''}</b>
                  <span style={{ color: 'var(--gold)' }}>{[gradeLabel(g), g.cert ? `cert ${g.cert}` : ''].filter(Boolean).join(' · ')}</span>
                  <span>{gradedWhereLabel(collections, g)}</span>
                </div>
                <span className="storage-n">{g.valueUsd != null ? money.format(g.valueUsd, true) : '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
