// New sets: Scryfall's sets coming out soon and just out (collection/newSets.ts), each to follow —
// a followed set gets a banner on Home the day it comes out — and one set's page: the cards Scryfall
// has shown so far that suit the user's Commander decks, and the ones on their Wishlist. Reached from
// the Collection home. Mirrors the Android app's ui/collection/NewSetsScreen.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ArtImage, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { isWishlist } from '../collection/wishlist'
import { today } from '../collection/valueHistory'
import type { SetInfo } from '../collection/setCompletion'
import {
  cardsLabel, commanderDecks, deckFits, deckProfile, fitReason, releaseLabel, releaseSets, wishlistReprints, type DeckFits, type SetCard,
} from '../collection/newSets'
import { commanderIdentities, loadReleaseSets, loadSetCards, setFollowed, useFollowed } from '../collection/newSetsStore'
import '../collection/newSets.css'

const longDay = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** The bell: follow a set to hear when it's out. */
function FollowButton({ set, followed }: { set: SetInfo; followed: boolean }) {
  return (
    <button
      type="button"
      className={`set-follow${followed ? ' on' : ''}`}
      aria-pressed={followed}
      aria-label={followed ? `Following ${set.name}` : `Follow ${set.name}`}
      title={followed ? "Following: you'll hear the day it's out" : "Follow: hear the day it's out"}
      onClick={(e) => { e.stopPropagation(); setFollowed(set, !followed) }}
    >
      <Icon name={followed ? 'notifications_active' : 'notifications'} />
    </button>
  )
}

export function NewSetsPage() {
  const back = useBack('/collections')
  const navigate = useNavigate()
  const { followed } = useFollowed()
  const [sets, setSets] = useState<SetInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    loadReleaseSets().then((s) => { if (!cancelled) setSets(s) }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [attempt])
  const now = today()
  const { upcoming, recent } = useMemo(() => releaseSets(sets ?? [], now), [sets, now])

  const row = (s: SetInfo) => (
    <div key={s.code} className="set-row">
      <button type="button" className="set-row-main press" onClick={() => navigate(`/new-sets/${s.code}`)}>
        {s.iconSvgUri ? <img className="set-icon" src={s.iconSvgUri} alt="" /> : <Icon name="new_releases" className="set-icon" aria-hidden />}
        <span className="set-row-text">
          <b>{s.name}</b>
          <span>{releaseLabel(s.releasedAt!, now)} · {longDay(s.releasedAt!)}</span>
          <span className="dim">{cardsLabel(s, now)}</span>
        </span>
      </button>
      <FollowButton set={s} followed={followed.has(s.code)} />
    </div>
  )

  return (
    <>
      <TopBar title="New sets" onBack={back} />
      <div className="content-scroll">
        <div className="narrow-width rise" style={rise(0)}>
          {failed ? (
            <EmptyState icon="cloud_off" text="Couldn't reach Scryfall for its sets." actions={[{ label: 'Try again', icon: 'refresh', onClick: () => setAttempt((a) => a + 1) }]} />
          ) : !sets ? (
            <p className="muted">Asking Scryfall for its sets…</p>
          ) : upcoming.length === 0 && recent.length === 0 ? (
            <EmptyState icon="new_releases" text="No sets coming out or just out right now." />
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Open a set for the cards that suit your Commander decks and the ones on your Wishlist. Follow one with the bell to hear the day it's out.</p>
              {recent.length > 0 && <><h2 className="set-head">Just out</h2><div className="set-list">{recent.map(row)}</div></>}
              {upcoming.length > 0 && <><h2 className="set-head">Coming soon</h2><div className="set-list">{upcoming.map(row)}</div></>}
            </>
          )}
          <p className="dim" style={{ fontSize: 12.5, marginTop: 20 }}>Sets and cards are Scryfall's, checked twice a day at most.</p>
        </div>
      </div>
    </>
  )
}

