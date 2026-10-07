import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { useMoney } from '../money/currency'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { ActionSheet } from '../components/ActionSheet'
import { PageHeader, SectionHeader, rise, useBack } from '../components/kit'
import { useCardData } from '../collection/cardData'
import { PLACE_ICONS } from '../collection/StorageTab'
import { placesOf, placeTree, savePlace } from '../collection/storagePlaces'
import { useOverview } from '../social/SocialContext'
import { Avatar } from '../social/ui'
import { HouseholdInvites } from '../social/HouseholdInvites'
import {
  cancelHouseholdInvite, createHousehold, householdCards, householdError, householdLoanReturned, inviteToHousehold, joinHouseholdPlace,
  leaveHousehold, shareHouseholdPlace, unshareHouseholdPlace, useHouseholds,
} from '../social/household'
import {
  DEFAULT_HOUSEHOLD_NAME, deckNote, HOUSEHOLD_UNAVAILABLE, householdIntro, invitedOf, membersOf, myShelfCopies, peopleTotals, placeContents,
  placeLines, shelfLoanLine, type Household, type HouseholdCards, type ShelfCopy,
} from '../social/householdLogic'
import '../collection/storage.css'
import '../social/household.css'
import { bumpAreas } from '../social/liveChanges'

const count = (n: number) => n.toLocaleString('en-GB')

/**
 * Sharing storage at home, the Android app's HouseholdScreen: a household of friends who keep cards on
 * the same shelf, each still owning their own (social/householdLogic.ts). Each person's copies and
 * their value; each shared place with how many each person keeps there — someone else's place reads
 * "you can see, not change"; how pull lists ask them for cards; Stop sharing and Invite someone.
 * At /collections/household (the user's households and invitations) and /collections/household/:id.
 */
