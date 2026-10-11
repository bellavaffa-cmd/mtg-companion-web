import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader, useBack } from '../components/kit'
import { metaLine, pulledCopies, type PullRow } from '../collection/pullList'
import { setWalkTicks, useWalkSession } from '../collection/walkSession'
import '../collection/storage.css'

/**
 * "Walk this list": what a filtered place or the Storage tab found, as a pull list — place by place,
 * section by section, page and pocket — ticked off by hand or with the scanner (/scan?walk=1). The
 * deck pull list's look (PullListPage.tsx); the list is collection/walkSession.ts's. At
 * /collections/walk. The Android app's WalkListScreen.
 */
export function WalkListPage() {
  const navigate = useNavigate()
  const back = useBack('/collections?tab=storage')
  const walk = useWalkSession()
  if (!walk) {
    return (
      <>
        <PageHeader title="Walk this list" onBack={back} />
        <div className="content-scroll"><div className="dim">Nothing to walk: search or filter a place, or the Storage tab, then choose Walk this list.</div></div>
      </>
    )
  }
  const { list, ticked } = walk
  const all = list.groups.flatMap((g) => g.rows)
  const pulled = pulledCopies(all, ticked)
  const toggle = (r: PullRow) => {
    const next = new Set(ticked)
    if (next.has(r.key)) next.delete(r.key)
    else next.add(r.key)
    setWalkTicks(next)
  }
  return (
    <>
      <PageHeader title="Walk this list" eyebrow={walk.title} onBack={back} />
      <div className="content-scroll pull-page">
        <div className="storage-progress">
          <div className="pull-progress-h"><b>{pulled} of {list.total} found</b><span>{list.places} {list.places === 1 ? 'place' : 'places'}</span></div>
          <div className="storage-bar"><div style={{ width: `${list.total ? Math.round((pulled / list.total) * 100) : 0}%` }} /></div>
        </div>
        <div className="pull-groups">
          {all.length === 0 && <div className="dim">No cards in places match.</div>}
          {list.groups.map((g) => (
            <section key={g.key} className="pull-group">
              <div className="pull-group-h">
                <h2>{g.title}</h2>
                <span>{metaLine([g.detail, `${pulledCopies(g.rows, ticked)} of ${g.rows.reduce((n, r) => n + r.qty, 0)}`])}</span>
              </div>
              {g.rows.map((r) => (
                <label key={r.key} className={`pull-row${ticked.has(r.key) ? ' done' : ''}`}>
                  <input type="checkbox" checked={ticked.has(r.key)} onChange={() => toggle(r)} />
                  <span className="nm">{r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}</span>
                  {r.hint && <span className="hint">{r.hint}</span>}
                </label>
              ))}
            </section>
          ))}
          <div className="dim" style={{ fontSize: 12 }}>Ticks only say you've found them; nothing moves. The list is kept until you close the app.</div>
        </div>
        <div className="pull-bar" style={{ marginTop: 16 }}>
          <button type="button" className="btn gold" disabled={all.length === 0} onClick={() => navigate('/scan?walk=1')}><Icon name="document_scanner" aria-hidden />Scan to tick</button>
          {ticked.size > 0 && <button type="button" className="btn line" onClick={() => setWalkTicks(new Set())}>Untick all</button>}
        </div>
      </div>
    </>
  )
}