export function NewSetPage() {
  const { code = '' } = useParams<{ code: string }>()
  const back = useBack('/new-sets')
  const navigate = useNavigate()
  const { collections, decks } = useSync()
  const { followed } = useFollowed()
  const [set, setSet] = useState<SetInfo | null | undefined>(undefined)
  const [cards, setCards] = useState<SetCard[] | null>(null)
  const [identities, setIdentities] = useState<Map<string, string[]> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const commander = useMemo(() => commanderDecks(decks), [decks])
  const commanderKey = commander.map((d) => `${d.id}:${d.commander?.scryfallId}:${d.partnerCommander?.scryfallId ?? ''}`).join(',')
  const now = today()

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    loadReleaseSets()
      .then((all) => {
        if (cancelled) return
        const found = all.find((s) => s.code === code.toLowerCase()) ?? null
        setSet(found)
        if (!found || found.cardCount <= 0) return
        return loadSetCards(found.code).then((c) => { if (!cancelled) setCards(c) })
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [code, attempt])

  useEffect(() => {
    let cancelled = false
    if (commander.length === 0) { setIdentities(new Map()); return }
    commanderIdentities(commander).then((m) => { if (!cancelled) setIdentities(m) }).catch(() => { if (!cancelled) setIdentities(new Map()) })
    return () => { cancelled = true }
    // commanderKey stands for the decks' commanders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderKey])

  const fits: DeckFits[] = useMemo(() => {
    if (!cards || !identities) return []
    return commander.flatMap((d) => {
      const identity = identities.get(d.id)
      if (!identity) return []
      const found = deckFits(deckProfile(d, identity), cards)
      return found.length > 0 ? [{ deckId: d.id, deckName: d.name, fits: found }] : []
    })
  }, [cards, identities, commander])
  const wanted = useMemo(() => {
    const names = new Set((collections.find(isWishlist)?.entries ?? []).map((e) => e.name.trim().toLowerCase()))
    return cards ? wishlistReprints(names, cards) : []
  }, [cards, collections])

  const open = (c: SetCard) => navigate(`/card/${encodeURIComponent(c.name)}?id=${c.id}`)
  const cardRow = (c: SetCard, why: string) => (
    <button key={c.id} type="button" className="crow read-only press set-card" onClick={() => open(c)}>
      <ArtImage className="thumb" src={toArtCrop(c.imageUrl)} seed={c.name} colors={c.colorIdentity} />
      <div className="cmain">
        <div className="cname">{c.name}</div>
        <div className="cmeta"><span className="dim">{why}</span></div>
      </div>
    </button>
  )

  return (
    <>
      <TopBar title={set?.name ?? 'New set'} onBack={back} actions={set ? <FollowButton set={set} followed={followed.has(set.code)} /> : undefined} />
      <div className="content-scroll">
        <div className="narrow-width rise" style={rise(0)}>
          {failed ? (
            <EmptyState icon="cloud_off" text="Couldn't reach Scryfall for this set." actions={[{ label: 'Try again', icon: 'refresh', onClick: () => setAttempt((a) => a + 1) }]} />
          ) : set === undefined ? (
            <p className="muted">Asking Scryfall…</p>
          ) : set === null ? (
            <EmptyState icon="new_releases" text="This set isn't coming out soon or just out." actions={[{ label: 'New sets', icon: 'new_releases', to: '/new-sets' }]} />
          ) : (
            <>
              <p className="set-when">{releaseLabel(set.releasedAt!, now)} · {longDay(set.releasedAt!)} · {cardsLabel(set, now)}</p>
              <p className="dim" style={{ fontSize: 12.5 }}>
                {followed.has(set.code) ? "You're following it: Home says so the day it's out." : "Follow it with the bell to hear the day it's out."}
              </p>
              {set.cardCount <= 0 ? (
                <p className="muted">No cards shown yet. Scryfall adds them as they're previewed — come back closer to the release.</p>
              ) : !cards || !identities ? (
                <p className="muted">Looking through the set's cards…</p>
              ) : (
                <>
                  <h2 className="set-head">Cards for your decks</h2>
                  {commander.length === 0 ? (
                    <p className="muted">No Commander decks yet: once you have one, the cards that suit it show here.</p>
                  ) : fits.length === 0 ? (
                    <p className="muted">None of the cards shown so far suit your Commander decks.</p>
                  ) : fits.map((f) => (
                    <section key={f.deckId} className="set-deck">
                      <button type="button" className="link set-deck-name" onClick={() => navigate(`/decks/${f.deckId}`)}>{f.deckName}</button>
                      <div className="list">{f.fits.map((fit) => cardRow(fit.card, fitReason(fit)))}</div>
                    </section>
                  ))}
                  <p className="dim" style={{ fontSize: 12.5 }}>
                    A card suits a deck when it's in the commander's colours and shares a theme, category or creature type with at least four of the deck's cards.
                  </p>
                  <h2 className="set-head">On your Wishlist</h2>
                  {wanted.length === 0
                    ? <p className="muted">None of the cards shown so far are on your Wishlist.</p>
                    : <div className="list">{wanted.map((c) => cardRow(c, 'A new printing of a card on your Wishlist'))}</div>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
