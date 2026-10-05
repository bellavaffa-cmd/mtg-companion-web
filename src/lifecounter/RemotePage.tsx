import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { forgetSeat, rememberSeat } from './seat'
import { useNavigate, useParams } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { accessToken } from '../sync/supabaseAuth'
import { watchMatch } from '../sync/realtime'
import * as api from '../social/api'
import { useOverview } from '../social/SocialContext'
import { GiphyPicker } from '../social/GiphyPicker'
import { autocomplete, getByExactName, getRulings, type Ruling } from '../api/scryfall'
import { displayImageUrl, displayOracleText } from '../types/scryfall'
import { toArtCrop } from '../components/kit'
import type { Deck, GameResult } from '../types/models'
import { COUNTER_INFO, EMOTES, announceText, useAnnouncement, type EmoteId } from './game'
import { isMaxSpeed, ringAbilities } from './counterRules'
import { VenturePanel } from './DungeonMap'
import { mulliganText } from '../decks/mulligans'
import { useStepper } from './PlayerTile'
import { useWakeLock } from './wakeLock'
import { HEARTBEAT_MS, REMOTE_COUNTERS, REMOTE_DICE, parseRemoteState, type RemoteAction, type RemoteSeat, type RemoteState } from './remote'
import { useSeatDeckInfo } from './seatDeck'
import { deckInfoAction, formatClock, reminderLines, tokenLabel, turnTimerText, type RemoteTurnTimer, type SeatDeckInfo } from './tableExtras'
import { useNow } from './useNow'
import '../social/social.css'
import './remote.css'
import { activeDecks } from '../decks/deckFolders'
import { useModalFocus } from '../components/useModalFocus'

/** No word from the table for this long (it publishes at least every HEARTBEAT_MS): it's gone. */
const SILENT_MS = HEARTBEAT_MS * 2 + 10_000
const FEEDBACK_HOLD_MS = 1500

type Sheet = null | 'damage' | 'counters' | 'background' | 'more' | 'deck' | 'show' | 'lookup' | 'notes' | 'table' | 'emote' | 'target' | 'tokens' | 'concede'
type BackgroundKind = 'commander' | 'profile' | 'colour' | 'custom'

