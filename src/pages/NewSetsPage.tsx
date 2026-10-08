// New sets: Scryfall's sets coming out soon and just out (collection/newSets.ts), each to follow —
// a followed set gets a banner on Home the day it comes out — and one set's page: its spoilers — the
// cards revealed so far, newest first, each to want before release and with the decks it fits
// (collection/SpoilersUi.tsx, collection/spoilers.ts) — the cards that suit each of the user's
// Commander decks best, and the ones on their Wishlist. Reached from the Collection home. Mirrors the Android app's ui/collection/NewSetsScreen.kt.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ArtImage, PillChip, rise, toArtCrop, useBack } from '../components/kit'
import { useSync } from '../sync/SyncContext'
import { isWishlist } from '../collection/wishlist'
import { today } from '../collection/valueHistory'
import type { SetInfo } from '../collection/setCompletion'
import {
  commanderDecks, deckFits, fitReason, releaseLabel, releaseSets, wishlistReprints, type DeckFits, type SetCard,
} from '../collection/newSets'
import { commanderIdentities, loadReleaseSets, loadSetCards, markRevealsSeen, profileOf, setFollowed, useFollowed } from '../collection/newSetsStore'
import {
  fitsByCard, galleryCards, isConsidering, openingPacks, releaseCountdown, revealedLabel, wantedCount, withConsideredCard, withSpoilerWant, type DeckMatch,
} from '../collection/spoilers'
import { SpoilerTile } from '../collection/SpoilersUi'
import { useRoleTags } from '../tags/roleTags'
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
          <span className="dim">{revealedLabel(s, now)}</span>
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
              <p className="muted" style={{ marginTop: 0 }}>Open a set for its spoilers: the cards revealed so far, which of your decks each would fit, and Want to put one on your Wishlist before it's out. Follow a set with the bell to hear the day it's out and when cards for your decks are revealed.</p>
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

/** Revealed cards shown at first, and how many more each "Show more" adds. */
const GALLERY_PAGE = 24