export function HouseholdPage() {
  const { id } = useParams<{ id: string }>()
  const back = useBack('/collections?tab=storage')
  const navigate = useNavigate()
  const { state, reload } = useHouseholds()
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  if (state.kind !== 'ready') {
    const text = state.kind === 'signed-out' ? 'Sign in to share storage with someone you live with.'
      : state.kind === 'unavailable' ? HOUSEHOLD_UNAVAILABLE
        : state.kind === 'error' ? state.message : 'Loading…'
    return (
      <>
        <PageHeader title="Sharing storage at home" onBack={back} />
        <div className="content-scroll"><div className="empty-state"><Icon name="shelves" /><div>{text}</div></div></div>
      </>
    )
  }
  const { households, invites } = state.data
  const h = id ? households.find((x) => x.id === id) : households.length === 1 && invites.length === 0 ? households[0] : null
  if (h) return <HouseholdView household={h} reload={reload} />

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const newId = await createHousehold(DEFAULT_HOUSEHOLD_NAME)
      await reload()
      navigate(`/collections/household/${newId}`, { replace: true })
    } catch (e) {
      setError(householdError(e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <PageHeader title="Sharing storage at home" onBack={back} />
      <div className="content-scroll hh-page">
        <p className="hh-intro rise" style={rise(1)}>
          Keep cards on the same shelf as someone you live with. Each of you still owns your own cards: they see what you keep in the places you share, and can't change it.
        </p>
        {id && <div className="notice" style={{ marginTop: 12 }}>You're not sharing that shelf any more.</div>}
        {invites.length > 0 && <SectionHeader title="Asked to share" />}
        <HouseholdInvites invites={invites} onDone={async (accepted) => { await reload(); if (accepted) navigate(`/collections/household/${accepted}`) }} />
        {households.length > 0 && <SectionHeader title="Your shared shelves" />}
        <div className="hh-places">
          {households.map((x) => (
            <button key={x.id} type="button" className="hh-place hh-place-row press" onClick={() => navigate(`/collections/household/${x.id}`)}>
              <Icon name="shelves" className="storage-icon" />
              <span className="t"><b>{x.name}</b><span>{membersOf(x, '').map((m) => m.profile!.display_name).join(', ')}</span></span>
              <Icon name="chevron_right" aria-hidden />
            </button>
          ))}
        </div>
        {households.length === 0 && (
          <div className="place-actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn gold" disabled={starting} onClick={() => void start()}><Icon name="add" aria-hidden />Start sharing</button>
          </div>
        )}
        {error && <div className="hh-error">{error}</div>}
      </div>
    </>
  )
}

function HouseholdView({ household: h, reload }: { household: Household; reload: () => Promise<void> }) {
  const back = useBack('/collections?tab=storage')
  const navigate = useNavigate()
  const money = useMoney()
  const { collections, changeStorage, account } = useSync()
  const me = account?.userId ?? ''
  const { overview } = useOverview()
  const [cards, setCards] = useState<HouseholdCards | null>(null)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCards = useCallback(async () => {
    try { setCards(await householdCards(h.id)); setCardsError(null) } catch (e) { setCardsError(householdError(e)) }
  }, [h.id])
  useEffect(() => { void loadCards() }, [loadCards])

  const shared = useMemo(() => h.places.filter((p) => p.users.includes(me)).map((p) => p.placeId), [h, me])
  const copies: ShelfCopy[] = useMemo(() => [...myShelfCopies(collections, shared, me), ...(cards?.copies ?? [])], [collections, shared, me, cards])
  const data = useCardData([...new Set(copies.map((c) => c.scryfallId))])
  const price = (c: ShelfCopy): number | null => {
    const p = data?.get(c.scryfallId)?.prices
    if (!p) return null
    const n = Number(c.foil ? p.usd_foil ?? p.usd : p.usd ?? p.usd_foil)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const totals = peopleTotals(h, me, copies, price)
  const lines = placeLines(h, me, copies)
  const myPlaces = placesOf(collections)
  const unshared = placeTree(myPlaces).filter((n) => !h.places.some((p) => p.placeId === n.place.id))
  const inHousehold = new Set(h.members.map((m) => m.profile?.user_id))
  const friends = (overview?.friends ?? []).filter((f) => f.status === 'accepted' && !inHousehold.has(f.user_id))
  const loans = (cards?.loans ?? []).filter((l) => l.lender === me || l.borrower === me)

  const act = async (run: () => Promise<unknown>) => {
    setError(null)
    try { await run(); bumpAreas('household'); await reload(); await loadCards() } catch (e) { setError(householdError(e)) }
  }
  // "Keep my cards here too": the place goes in the user's own storage (same id), then the household is told.
  const join = (placeId: string) => act(async () => {
    const p = h.places.find((x) => x.placeId === placeId)
    if (!p) return
    if (!myPlaces.some((x) => x.id === placeId)) changeStorage((c) => savePlace(c, { id: p.placeId, name: p.name, kind: p.kind, createdAt: Date.now() }))
    await joinHouseholdPlace(h.id, placeId)
  })

  return (
    <>
      <PageHeader title={h.name} onBack={back} />
      <div className="content-scroll hh-page">
        <p className="hh-intro rise" style={rise(1)}>{householdIntro(h, me)}</p>

        <div className="hh-people rise" style={rise(2)}>
          {totals.map((t) => (
            <div key={t.userId} className="hh-person">
              <span className="who">{t.label}</span>
              <span className="n">{count(t.copies)}</span>
              <span className="sub">{t.copies === 1 ? 'copy' : 'copies'}{t.usd !== null ? ` · ${money.format(t.usd, true)}` : ''}</span>
            </div>
          ))}
        </div>
        {cardsError && <div className="hh-error" style={{ marginTop: 8 }}>{cardsError}</div>}

        <div className="hh-places rise" style={rise(3)}>
          {lines.map((l) => (
            <div key={l.place.placeId} className="hh-place">
              <button type="button" className="hh-place-row" aria-expanded={open === l.place.placeId} onClick={() => setOpen(open === l.place.placeId ? null : l.place.placeId)}>
                <span className="t"><b>{l.place.name}</b><span>{l.line}</span></span>
                <Icon name={open === l.place.placeId ? 'expand_less' : 'expand_more'} aria-hidden />
              </button>
              {open === l.place.placeId && (
                <div className="hh-place-body">
                  {placeContents(h, me, l.place.placeId, copies).map((g) => (
                    <div key={g.userId}>
                      <h3>{g.name === 'You' ? 'Yours' : `${g.name}'s`}{g.userId !== me ? ' · you can see, not change' : ''}</h3>
                      {g.copies.slice(0, 200).map((c) => (
                        <div key={`${c.scryfallId}|${c.foil}`} className="hh-card">
                          <span>{c.name}{c.foil ? <span className="dim"> · foil</span> : null}</span>
                          <span className="dim">×{c.qty}</span>
                        </div>
                      ))}
                      {g.copies.length > 200 && <div className="dim">and {g.copies.length - 200} more</div>}
                    </div>
                  ))}
                  {placeContents(h, me, l.place.placeId, copies).length === 0 && <div className="dim">Nothing kept here yet.</div>}
                  <div className="hh-row-actions">
                    {!l.readOnly && myPlaces.some((p) => p.id === l.place.placeId) && (
                      <button type="button" className="btn line sm" onClick={() => navigate(`/collections/place/${l.place.placeId}`)}>Open</button>
                    )}
                    {l.canJoin && <button type="button" className="btn line sm" onClick={() => void join(l.place.placeId)}>Keep my cards here too</button>}
                    {l.mine && <button type="button" className="btn line sm" onClick={() => void act(() => unshareHouseholdPlace(h.id, l.place.placeId))}>Stop sharing this place</button>}
                    {!l.mine && !l.readOnly && <button type="button" className="btn line sm" onClick={() => void act(() => unshareHouseholdPlace(h.id, l.place.placeId))}>Take my cards off</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="btn line" onClick={() => setSharing(true)} disabled={unshared.length === 0}>
            <Icon name="add" aria-hidden />{myPlaces.length === 0 ? 'Make a place in Storage first' : 'Share a place'}
          </button>
        </div>

        <section className="hh-note rise" style={rise(4)}>
          <h2>When you build a deck</h2>
          <div>{deckNote(h, me)}</div>
        </section>

        {loans.length > 0 && (
          <>
            <SectionHeader title="Borrowed from the shelf" />
            <div className="hh-places">
              {loans.map((l) => (
                <div key={l.id} className="hh-place hh-place-row">
                  <span className="t"><b>{shelfLoanLine(h, me, l)}</b><span>{l.cards.map((c) => (c.qty > 1 ? `${c.name} ×${c.qty}` : c.name)).join(', ')}</span></span>
                  <button type="button" className="btn line sm" onClick={() => void act(() => householdLoanReturned(l.id))}>{l.lender === me ? 'Got them back' : 'Gave them back'}</button>
                </div>
              ))}
            </div>
          </>
        )}

        {invitedOf(h).length > 0 && (
          <>
            <SectionHeader title="Asked, waiting for an answer" />
            <div className="list">
              {invitedOf(h).map((m) => (
                <div key={m.profile!.user_id} className="person-row">
                  <Avatar profile={m.profile} size={44} />
                  <span className="person-main"><span className="person-name">{m.profile!.display_name}</span></span>
                  <button type="button" className="btn line sm" onClick={() => void act(() => cancelHouseholdInvite(h.id, m.profile!.user_id))}>Cancel</button>
                </div>
              ))}
            </div>
          </>
        )}
        {error && <div className="hh-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="pull-bar hh-bar">
        <button type="button" className="btn line" onClick={() => setLeaving(true)}>Stop sharing</button>
        <button type="button" className="btn gold" onClick={() => setInviting(true)}>Invite someone</button>
      </div>

      {inviting && (
        <ActionSheet
          title="Invite someone"
          subtitle={friends.length === 0 ? 'Add them as a friend first: invitations go to friends.' : 'They see what you keep in the places you share, and can’t change it.'}
          actions={friends.map((f) => {
            const p = overview?.people[f.user_id] ?? null
            return { label: p?.display_name ?? 'Someone', icon: 'person_add', detail: p ? `@${p.username}` : undefined, onClick: () => { setInviting(false); void act(() => inviteToHousehold(h.id, f.user_id)) } }
          })}
          onClose={() => setInviting(false)}
        />
      )}
      {sharing && (
        <ActionSheet
          title="Share a place"
          subtitle="The people here see the cards you keep in it. They can't change them."
          actions={unshared.map((n) => ({
            label: `${'  '.repeat(n.depth)}${n.place.name}`,
            icon: PLACE_ICONS[n.place.kind],
            onClick: () => { setSharing(false); void act(() => shareHouseholdPlace(h.id, n.place)) },
          }))}
          onClose={() => setSharing(false)}
        />
      )}
      {leaving && (
        <Dialog
          title="Stop sharing?"
          onDismiss={() => setLeaving(false)}
          actions={
            <>
              <button type="button" className="btn line" onClick={() => setLeaving(false)}>Keep sharing</button>
              <button type="button" className="btn gold" onClick={() => { setLeaving(false); void leaveHousehold(h.id).then(() => reload()).then(() => navigate('/collections?tab=storage')).catch((e: unknown) => setError(householdError(e))) }}>Stop sharing</button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            Your cards stay yours and where they are. The others stop seeing what you keep in the shared places, and you stop seeing theirs.
          </p>
        </Dialog>
      )}
    </>
  )
}