/** What the player chose for their tile last time, so the next table starts with it. */
interface RemotePrefs { background: BackgroundKind; customUrl: string | null; deckId: string | null }
const PREFS_KEY = 'mtgweb_remote_prefs'
const LOGGED_KEY = 'mtgweb_remote_logged'
/** Settings on this phone: buzz when the turn comes here, and show the deck's start-of-turn cards. */
const TURN_BUZZ_KEY = 'mtgweb_remote_turn_buzz'
const REMINDERS_KEY = 'mtgweb_remote_trigger_reminders'
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) !== 'false' } catch { return true }
}
function writeFlag(key: string, on: boolean) {
  try { localStorage.setItem(key, String(on)) } catch { /* this visit only */ }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: not remembered */ }
}
const hasSavedPrefs = () => {
  try { return localStorage.getItem(PREFS_KEY) !== null } catch { return false }
}
function readText(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

const commanderArt = (deck: Deck | undefined | null) => toArtCrop(deck?.commander?.imageUrl ?? null)
/** The deck's commander, "A & B" with a partner — what the other players' records will say they faced. */
const commanderOf = (deck: Deck | undefined | null) =>
  [deck?.commander?.name, deck?.partnerCommander?.name].filter(Boolean).join(' & ') || null

/**
 * A player's phone as the remote for their seat at someone's life counter (opened after joining a
 * seat by QR code): their life, counters and commander damage, whose turn it is, and everyone's
 * life. Every change is a request the table applies — the table's game is the one truth.
 */
export function RemotePage() {
  const { matchId = '', seat = '' } = useParams<{ matchId: string; seat: string }>()
  const seatNo = Number(seat)
  const navigate = useNavigate()
  const { account, decks, addGameResult } = useSync()
  const { overview } = useOverview()
  const me = overview?.me ?? null
  useWakeLock()

  const [state, setState] = useState<RemoteState | null>(null)
  const [live, setLive] = useState(false)
  const [heardAt, setHeardAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [big, setBig] = useState(false)
  const [prefs, setPrefsState] = useState<RemotePrefs>(() => readJson(PREFS_KEY, { background: 'profile', customUrl: null, deckId: null }))
  const setPrefs = (next: RemotePrefs) => { setPrefsState(next); writeJson(PREFS_KEY, next) }
  const deck = decks.find((d) => d.id === prefs.deckId) ?? null
  const deckInfo = useSeatDeckInfo(deck)
  const [turnBuzz, setTurnBuzzState] = useState(() => readFlag(TURN_BUZZ_KEY))
  const setTurnBuzz = (on: boolean) => { setTurnBuzzState(on); writeFlag(TURN_BUZZ_KEY, on) }
  const [remindersOn, setRemindersOnState] = useState(() => readFlag(REMINDERS_KEY))
  const [reminder, setReminder] = useState<string[]>([])
  const setRemindersOn = (on: boolean) => { setRemindersOnState(on); writeFlag(REMINDERS_KEY, on); if (!on) setReminder([]) }

  useEffect(() => {
    document.title = 'Remote · Manabind'
    return () => { document.title = 'Manabind' }
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(t)
  }, [])

  const send = useCallback((action: RemoteAction) => {
    setError(null)
    api.sendMatchAction(matchId, action).catch((e: unknown) => {
      if (e instanceof api.SocialError && e.code === 'not_seated') setGone(true)
      else setError(e instanceof Error ? e.message : 'Something went wrong.')
    })
  }, [matchId])

  useEffect(() => {
    if (!account || !matchId) return
    return watchMatch(
      matchId,
      accessToken,
      (event, payload) => {
        if (event !== 'state') return
        const next = parseRemoteState((payload as { state?: unknown } | null)?.state)
        if (!next) return
        setState(next)
        setHeardAt(Date.now())
      },
      () => send({ type: 'hello' }),
      setLive,
    )
  }, [account, matchId, send])

  const mine = state?.players.find((p) => p.seat === seatNo) ?? null
  const others = state?.players.filter((p) => p.seat !== seatNo) ?? []
  const announce = useAnnouncement(state?.announce ?? null)
  const nameOfSeat = (s: number) => state?.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`

  // A buzz when the turn comes round to this seat — not for the turn it already was on arrival.
  const lastTurn = useRef<string | null>(null)
  const turnKey = state?.turn ? `${state.gameId}:${state.turn.number}:${state.turn.seat}` : null
  useEffect(() => {
    if (!turnKey) return
    const was = lastTurn.current
    lastTurn.current = turnKey
    if (was !== null && was !== turnKey && state?.turn?.seat === seatNo && turnBuzz) navigator.vibrate?.([60, 40, 60])
  }, [turnKey, state?.turn?.seat, seatNo, turnBuzz])

  // At the start of this seat's turn, the deck's "at the beginning of your …" cards, until they're
  // put away or the turn passes.
  const turnSeat = state?.turn?.seat ?? null
  const lastTurnSeat = useRef<number | null>(null)
  const triggersRef = useRef(deckInfo.info?.triggers ?? [])
  triggersRef.current = deckInfo.info?.triggers ?? []
  useEffect(() => {
    if (turnSeat === seatNo && lastTurnSeat.current !== seatNo && remindersOn) setReminder(reminderLines(triggersRef.current))
    if (turnSeat !== seatNo) setReminder([])
    lastTurnSeat.current = turnSeat
  }, [turnSeat, seatNo, remindersOn])

  // The deck's tokens and trigger cards go to the table, which puts the tokens on this seat's tile:
  // when they're looked up, and again whenever the table shows none for the seat (a new game, a
  // table that restarted). Choosing no deck takes them off.
  const infoSentFor = useRef<string | null>(null)
  const sentInfo = useRef<SeatDeckInfo | null>(null)
  const canSend = !!state?.remotes && !!mine && !!account
  const gameId = state?.gameId ?? null
  const tableKnows = mine?.tokens != null
  useEffect(() => {
    if (!canSend) return
    const info = deckInfo.info
    if (!deck) {
      if (sentInfo.current) { sentInfo.current = null; send(deckInfoAction({ deck: null, tokens: [], triggers: [] })) }
      return
    }
    if (!info) return
    if (info !== sentInfo.current || (!tableKnows && infoSentFor.current !== gameId)) {
      sentInfo.current = info
      infoSentFor.current = gameId
      send(deckInfoAction(info))
    }
  }, [canSend, deck, deckInfo.info, tableKnows, gameId, send])

  // The tile picture this player chose, as a URL (null: the seat's colour).
  const preferredUrl = useMemo(() => {
    switch (prefs.background) {
      case 'commander': return commanderArt(deck)
      case 'profile': return api.avatarUrl(me?.avatar_path)
      case 'custom': return prefs.customUrl
      default: return null
    }
  }, [prefs, deck, me?.avatar_path])

  // Sitting down at a new table: the tile starts bare, so put on it the picture and deck this player
  // chose last time — never over one that's already there (set from here, or from another phone).
  const applied = useRef(false)
  useEffect(() => {
    if (!mine || !state?.remotes || applied.current) return
    applied.current = true
    if (mine.background || mine.deck || !hasSavedPrefs()) return
    if (preferredUrl || deck) send({ type: 'background', url: preferredUrl, deck: deck?.name ?? null, commander: commanderOf(deck), partner: !!deck?.partnerCommander })
  }, [mine, state?.remotes, preferredUrl, deck, send])

  const chooseBackground = (kind: BackgroundKind, customUrl: string | null = prefs.customUrl, deckId = prefs.deckId) => {
    const next = { background: kind, customUrl, deckId }
    setPrefs(next)
    const d = decks.find((x) => x.id === deckId) ?? null
    const url = kind === 'commander' ? commanderArt(d) : kind === 'profile' ? api.avatarUrl(me?.avatar_path) : kind === 'custom' ? customUrl : null
    // A partner deck has the table keep its two commanders apart.
    send({ type: 'background', url, deck: d?.name ?? null, commander: commanderOf(d), partner: !!d?.partnerCommander })
  }
  const chooseDeck = (d: Deck) => {
    const kind = prefs.background === 'colour' && commanderArt(d) ? 'commander' : prefs.background
    chooseBackground(kind, prefs.customUrl, d.id)
    setSheet(null)
  }

  // Leaving this screen doesn't leave the seat, so remember it and offer the way back (seat.ts).
  const seatIsMine = !!mine && (!mine.userId || mine.userId === account?.userId)
  useEffect(() => {
    if (seatIsMine) rememberSeat(matchId, seatNo)
  }, [seatIsMine, matchId, seatNo])
  useEffect(() => {
    if (gone || (mine?.userId && account?.userId && mine.userId !== account.userId)) forgetSeat()
  }, [gone, mine?.userId, account?.userId])

  const silent = !!state && now - heardAt > SILENT_MS

  let body: ReactNode
  if (!account) {
    body = <Notice icon="login" title="Sign in to use your remote" action={<button type="button" className="rm-btn" onClick={() => navigate('/account')}>Sign in</button>} />
  } else if (gone) {
    body = <Notice icon="event_seat" title="You've left this table" text="The seat was freed, or the table ended." action={<button type="button" className="rm-btn" onClick={() => navigate('/')}>Done</button>} />
  } else if (!state || !mine) {
    body = <Notice icon="sync" title={live ? 'Waiting for the table…' : 'Connecting to the table…'} text="Keep the life counter open on the table's phone." />
  } else if (mine.userId && account.userId !== mine.userId) {
    body = <Notice icon="event_seat" title={`Someone else is in seat ${seatNo} now`} action={<button type="button" className="rm-btn" onClick={() => navigate('/')}>Done</button>} />
  } else if (!state.remotes) {
    body = <Notice icon="mobile_off" title="Remotes are off" text="The table's owner is keeping this game on the table's phone." />
  } else {
    body = (
      <Remote
        state={state}
        mine={mine}
        others={others}
        big={big}
        deck={deck}
        send={send}
        sheet={sheet}
        setSheet={setSheet}
        heardAt={heardAt}
        reminder={reminder}
        onDismissReminder={() => setReminder([])}
      />
    )
  }

  return (
    <div className="rm-root">
      <header className="rm-head">
        <span className={`rm-dot${live && !silent ? ' on' : ''}`} aria-hidden />
        <span className="rm-where">
          Seat {seatNo}{state?.turn ? ` · turn ${state.turn.number}` : ''}
          {(!live || silent) && state && <b> · {silent ? 'table disconnected' : 'reconnecting…'}</b>}
        </span>
        {state && <RemoteClockLabel state={state} heardAt={heardAt} />}
        {state && mine && state.remotes && (
          <button type="button" className="rm-chip" onClick={() => setBig((b) => !b)} aria-pressed={big}>
            <span className="material-symbols-rounded" aria-hidden>{big ? 'close_fullscreen' : 'open_in_full'}</span>{big ? 'Exit big' : 'Big'}
          </button>
        )}
        <button type="button" className="rm-chip" onClick={() => setSheet('more')} aria-label="More">
          <span className="material-symbols-rounded" aria-hidden>more_horiz</span>
        </button>
      </header>
      {error && <div className="rm-error" role="alert">{error}</div>}
      {body}
      {announce && state?.remotes && (
        <div className={`rm-toast ${announce.kind}`} key={announce.id} role="status" aria-live="polite">
          {announce.kind === 'target' && announce.to === seatNo ? `${nameOfSeat(announce.seat)} points at you`
            : announce.kind === 'target' && announce.seat === seatNo && announce.to !== undefined ? `You point at ${nameOfSeat(announce.to)}`
            : announceText(announce, (s) => (s === seatNo ? 'You' : nameOfSeat(s)))}
        </div>
      )}

      {sheet === 'background' && mine && (
        <BackgroundSheet
          current={mine.background}
          prefs={prefs}
          deck={deck}
          avatar={api.avatarUrl(me?.avatar_path)}
          userId={account?.userId ?? null}
          onPick={(kind, url) => { chooseBackground(kind, url ?? prefs.customUrl); setSheet(null) }}
          onPickDeck={() => setSheet('deck')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'deck' && (
        <RmSheet title="Your deck" onClose={() => setSheet(null)}>
          {decks.length === 0 && <p className="rm-muted">You have no decks yet.</p>}
          <div className="rm-list">
            {activeDecks(decks).map((d) => (
              <button key={d.id} type="button" className={`rm-opt${d.id === prefs.deckId ? ' on' : ''}`} aria-pressed={d.id === prefs.deckId} onClick={() => chooseDeck(d)}>
                <span className="rm-swatch" style={commanderArt(d) ? { backgroundImage: `url("${commanderArt(d)}")` } : undefined} />
                <span className="rm-opt-text"><b>{d.name}</b><span>{d.commander?.name ?? 'No commander'}</span></span>
              </button>
            ))}
          </div>
          {prefs.deckId && (
            <button type="button" className="rm-btn line" onClick={() => { chooseBackground(prefs.background === 'commander' ? 'colour' : prefs.background, prefs.customUrl, null); setSheet(null) }}>
              Not playing one of my decks
            </button>
          )}
        </RmSheet>
      )}
      {sheet === 'more' && (
        <RmSheet title="More" onClose={() => setSheet(null)}>
          <div className="rm-list">
            <button type="button" className="rm-opt" onClick={() => setSheet('deck')}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>style</span>
              <span className="rm-opt-text"><b>Deck</b><span>{deck?.name ?? 'Pick the deck you’re playing'}</span></span>
            </button>
            {state?.remotes && mine && (
              <button type="button" className="rm-opt" onClick={() => setSheet('show')}>
                <span className="material-symbols-rounded rm-opt-icon" aria-hidden>visibility</span>
                <span className="rm-opt-text"><b>Show a card on the table</b><span>Everyone sees it big until they tap it away</span></span>
              </button>
            )}
            {state?.remotes && mine && (
              <button type="button" className="rm-opt" onClick={() => setSheet(deck ? 'tokens' : 'deck')}>
                <span className="material-symbols-rounded rm-opt-icon" aria-hidden>layers</span>
                <span className="rm-opt-text"><b>Tokens</b><span>{deck ? `The ones ${deck.name} makes` : 'Pick the deck you’re playing first'}</span></span>
              </button>
            )}
            <button type="button" className="rm-opt" onClick={() => setSheet('lookup')}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>search</span>
              <span className="rm-opt-text"><b>Look up a card</b><span>Its text and official rulings, just for you</span></span>
            </button>
            <button type="button" className="rm-opt" onClick={() => setSheet('notes')}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>lock</span>
              <span className="rm-opt-text"><b>Notes</b><span>Only you see these</span></span>
            </button>
            <button type="button" className={`rm-opt${turnBuzz ? ' on' : ''}`} role="switch" aria-checked={turnBuzz} onClick={() => setTurnBuzz(!turnBuzz)}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>notifications_active</span>
              <span className="rm-opt-text"><b>Buzz on my turn</b><span>{turnBuzz ? 'On · the phone buzzes when your turn starts' : 'Off'}</span></span>
            </button>
            <button type="button" className={`rm-opt${remindersOn ? ' on' : ''}`} role="switch" aria-checked={remindersOn} onClick={() => setRemindersOn(!remindersOn)}>
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>lightbulb</span>
              <span className="rm-opt-text"><b>Trigger reminders</b><span>{remindersOn ? 'On · your deck’s “at the beginning of your…” cards at the start of your turn' : 'Off'}</span></span>
            </button>
            {state?.remotes && mine && !mine.out && !state.over && (
              <button type="button" className="rm-opt" onClick={() => setSheet('concede')}>
                <span className="material-symbols-rounded rm-opt-icon" aria-hidden>flag</span>
                <span className="rm-opt-text"><b>Concede</b><span>Leave this game — you can be put back from the table</span></span>
              </button>
            )}
            <button
              type="button"
              className="rm-opt"
              onClick={() => {
                void api.clearMatchSeat(matchId, seatNo).catch(() => {})
                forgetSeat()
                navigate('/')
              }}
            >
              <span className="material-symbols-rounded rm-opt-icon" aria-hidden>logout</span>
              <span className="rm-opt-text"><b>Leave this seat</b><span>Your name comes off the table</span></span>
            </button>
          </div>
        </RmSheet>
      )}
      {sheet === 'show' && <ShowCardSheet onShow={(name, imageUrl) => { send({ type: 'showCard', name, imageUrl }); setSheet(null) }} onClose={() => setSheet(null)} />}
      {sheet === 'lookup' && <ShowCardSheet onClose={() => setSheet(null)} />}
      {sheet === 'notes' && <NotesSheet matchId={matchId} onClose={() => setSheet(null)} />}
      {sheet === 'tokens' && (
        <TokensSheet
          gameKey={`${matchId}:${state?.gameId ?? ''}`}
          deck={deck}
          info={deckInfo.info}
          loading={deckInfo.loading}
          tableTokens={mine?.tokens ?? null}
          onToken={(id, delta) => send({ type: 'token', id, delta })}
          onChange={(delta) => send({ type: 'counter', counter: 'tokens', delta })}
          onPickDeck={() => setSheet('deck')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'concede' && (
        <RmSheet title="Concede this game?" onClose={() => setSheet(null)}>
          <p className="rm-muted">You’re knocked out, the same as losing. If it was a mistake, undo it from here or the table can put you back.</p>
          <div className="rm-row">
            <button type="button" className="rm-btn line" onClick={() => setSheet(null)}>Keep playing</button>
            <button type="button" className="rm-btn danger" onClick={() => { send({ type: 'concede' }); setSheet(null) }}>Concede</button>
          </div>
        </RmSheet>
      )}

      {state?.over && mine && (
        <GameOver
          key={state.gameId}
          matchId={matchId}
          state={state}
          seat={seatNo}
          deck={deck}
          log={(result) => { if (deck) addGameResult(deck.id, { id: crypto.randomUUID(), ...result, playedAt: Date.now() }) }}
          onPickDeck={() => setSheet('deck')}
        />
      )}
    </div>
  )
}

function Notice({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rm-notice">
      <span className="material-symbols-rounded" aria-hidden>{icon}</span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

function seatStyle(p: RemoteSeat): CSSProperties {
  if (p.background) {
    return { backgroundColor: p.color, backgroundImage: `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.5)), url("${p.background.replace(/"/g, '%22')}")`, color: '#fff' }
  }
  return { backgroundColor: p.color, color: p.ink }
}