export function NewSetPage() {
  const { code = '' } = useParams<{ code: string }>()
  const back = useBack('/new-sets')
  const navigate = useNavigate()
  const { collections, decks, changeStorage, changeDecksAndStorage } = useSync()
  const { followed } = useFollowed()
  const [set, setSet] = useState<SetInfo | null | undefined>(undefined)
  const [cards, setCards] = useState<SetCard[] | null>(null)
  const [identities, setIdentities] = useState<Map<string, string[]> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [onlyMine, setOnlyMine] = useState(false)
  const [shown, setShown] = useState(GALLERY_PAGE)
  const commander = useMemo(() => commanderDecks(decks), [decks])
  const commanderKey = commander.map((d) => `${d.id}:${d.commander?.scryfallId}:${d.partnerCommander?.scryfallId ?? ''}`).join(',')
  const now = today()
  // The decks' role tags (Mana ramp, Card draw…), for matching: looked up once a month at most.
  const deckNames = useMemo(() => commander.flatMap((d) => d.cards.map((c) => c.name)), [commander])
  const { tags: roleTags } = useRoleTags(deckNames)

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

  const profiles = useMemo(() => {
    if (!identities) return []
    return commander.flatMap((d) => {
      const identity = identities.get(d.id)
      return identity ? [profileOf(d, identity)] : []
    })
    // roleTags: more of the decks' role tags became known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identities, commander, roleTags])
  const fits: DeckFits[] = useMemo(() => {
    if (!cards) return []
    return profiles.flatMap((p) => {
      const found = deckFits(p, cards)
      return found.length > 0 ? [{ deckId: p.deckId, deckName: p.deckName, fits: found }] : []
    })
  }, [cards, profiles])
  const fitMap = useMemo(() => (cards ? fitsByCard(cards, profiles, now) : new Map<string, DeckMatch[]>()), [cards, profiles, now])
  const gallery = useMemo(() => (cards ? galleryCards(cards, fitMap, onlyMine) : []), [cards, fitMap, onlyMine])
  const packs = useMemo(() => (cards ? openingPacks(collections, cards) : []), [cards, collections])
  const wanted = useMemo(() => {
    const names = new Set((collections.find(isWishlist)?.entries ?? []).map((e) => e.name.trim().toLowerCase()))
    return cards ? wishlistReprints(names, cards) : []
  }, [cards, collections])
  // What fits now has been seen: the daily news only tells of cards revealed after this.
  const isFollowed = followed.has(code.toLowerCase())
  useEffect(() => {
    if (isFollowed && cards && identities) markRevealsSeen(code.toLowerCase(), fitMap.keys())
  }, [isFollowed, cards, identities, fitMap, code])

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
              <p className="set-when">{releaseCountdown(set.releasedAt, now) ?? releaseLabel(set.releasedAt!, now)} · {longDay(set.releasedAt!)} · {revealedLabel(set, now)}</p>
              <p className="dim" style={{ fontSize: 12.5 }}>
                {followed.has(set.code)
                  ? "You're following it: Home says so the day it's out, and (once a day at most) when cards that fit your decks are revealed."
                  : "Follow it with the bell to hear the day it's out, and when cards that fit your decks are revealed."}
              </p>
              {set.cardCount <= 0 ? (
                <p className="muted">No cards revealed yet. Scryfall adds them as they're previewed — come back closer to the release.</p>
              ) : !cards || !identities ? (
                <p className="muted">Looking through the set's cards…</p>
              ) : (
                <>
                  {packs.length > 0 && (
                    <button type="button" className="btn line block" style={{ marginTop: 8 }} onClick={() => navigate(`/new-sets/${set.code}/packs`)}>
                      <Icon name="inventory_2" />Opening packs · {packs.length} wanted {packs.length === 1 ? 'card' : 'cards'}
                    </button>
                  )}
                  <h2 className="set-head">Revealed so far</h2>
                  <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    {profiles.length > 0 && (
                      <PillChip label="Only cards for my decks" selected={onlyMine} onClick={() => { setOnlyMine((o) => !o); setShown(GALLERY_PAGE) }} />
                    )}
                    <span className="dim" style={{ fontSize: 12.5 }}>{gallery.length} {gallery.length === 1 ? 'card' : 'cards'}</span>
                  </div>
                  {commander.length === 0 && <p className="muted">No Commander decks yet: once you have one, each card says which decks it would fit.</p>}
                  {gallery.length === 0 && <p className="muted">{onlyMine ? 'None of the cards revealed so far fit your Commander decks.' : 'No cards revealed yet.'}</p>}
                  <div className="spoiler-grid">
                    {gallery.slice(0, shown).map((c) => {
                      const cardFitsHere = fitMap.get(c.id) ?? []
                      return (
                        <SpoilerTile
                          key={c.id}
                          card={c}
                          set={set}
                          now={now}
                          want={wantedCount(collections, c.id)}
                          fits={cardFitsHere}
                          considering={new Set(cardFitsHere.filter((m) => isConsidering(decks.find((d) => d.id === m.deckId), c)).map((m) => m.deckId))}
                          onOpen={() => open(c)}
                          onWant={(n) => changeStorage((cs) => withSpoilerWant(cs, c, n, set.releasedAt, today()))}
                          onConsider={(m) => changeDecksAndStorage((cs, ds) => ({ collections: cs, decks: withConsideredCard(ds, m.deckId, c) }))}
                        />
                      )
                    })}
                  </div>
                  {gallery.length > shown && (
                    <button type="button" className="btn line block" style={{ marginTop: 10 }} onClick={() => setShown((s) => s + GALLERY_PAGE)}>
                      Show more ({gallery.length - shown} left)
                    </button>
                  )}
                  <p className="dim" style={{ fontSize: 12.5 }}>
                    Newest revealed first. A card fits a deck when it's in the commander's colours, legal in Commander once it's out, and shares a theme, role (Mana ramp, Removal…), category or creature type with at least four of the deck's cards. Tap a deck to put the card on its Considering list. Wanted cards go on your Wishlist and show "Releases in …" until the set is out; then their price fills in and your Wishlist price targets apply.
                  </p>
                  <h2 className="set-head">Best for each deck</h2>
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