const damageFrom = (to: RemoteSeat, from: number, slot: number) =>
  to.commanderDamage.find((d) => d.from === from && d.slot === slot)?.amount ?? 0

/** The remote proper: this seat's life and buttons, everyone else's life, and the sheets. */
function Remote({
  state, mine, others, big, deck, send, sheet, setSheet, heardAt, reminder, onDismissReminder,
}: {
  state: RemoteState
  mine: RemoteSeat
  others: RemoteSeat[]
  big: boolean
  deck: Deck | null
  send: (a: RemoteAction) => void
  sheet: Sheet
  setSheet: (s: Sheet) => void
  /** When the table's state last came in: the clock and the turn timer count on from it. */
  heardAt: number
  /** The deck's start-of-turn cards, at the start of this seat's turn. */
  reminder: string[]
  onDismissReminder: () => void
}) {
  const [tally, setTally] = useState(0)
  const [taps, setTaps] = useState(0)
  useEffect(() => {
    if (tally === 0) return
    const t = window.setTimeout(() => setTally(0), FEEDBACK_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [tally, taps])
  const change = (delta: number) => {
    send({ type: 'life', delta })
    setTaps((n) => n + 1)
    setTally((p) => ((p > 0) === (delta > 0) || p === 0 ? p + delta : delta))
    navigator.vibrate?.(8)
  }
  const minus = useStepper((n) => change(-n), state.longPress, true)
  const plus = useStepper((n) => change(n), state.longPress, true)
  const myTurn = state.turn?.seat === mine.seat
  const worst = Math.max(0, ...mine.commanderDamage.map((d) => d.amount))
  const alert = mine.out ? null
    : mine.poison >= 8 ? `Poison ${mine.poison} — ${10 - mine.poison} more and you're out`
    : worst >= 18 ? `Commander damage ${worst} — ${21 - worst} more and you're out`
    : null
  const showing = state.shownCard?.seat === mine.seat ? state.shownCard : null
  const tallyText = tally === 0 ? null : `${tally > 0 ? '+' : '−'}${Math.abs(tally)}`
  const holding = state.hold === mine.seat
  const holder = state.hold != null && !holding ? state.players.find((p) => p.seat === state.hold) : undefined
  const casts = mine.commanderCasts ?? 0
  // The crown and the flag beside whoever holds the monarch and the initiative.
  const badges = (seat: number) => (
    <>
      {state.monarch === seat && <span className="material-symbols-rounded rm-badge" role="img" title="Monarch" aria-label="Monarch">crown</span>}
      {state.initiative === seat && <span className="material-symbols-rounded rm-badge" role="img" title="Initiative" aria-label="Initiative">swords</span>}
    </>
  )

  const lifeButtons = (
    <div className="rm-pm">
      <button type="button" className="rm-circle" aria-label={`Lose 1 life (hold for ${state.longPress})`} {...minus}>−</button>
      {!big && (
        <button type="button" className="rm-circle sm" onClick={() => send({ type: 'undo' })} disabled={!mine.canUndo} aria-label="Undo my last change">
          <span className="material-symbols-rounded" aria-hidden>undo</span>
        </button>
      )}
      {/* Still shown when you're out: dying on your own turn shouldn't strand it — the table would
          have to pass it for you. The turn never comes back to you (see nextTurnFrom). */}
      {!big && myTurn && (
        <button type="button" className="rm-circle sm turn" onClick={() => send({ type: 'endTurn' })} aria-label="End turn">
          <span className="material-symbols-rounded" aria-hidden>check</span>
        </button>
      )}
      <button type="button" className="rm-circle" aria-label={`Gain 1 life (hold for ${state.longPress})`} {...plus}>+</button>
    </div>
  )

  if (big) {
    return (
      <div className="rm-me big" style={seatStyle(mine)}>
        <div className="rm-life">{mine.life}</div>
        <div className="rm-tally" aria-live="polite">{tallyText}</div>
        {lifeButtons}
      </div>
    )
  }

  return (
    <div className="rm-main">
      <div className={`rm-me${mine.out ? ' out' : ''}${myTurn ? ' turn' : ''}`} style={seatStyle(mine)}>
        <div className="rm-me-name">{badges(mine.seat)}{mine.name}{deck ? ` · ${deck.name}` : ''}</div>
        <div className="rm-life">{mine.life}</div>
        <div className="rm-tally" aria-live="polite">{tallyText ?? (mine.out ? 'Out of the game' : myTurn ? 'Your turn' : '')}</div>
        {lifeButtons}
      </div>
      {myTurn && state.turnTimer && <TurnTimerBar timer={state.turnTimer} heardAt={heardAt} />}
      {myTurn && reminder.length > 0 && (
        <div className="rm-reminder" role="status">
          <span className="material-symbols-rounded" aria-hidden>notifications_active</span>
          <span className="rm-reminder-lines">{reminder.map((line) => <span key={line}>{line}</span>)}</span>
          <button type="button" className="rm-chip" onClick={onDismissReminder}>Done</button>
        </div>
      )}
      {alert && <div className="rm-alert" role="status"><span className="material-symbols-rounded" aria-hidden>warning</span>{alert}</div>}
      {showing && (
        <div className="rm-showing">
          <span>Showing <b>{showing.name}</b> on the table</span>
          <button type="button" className="rm-chip" onClick={() => send({ type: 'hideCard' })}>Hide</button>
        </div>
      )}
      {holder && (
        <div className="rm-hold-note" role="status">
          <span className="material-symbols-rounded" aria-hidden>pan_tool</span>
          <span className="rm-hold-text"><b>{holder.name}</b>: hold on</span>
          <button type="button" className="rm-chip rm-hold-ok" onClick={() => send({ type: 'holdOk' })}>OK, go on</button>
        </div>
      )}
      {/* Planechase: the plane the table is on; rolling and planeswalking are in the Table sheet. */}
      {state.plane && (
        <button type="button" className="rm-plane-row" onClick={() => setSheet('table')}>
          <span className="rm-plane-art" style={state.plane.imageUrl ? { backgroundImage: `url("${toArtCrop(state.plane.imageUrl)}")` } : undefined} />
          <span className="rm-opt-text">
            <b>{state.plane.name}</b>
            <span>{!state.turn || myTurn ? 'Your turn: tap to roll the planar die' : `Planechase · ${state.plane.left} left`}</span>
          </span>
          <span className={`material-symbols-rounded${!state.turn || myTurn ? ' rm-gold' : ''}`} aria-hidden>casino</span>
        </button>
      )}
      {/* The deck's tokens out on the table, at a glance. */}
      {mine.tokens && mine.tokens.some((t) => t.count > 0) && (
        <button type="button" className="rm-tokens-row" onClick={() => setSheet('tokens')}>
          <span className="material-symbols-rounded rm-gold" aria-hidden>layers</span>
          <span>{mine.tokens.filter((t) => t.count > 0).map((t) => `${tokenLabel(t)} ×${t.count}`).join(' · ')}</span>
        </button>
      )}

      <div className="rm-quick">
        <button type="button" className={`rm-quick-btn hold${holding ? ' on' : ''}`} onClick={() => send({ type: 'hold', on: !holding })} aria-pressed={holding}>
          <span className="material-symbols-rounded" aria-hidden>pan_tool</span>{holding ? 'Done — carry on' : 'Hold on'}
        </button>
        <div className={`rm-taxes${mine.partner ? ' two' : ''}`}>
          <TaxStepper casts={casts} label={mine.partner ? 'Commander' : 'Commander cast'} what="commander" onChange={(delta) => send({ type: 'commanderCast', delta })} />
          {mine.partner && (
            <TaxStepper casts={mine.partnerCasts ?? 0} label="Partner" what="partner" onChange={(delta) => send({ type: 'commanderCast', delta, slot: 1 })} />
          )}
        </div>
        <button type="button" className="rm-quick-btn" onClick={() => setSheet('emote')} aria-label="Send an emote">
          <span className="material-symbols-rounded" aria-hidden>add_reaction</span>
        </button>
        <button type="button" className="rm-quick-btn" onClick={() => setSheet('target')} aria-label="Point at a player">
          <span className="material-symbols-rounded" aria-hidden>my_location</span>
        </button>
      </div>

      <div className="rm-label">Everyone</div>
      <div className="rm-others">
        {others.map((o) => (
          <div key={o.seat} className={`rm-other${o.out ? ' out' : ''}${state.turn?.seat === o.seat ? ' turn' : ''}`} style={seatStyle(o)}>
            <span className="rm-other-name">{badges(o.seat)}{o.name}</span>
            <b>{o.life}</b>
            {o.poison > 0 && <span className="rm-other-sub">☠ {o.poison}</span>}
          </div>
        ))}
      </div>

      <div className="rm-bar">
        <button type="button" onClick={() => setSheet('damage')}><span className="material-symbols-rounded" aria-hidden>swords</span>Damage</button>
        <button type="button" onClick={() => setSheet('counters')}><span className="material-symbols-rounded" aria-hidden>water_drop</span>Counters</button>
        <button type="button" onClick={() => setSheet('table')}><span className="material-symbols-rounded" aria-hidden>casino</span>Table</button>
        <button type="button" onClick={() => setSheet('background')}><span className="material-symbols-rounded" aria-hidden>image</span>Tile</button>
        <button type="button" onClick={() => setSheet('more')}><span className="material-symbols-rounded" aria-hidden>more_horiz</span>More</button>
      </div>

      {sheet === 'damage' && (
        <RmSheet title="Commander damage" onClose={() => setSheet(null)}>
          <div className="rm-label">You dealt</div>
          {others.flatMap((o) => (mine.partner ? [0, 1] : [0]).map((slot) => (
            <Stepper
              key={`d${o.seat}-${slot}`}
              label={`${o.name}${mine.partner ? (slot === 0 ? ' · commander' : ' · partner') : ''}`}
              color={o.color}
              value={damageFrom(o, mine.seat, slot)}
              onChange={(delta) => send({ type: 'dealtDamage', to: o.seat, slot, delta })}
            />
          )))}
          <div className="rm-label">You took</div>
          {others.flatMap((o) => (o.partner ? [0, 1] : [0]).map((slot) => (
            <Stepper
              key={`r${o.seat}-${slot}`}
              label={`${o.name}${o.partner ? (slot === 0 ? ' · commander' : ' · partner') : ''}`}
              color={o.color}
              value={damageFrom(mine, o.seat, slot)}
              onChange={(delta) => send({ type: 'commanderDamage', from: o.seat, slot, delta })}
            />
          )))}
        </RmSheet>
      )}
      {sheet === 'counters' && (
        <RmSheet title="Counters" onClose={() => setSheet(null)}>
          {REMOTE_COUNTERS.map((k) => (
            <Stepper
              key={k}
              label={k === 'poison' ? 'Poison' : k === 'speed' && isMaxSpeed(mine.counters.speed ?? 0) ? 'Speed · max speed' : k === 'ring' ? 'The Ring tempts you' : COUNTER_INFO[k].label}
              icon={k === 'poison' ? 'water_drop' : COUNTER_INFO[k].icon}
              value={k === 'poison' ? mine.poison : mine.counters[k] ?? 0}
              onChange={(delta) => send({ type: 'counter', counter: k, delta })}
            />
          ))}
          <p className="rm-muted">Storm goes back to 0 when the turn passes. Speed goes up at most once a turn and stops at 4.</p>
          {(mine.counters.ring ?? 0) > 0 && (
            <>
              <div className="rm-label">Your Ring-bearer</div>
              <ol className="rm-ring">{ringAbilities(mine.counters.ring ?? 0).map((a) => <li key={a}>{a}</li>)}</ol>
              <RingBearerField value={mine.ringBearer ?? ''} onCommit={(name) => send({ type: 'ringBearer', name })} />
            </>
          )}
          {mine.mulligans !== undefined && (
            <>
              <div className="rm-label">Mulligans</div>
              <Stepper
                label={mine.mulligans == null ? 'Not recorded' : mulliganText(mine.mulligans, state.players.length > 2)}
                value={mine.mulligans ?? 0}
                onChange={(delta) => send({ type: 'mulligan', value: mine.mulligans == null ? (delta > 0 ? 1 : 0) : mine.mulligans + delta < 0 ? null : Math.min(7, mine.mulligans + delta) })}
              />
            </>
          )}
          {mine.dungeon !== undefined && (
            <>
              <div className="rm-label">Dungeon</div>
              <VenturePanel
                dungeon={mine.dungeon ? { dungeon: mine.dungeon.id, room: mine.dungeon.room } : null}
                completed={mine.dungeonsCompleted ?? 0}
                hasInitiative={state.initiative === mine.seat}
                onVenture={(to, undercity) => send({ type: 'venture', to, undercity })}
                onLeave={() => send({ type: 'leaveDungeon' })}
              />
            </>
          )}
        </RmSheet>
      )}
      {sheet === 'table' && <TableSheet state={state} mine={mine} send={send} onClose={() => setSheet(null)} />}
      {sheet === 'emote' && (
        <RmSheet title="Send to the table" onClose={() => setSheet(null)}>
          <div className="rm-grid">
            {(Object.keys(EMOTES) as EmoteId[]).map((id) => (
              <button key={id} type="button" className="rm-grid-btn emote" onClick={() => { send({ type: 'emote', emote: id }); setSheet(null) }}>{EMOTES[id]}</button>
            ))}
          </div>
        </RmSheet>
      )}
      {sheet === 'target' && (
        <RmSheet title="Point at a player" onClose={() => setSheet(null)}>
          <p className="rm-muted">Their tile lights up on the table for a moment — for a spell, an attack, or “you”.</p>
          <div className="rm-list">
            {others.map((o) => (
              <button key={o.seat} type="button" className="rm-opt" onClick={() => { send({ type: 'target', to: o.seat }); setSheet(null) }} disabled={!!o.out}>
                <span className="rm-swatch" style={seatStyle(o)} />
                <span className="rm-opt-text"><b>{o.name}</b><span>{o.out ? 'Out of the game' : `${o.life} life`}</span></span>
              </button>
            ))}
          </div>
        </RmSheet>
      )}
    </div>
  )
}

/** What belongs to the whole table: the monarch, the initiative, day and night, dice and Planechase. */
function TableSheet({ state, mine, send, onClose }: { state: RemoteState; mine: RemoteSeat; send: (a: RemoteAction) => void; onClose: () => void }) {
  const nameOf = (seat: number | null | undefined) => state.players.find((p) => p.seat === seat)?.name
  const holder = (kind: 'monarch' | 'initiative', title: string) => {
    const seat = state[kind] ?? null
    const mineNow = seat === mine.seat
    return (
      <div className="rm-holder">
        <span className="rm-opt-text"><b>{title}</b><span>{mineNow ? 'You have it' : seat != null ? `${nameOf(seat)} has it` : 'Nobody has it'}</span></span>
        <button type="button" className={`rm-chip${mineNow ? '' : ' gold'}`} onClick={() => send({ type: kind, take: !mineNow })}>
          {mineNow ? 'Give it up' : 'Take it'}
        </button>
      </div>
    )
  }
  const day = state.dayNight ?? null
  const myTurnOrUntracked = !state.turn || state.turn.seat === mine.seat
  return (
    <RmSheet title="Table" onClose={onClose}>
      {holder('monarch', 'Monarch')}
      {holder('initiative', 'Initiative')}

      <div className="rm-label">Day and night</div>
      <div className="rm-seg" role="group" aria-label="Day and night">
        {([['DAY', 'Day', 'wb_sunny'], ['NIGHT', 'Night', 'bedtime'], [null, 'Off', 'block']] as const).map(([value, label, icon]) => (
          <button key={label} type="button" aria-pressed={day === value} onClick={() => send({ type: 'dayNight', value })}>
            <span className="material-symbols-rounded" aria-hidden>{icon}</span>{label}
          </button>
        ))}
      </div>

      <div className="rm-label">Roll — the table rolls, everyone sees it</div>
      <div className="rm-grid">
        {REMOTE_DICE.map((sides) => (
          <button key={sides} type="button" className="rm-grid-btn" onClick={() => { send({ type: 'roll', sides }); onClose() }}>
            {sides === 2 ? 'Coin' : `d${sides}`}
          </button>
        ))}
      </div>

      {state.plane && (
        <>
          <div className="rm-label">Planechase</div>
          <div className="rm-plane">
            {state.plane.imageUrl && <img src={state.plane.imageUrl} alt={state.plane.name} />}
            <span className="rm-opt-text"><b>{state.plane.name}</b><span>{state.plane.left} planes left</span></span>
          </div>
          <div className="rm-row">
            <button type="button" className="rm-btn" disabled={!myTurnOrUntracked} onClick={() => { send({ type: 'planar', what: 'roll' }); onClose() }}>Roll the planar die</button>
            <button type="button" className="rm-btn line" disabled={!myTurnOrUntracked || state.plane.left === 0} onClick={() => { send({ type: 'planar', what: 'planeswalk' }); onClose() }}>Planeswalk</button>
          </div>
          {!myTurnOrUntracked && <p className="rm-muted">Only the player whose turn it is rolls the planar die.</p>}
        </>
      )}
    </RmSheet>
  )
}

/** Casts of one commander, shown as the tax they add: − to take a cast back, + for each cast. */
function TaxStepper({ casts, label, what, onChange }: { casts: number; label: string; what: 'commander' | 'partner'; onChange: (delta: number) => void }) {
  return (
    <div className="rm-tax" aria-label={`${what}: cast ${casts} times, tax ${2 * casts}`}>
      <button type="button" onClick={() => onChange(-1)} disabled={casts === 0} aria-label={`Take back a ${what} cast`}>−</button>
      <span><b>Tax {2 * casts}</b><small>{label}</small></span>
      <button type="button" onClick={() => onChange(1)} aria-label={`Cast my ${what}`}>+</button>
    </div>
  )
}

/** The Ring-bearer's name, sent when the field is left. */
function RingBearerField({ value, onCommit }: { value: string; onCommit: (name: string | null) => void }) {
  const [text, setText] = useState(value)
  return (
    <input
      className="rm-input"
      value={text}
      maxLength={60}
      placeholder="Ring-bearer's name"
      aria-label="Ring-bearer"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== value) onCommit(text.trim() || null) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

function Stepper({ label, value, color, icon, onChange }: { label: string; value: number; color?: string; icon?: string; onChange: (d: number) => void }) {
  return (
    <div className="rm-stepper">
      {color && <i style={{ background: color }} aria-hidden />}
      {icon && <span className="material-symbols-rounded" aria-hidden>{icon}</span>}
      <span className="rm-stepper-label">{label}</span>
      <button type="button" onClick={() => onChange(-1)} aria-label={`${label} minus one`}>−</button>
      <b>{value}</b>
      <button type="button" onClick={() => onChange(1)} aria-label={`${label} plus one`}>+</button>
    </div>
  )
}

function RmSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const keepFocusIn = useModalFocus(box, onClose)
  return (
    <>
      <button type="button" className="rm-scrim" aria-label="Close" onClick={onClose} />
      <div ref={box} className="rm-sheet" role="dialog" aria-modal="true" aria-label={title} onKeyDown={keepFocusIn}>
        <div className="rm-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="rm-chip" onClick={onClose}>Done</button>
        </div>
        <div className="rm-sheet-body">{children}</div>
      </div>
    </>
  )
}

/** Tile background: the commander of the deck being played, the profile picture, the seat colour, or a GIF / photo. */
function BackgroundSheet({
  current, prefs, deck, avatar, userId, onPick, onPickDeck, onClose,
}: {
  /** What's on the tile now. */
  current: string | null
  prefs: RemotePrefs
  deck: Deck | null
  avatar: string | null
  userId: string | null
  onPick: (kind: BackgroundKind, url?: string) => void
  onPickDeck: () => void
  onClose: () => void
}) {
  const [giphy, setGiphy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const art = commanderArt(deck)
  const currentKind: BackgroundKind = !current ? 'colour' : current === art ? 'commander' : current === avatar ? 'profile' : 'custom'
  const custom = currentKind === 'custom' ? current : prefs.customUrl
  const upload = async (f: File) => {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      const path = await api.uploadAvatar(userId, f)
      const url = api.avatarUrl(path)
      if (url) onPick('custom', url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The picture didn’t upload.')
    } finally {
      setBusy(false)
    }
  }
  const opt = (kind: BackgroundKind, title: string, sub: string, swatch: CSSProperties, onClick: () => void, disabled = false) => (
    <button type="button" className={`rm-opt${currentKind === kind ? ' on' : ''}`} aria-pressed={currentKind === kind} onClick={onClick} disabled={disabled || busy}>
      <span className="rm-swatch" style={swatch} />
      <span className="rm-opt-text"><b>{title}</b><span>{sub}</span></span>
    </button>
  )
  return (
    <>
      <RmSheet title="Tile background" onClose={onClose}>
        <div className="rm-list">
          {opt('commander', 'Commander art', deck ? (deck.commander ? `${deck.commander.name}, from ${deck.name}` : `${deck.name} has no commander`) : 'Pick the deck you’re playing',
            art ? { backgroundImage: `url("${art}")` } : {}, () => (art ? onPick('commander') : onPickDeck()))}
          {opt('profile', 'Profile picture', avatar ? 'Your photo or GIF' : 'You have no profile picture', avatar ? { backgroundImage: `url("${avatar}")` } : {}, () => onPick('profile'), !avatar)}
          {opt('colour', 'Seat colour', 'Plain colour', { background: 'linear-gradient(135deg, #ff005f, #ffc600)' }, () => onPick('colour'))}
          {opt('custom', 'A GIF or a photo', busy ? 'Uploading…' : 'Search Giphy, or pick from your phone',
            custom ? { backgroundImage: `url("${custom}")` } : { background: '#2bd98f' }, () => (custom ? onPick('custom', custom) : setGiphy(true)))}
        </div>
        <div className="rm-row">
          <button type="button" className="rm-btn line" onClick={() => setGiphy(true)} disabled={busy}>Search Giphy</button>
          <button type="button" className="rm-btn line" onClick={() => file.current?.click()} disabled={busy}>Pick a photo</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
        {error && <p className="rm-error" role="alert">{error}</p>}
      </RmSheet>
      {giphy && <GiphyPicker onPicked={(f) => { setGiphy(false); void upload(f) }} onClose={() => setGiphy(false)} />}
    </>
  )
}

/**
 * Search a card by name: see it with its official rulings (settling an argument without leaving the
 * game), then show it big on the table if everyone should see it.
 */
function ShowCardSheet({ onShow, onClose }: { onShow?: (name: string, imageUrl: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The card picked, and its rulings (undefined while they load, null if they couldn't be had).
  const [picked, setPicked] = useState<{ name: string; imageUrl: string; text: string | null; rulings?: Ruling[] | null } | null>(null)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setNames([]); return }
    let cancelled = false
    const t = window.setTimeout(() => {
      autocomplete(q).then((r) => { if (!cancelled) setNames(r.slice(0, 12)) }, () => {})
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query])
  const pick = async (name: string) => {
    setBusy(name)
    setError(null)
    try {
      const card = await getByExactName(name)
      const url = displayImageUrl(card)
      if (!url) { setError('That card has no picture.'); return }
      setPicked({ name: card.name, imageUrl: url, text: displayOracleText(card) })
      getRulings(card.name).then(
        (r) => setPicked((p) => (p?.name === card.name ? { ...p, rulings: r.rulings } : p)),
        () => setPicked((p) => (p?.name === card.name ? { ...p, rulings: null } : p)),
      )
    } catch {
      setError('Couldn’t find that card — check your connection.')
    } finally {
      setBusy(null)
    }
  }
  if (picked) {
    return (
      <RmSheet title={picked.name} onClose={onClose}>
        <img className="rm-card-preview" src={picked.imageUrl} alt={picked.name} />
        <div className="rm-row">
          <button type="button" className="rm-btn line" onClick={() => setPicked(null)}>{onShow ? 'Back' : 'Pick another card'}</button>
          {onShow && <button type="button" className="rm-btn" onClick={() => onShow(picked.name, picked.imageUrl)}>Show on the table</button>}
        </div>
        {picked.text && <p className="rm-oracle">{picked.text}</p>}
        <div className="rm-label">Rulings</div>
        {picked.rulings === undefined ? <p className="rm-muted">Loading the rulings…</p>
          : picked.rulings === null ? <p className="rm-muted">Couldn’t load the rulings — check your connection.</p>
          : picked.rulings.length === 0 ? <p className="rm-muted">No official rulings for this card.</p>
          : (
            <ul className="rm-rulings">
              {picked.rulings.map((r, i) => <li key={i}>{r.comment}<small>{r.published_at}</small></li>)}
            </ul>
          )}
      </RmSheet>
    )
  }
  return (
    <RmSheet title={onShow ? 'Show a card on the table' : 'Look up a card'} onClose={onClose}>
      <input className="rm-input" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Card name" aria-label="Card name" />
      <div className="rm-list">
        {names.map((n) => (
          <button key={n} type="button" className="rm-opt" onClick={() => void pick(n)} disabled={busy !== null}>
            <span className="rm-opt-text"><b>{n}</b>{busy === n && <span>Loading…</span>}</span>
          </button>
        ))}
      </div>
      {error && <p className="rm-error" role="alert">{error}</p>}
    </RmSheet>
  )
}

/**
 * The tokens this player's deck makes, each with how many are out. A table that tracks deck tokens
 * keeps the counts on the seat (they show on the tile too); an older one gets them kept on this
 * phone, with its Tokens counter following — a restart clears that counter, so the counts here start
 * again with it ([gameKey] is the match and game).
 */
function TokensSheet({
  gameKey, deck, info, loading, tableTokens, onToken, onChange, onPickDeck, onClose,
}: {
  gameKey: string
  deck: Deck | null
  info: SeatDeckInfo | null
  loading: boolean
  /** The seat's tokens as the table counts them; null from a table that doesn't. */
  tableTokens: { id: string; count: number }[] | null
  onToken: (id: string, delta: number) => void
  onChange: (delta: number) => void
  onPickDeck: () => void
  onClose: () => void
}) {
  const key = `mtgweb_remote_tokens:${gameKey}`
  const [counts, setCounts] = useState<Record<string, number>>(() => readJson(key, {}))
  const step = (id: string, delta: number) => {
    if (tableTokens) { onToken(id, delta); return }
    const next = Math.max(0, (counts[id] ?? 0) + delta)
    if (next === (counts[id] ?? 0)) return
    const all = { ...counts, [id]: next }
    setCounts(all)
    writeJson(key, all)
    onChange(delta)
  }
  const tokens = info?.tokens ?? []
  return (
    <RmSheet title="Tokens" onClose={onClose}>
      {!deck ? (
        <>
          <p className="rm-muted">Pick the deck you’re playing first.</p>
          <button type="button" className="rm-btn" onClick={onPickDeck}>Pick my deck</button>
        </>
      ) : loading ? (
        <p className="rm-muted">Reading {deck.name}’s cards…</p>
      ) : !info ? (
        <p className="rm-muted">Couldn’t look up {deck.name}’s tokens — check your connection.</p>
      ) : tokens.length === 0 ? (
        <p className="rm-muted">{deck.name} doesn’t make any tokens.</p>
      ) : (
        <>
          <p className="rm-muted">{tableTokens ? 'On your tile at the table too.' : 'Kept on this phone for this game. The table’s Tokens count follows.'}</p>
          {tokens.map((t) => (
            <div key={t.id} className="rm-token">
              <span className="rm-token-art" style={t.art ? { backgroundImage: `url("${t.art}")` } : undefined} />
              <Stepper
                label={tokenLabel(t)}
                value={tableTokens ? tableTokens.find((x) => x.id === t.id)?.count ?? 0 : counts[t.id] ?? 0}
                onChange={(d) => step(t.id, d)}
              />
            </div>
          ))}
        </>
      )}
    </RmSheet>
  )
}

/** "12:34" — the game clock, counted on from when the table last sent it; nothing from a table that doesn't send one. */
function RemoteClockLabel({ state, heardAt }: { state: RemoteState; heardAt: number }) {
  const clock = state.clock
  const now = useNow(1_000, !!clock && !clock.paused && !state.over)
  if (!clock || state.over) return null
  const since = clock.paused ? 0 : Math.max(0, now - heardAt)
  return <span className="rm-clock" aria-label="Game clock">{formatClock(clock.elapsedMs + since)}{clock.paused ? ' ⏸' : ''}</span>
}

/** Your turn's time left, counted down from when the table last sent it; red once it's over. */
function TurnTimerBar({ timer, heardAt }: { timer: RemoteTurnTimer; heardAt: number }) {
  const now = useNow(500)
  const left = timer.leftMs - Math.max(0, now - heardAt)
  const over = left <= 0
  return (
    <div className={`rm-timer${over ? ' over' : ''}`} role="timer">
      <span>{over ? 'Turn time is up' : 'Turn timer'}</span>
      <b>{turnTimerText(left)}</b>
    </div>
  )
}

/** A scratch pad for this table only, kept on this phone. */
function NotesSheet({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const key = `mtgweb_remote_notes:${matchId}`
  const [text, setText] = useState(() => readText(key))
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(key, text) } catch { /* not kept */ } }, 300)
    return () => window.clearTimeout(t)
  }, [key, text])
  return (
    <RmSheet title="Notes" onClose={onClose}>
      <p className="rm-muted"><span className="material-symbols-rounded" aria-hidden>lock</span> Only you see these, on this phone.</p>
      <textarea className="rm-input rm-notes" value={text} onChange={(e) => setText(e.target.value)} placeholder="Opponent has 3 cards in hand, Rhystic paid…" aria-label="Notes" />
    </RmSheet>
  )
}

/** The result, once the table has one winner (or nobody left) — and the game logged to the chosen deck, once. */
function GameOver({
  matchId, state, seat, deck, log, onPickDeck,
}: {
  matchId: string
  state: RemoteState
  seat: number
  deck: Deck | null
  log: (result: Pick<GameResult, 'result' | 'opponent' | 'turns' | 'minutes' | 'commanders' | 'mulligans'>) => void
  onPickDeck: () => void
}) {
  const [closed, setClosed] = useState(false)
  const over = state.over!
  const logKey = `${matchId}:${state.gameId}`
  const [logged, setLogged] = useState(() => readJson<{ keys: string[] }>(LOGGED_KEY, { keys: [] }).keys.includes(logKey))
  useEffect(() => {
    if (logged || !deck) return
    // What's saved is the record: this runs again when the page reopens (or twice, in development).
    const keys = readJson<{ keys: string[] }>(LOGGED_KEY, { keys: [] }).keys
    if (!keys.includes(logKey)) {
      writeJson(LOGGED_KEY, { keys: [...keys, logKey].slice(-100) })
      const others = state.players.filter((p) => p.seat !== seat)
      log({
        result: over.winner === seat ? 'WIN' : 'LOSS',
        opponent: others.map((p) => p.name).join(', ') || null,
        turns: over.turns > 0 ? over.turns : null,
        minutes: over.minutes > 0 ? over.minutes : null,
        commanders: others.flatMap((p) => (p.commander ? [p.commander] : [])),
        ...(state.players.find((p) => p.seat === seat)?.mulligans != null ? { mulligans: state.players.find((p) => p.seat === seat)!.mulligans } : {}),
      })
    }
    setLogged(true)
  }, [logged, deck, state.players, seat, over.winner, over.turns, over.minutes, logKey, log])
  if (closed) return null
  const winner = state.players.find((p) => p.seat === over.winner)
  const standings = [...state.players].sort((a, b) => Number(a.seat !== over.winner) - Number(b.seat !== over.winner) || Number(!!a.out) - Number(!!b.out) || b.life - a.life)
  const record = deck ? `${deck.gameResults.filter((g) => g.result === 'WIN').length}–${deck.gameResults.filter((g) => g.result === 'LOSS').length}` : ''
  return (
    <div className="rm-over" role="dialog" aria-modal="true" aria-label="Game over">
      <p className="rm-muted">Game over · {over.minutes} min · {over.turns} {over.turns === 1 ? 'turn' : 'turns'}</p>
      <h2>{winner ? (winner.seat === seat ? 'You win!' : `${winner.name} wins`) : 'Nobody is left standing'}</h2>
      <div className="rm-list">
        {standings.map((p, i) => (
          <div key={p.seat} className="rm-stand">
            <i style={{ background: p.color }} aria-hidden />
            <span>{i + 1}. {p.name}{p.seat === seat ? ' (you)' : ''}</span>
            <b>{p.life}</b>
          </div>
        ))}
      </div>
      {deck ? (
        <div className="rm-saved"><span className="material-symbols-rounded" aria-hidden>bar_chart</span>Saved to {deck.name} · now {record}</div>
      ) : (
        <button type="button" className="rm-btn line" onClick={onPickDeck}>Pick your deck to save this result</button>
      )}
      <button type="button" className="rm-btn" onClick={() => setClosed(true)}>Done</button>
    </div>
  )
}
