import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '../sync/SyncContext'
import { allCards, type CardListState } from '../api/cardLists'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal } from '../components/CardZoomModal'
import { ArtImage, ManaPips, PillChip, SearchPill, rise, useBack } from '../components/kit'
import { SECOND_COMMANDER_ACTION, type SecondCommanderKind } from '../decks/pairing'
import {
  COMMANDER_SORTS, COMMANDER_SORT_LABELS, IDENTITY_CHOICES, commanderQuery, defaultDeckName, entryFromCard, fitsIdentity,
  landingTab, matchesSearch, picksCommander, secondCommanderOffer, secondCommanderQuery, secondCommanders, sortCommanders,
  type CommanderSort,
} from '../decks/newDeck'
import { GAME_MODES, GAME_MODE_LABELS, type GameMode } from '../types/models'
import {
  backImageUrl, displayImageUrl, displayManaCost, displayOracleText, largeImageUrl, type ScryfallCard,
} from '../types/scryfall'

/** What each format asks of a deck, under its name on the first step. */
const FORMAT_NOTES: Record<GameMode, string> = {
  COMMANDER: '100 cards, one of each, led by a legendary commander',
  BRAWL: '60 cards, one of each, with a Standard-legal commander',
  STANDARD: '60 cards from the latest sets',
  PIONEER: '60 cards from Return to Ravnica on',
  MODERN: '60 cards from Eighth Edition on',
  PAUPER: '60 cards, commons only',
  LEGACY: '60 cards from all of Magic, a few banned',
  VINTAGE: '60 cards from all of Magic, a few restricted',
  LIMITED: 'A draft or sealed pool, built into 40 cards',
}

const COLOUR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' }

/** Cards drawn at a time: a few thousand commanders all at once would be a lot of images. */
const PAGE = 120

/**
 * Every card for [query] as it loads, from the session's list (api/cardLists.ts), and a way to carry
 * on after a page failed. Null query: nothing.
 */
function useCardList(query: string | null): { list: CardListState | null; retry: () => void } {
  const [state, setState] = useState<{ query: string; list: CardListState } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!query) return
    return allCards.watch(query, (list) => setState({ query, list }))
  }, [query, attempt])
  return { list: query && state?.query === query ? state.list : null, retry: () => setAttempt((n) => n + 1) }
}

type Step = 'format' | 'commander' | 'second' | 'name'

/**
 * Starting a deck from scratch: its format, then — for Commander and Brawl — its commander from every
 * legal one, a second commander when that one allows it (a partner, a Background, a Doctor), and a
 * name. The rules behind each step are decks/newDeck.ts and decks/pairing.ts.
 */
export function NewDeckPage() {
  const navigate = useNavigate()
  const leave = useBack('/decks')
  const { createDeckWithCards } = useSync()
  const [step, setStep] = useState<Step>('format')
  const [format, setFormat] = useState<GameMode>('COMMANDER')
  const [commander, setCommander] = useState<ScryfallCard | null>(null)
  const [second, setSecond] = useState<ScryfallCard | null>(null)
  const [name, setName] = useState('')

  const commanders = useCardList(step !== 'format' && picksCommander(format) ? commanderQuery(format) : null)
  const offer: SecondCommanderKind | null = commander ? secondCommanderOffer(commander, format) : null
  const backgrounds = useCardList(step === 'second' && offer ? secondCommanderQuery(offer) : null)

  const chooseFormat = (mode: GameMode) => {
    setFormat(mode)
    setCommander(null)
    setSecond(null)
    if (picksCommander(mode)) {
      setStep('commander')
    } else {
      setName(defaultDeckName(mode))
      setStep('name')
    }
  }
  const chooseCommander = (card: ScryfallCard) => {
    setCommander(card)
    setSecond(null)
    if (secondCommanderOffer(card, format)) {
      setStep('second')
    } else {
      setName(defaultDeckName(format, card))
      setStep('name')
    }
  }
  const chooseSecond = (card: ScryfallCard | null) => {
    setSecond(card)
    setName(defaultDeckName(format, commander, card))
    setStep('name')
  }
  const back = () => {
    if (step === 'format') leave()
    else if (step === 'commander') setStep('format')
    else if (step === 'second') setStep('commander')
    else if (!picksCommander(format)) setStep('format')
    else setStep(offer ? 'second' : 'commander')
  }

  const create = () => {
    if (!name.trim()) return
    const picked = [commander, second].filter((c): c is ScryfallCard => !!c && picksCommander(format))
    // The commanders go in the deck as well as leading it: a Commander deck's 100 counts them.
    const entries = picked.map((card) => entryFromCard(card, 1))
    const deck = createDeckWithCards(name.trim(), entries, entries[0] ?? null, entries[1] ?? null, format)
    navigate(`/decks/${deck.id}`, { replace: true, state: { tab: landingTab(format) } })
  }

  // The partners, Doctors or companions are commanders already in the format's list; Backgrounds are their own search.
  const fromCommanders = commanders.list
  const secondList: CardListState | null = !commander || !offer
    ? null
    : secondCommanderQuery(offer)
      ? backgrounds.list
      : fromCommanders && { ...fromCommanders, cards: secondCommanders(commander, fromCommanders.cards) }

  const title = step === 'format' ? 'New deck' : step === 'commander' ? 'Choose a commander' : step === 'second' && offer ? SECOND_COMMANDER_ACTION[offer] : 'Name your deck'

  return (
    <>
      <TopBar title={title} onBack={back} />
      <div className="content-scroll new-deck">
        {step === 'format' && (
          <>
            <div className="dim rise" style={rise(0)}>Pick a format. Commander and Brawl decks choose their commander next.</div>
            <div className="format-grid">
              {GAME_MODES.map((mode, i) => (
                <button key={mode} type="button" className="format-card press rise" style={rise(i + 1)} onClick={() => chooseFormat(mode)}>
                  <span className="format-name">{GAME_MODE_LABELS[mode]}</span>
                  <span className="format-note">{FORMAT_NOTES[mode]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'commander' && (
          <CommanderPicker
            key={format}
            list={commanders.list}
            onRetry={commanders.retry}
            noun="commanders"
            action={(card) => `Build with ${card.name}`}
            onPick={chooseCommander}
          />
        )}

        {step === 'second' && commander && offer && (
          <CommanderPicker
            key={`${commander.id}-${offer}`}
            list={secondList}
            onRetry={offer === 'BACKGROUND' ? backgrounds.retry : commanders.retry}
            noun={offer === 'BACKGROUND' ? 'Backgrounds' : 'commanders that pair with it'}
            intro={(
              <div className="pair-intro rise" style={rise(0)}>
                <span>
                  <b>{commander.name}</b> can lead with {offer === 'BACKGROUND' ? 'a Background' : offer === 'PARTNER' ? 'a partner' : offer === 'DOCTOR' ? 'a Doctor' : "a Doctor's companion"} as a second commander.
                </span>
                <button type="button" className="btn line" onClick={() => chooseSecond(null)}>Skip</button>
              </div>
            )}
            action={(card) => `Add ${card.name}`}
            onPick={chooseSecond}
          />
        )}

        {step === 'name' && (
          <div className="rise" style={rise(0)}>
            {commander && picksCommander(format) && (
              <div className="new-deck-commanders">
                {[commander, second].filter((c): c is ScryfallCard => !!c).map((card) => (
                  <div key={card.id} className="card-cell">
                    <div className="card-cell-img">
                      {displayImageUrl(card) ? <img src={displayImageUrl(card)!} alt={card.name} data-card-preview={largeImageUrl(card) ?? undefined} /> : <ArtImage src={null} seed={card.name} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="field-label">Deck name</div>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              aria-label="Deck name"
              autoFocus
            />
            <div className="dim" style={{ marginTop: 10 }}>{GAME_MODE_LABELS[format]} deck</div>
            <button type="button" className="btn gold" style={{ marginTop: 18 }} disabled={!name.trim()} onClick={create}>
              <Icon name="add" />Create deck
            </button>
          </div>
        )}
      </div>
    </>
  )
}

/**
 * A grid of every card in [list], filtered as you type, by colour identity, and sorted; tapping one
 * opens it with a button to choose it.
 */
function CommanderPicker({ list, onRetry, noun, intro, action, onPick }: {
  list: CardListState | null
  onRetry: () => void
  noun: string
  intro?: ReactNode
  action: (card: ScryfallCard) => string
  onPick: (card: ScryfallCard) => void
}) {
  const [query, setQuery] = useState('')
  const [colours, setColours] = useState<string[]>([])
  const [sort, setSort] = useState<CommanderSort>('POPULAR')
  const [shownCount, setShownCount] = useState(PAGE)
  const [zoom, setZoom] = useState<ScryfallCard | null>(null)

  const all = list?.cards
  const shown = useMemo(
    () => sortCommanders((all ?? []).filter((c) => matchesSearch(c, query) && fitsIdentity(c.color_identity, colours)), sort),
    [all, query, colours, sort],
  )
  // A new search starts from the top of the list again.
  useEffect(() => setShownCount(PAGE), [query, colours, sort])

  const toggleColour = (c: string) => setColours((now) => (now.includes(c) ? now.filter((x) => x !== c) : [...now, c]))
  const loading = !list || (!list.done && !list.error)

  return (
    <>
      {intro}
      <div className="rise" style={rise(1)}>
        <SearchPill value={query} onChange={setQuery} placeholder="Name, type or rules text" />
        <div className="chips" role="group" aria-label="Colour identity">
          {IDENTITY_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              className="chip colour-chip"
              aria-pressed={colours.includes(c)}
              aria-label={COLOUR_NAMES[c]}
              title={COLOUR_NAMES[c]}
              onClick={() => toggleColour(c)}
            >
              <ManaPips colors={[c]} size={18} />
            </button>
          ))}
        </div>
        <div className="chips sort-chips" role="group" aria-label="Sort">
          {COMMANDER_SORTS.map((s) => (
            <PillChip key={s} label={COMMANDER_SORT_LABELS[s]} selected={sort === s} onClick={() => setSort(s)} />
          ))}
        </div>
        <div className="dim picker-hint">
          {colours.length === 0
            ? 'Pick colours to see only the commanders that fit within them.'
            : 'Showing commanders whose colour identity fits within the colours picked — colourless ones fit any.'}
        </div>
        <div className="muted picker-count" aria-live="polite">
          {list ? `${shown.length.toLocaleString('en-US')} ${noun}` : `Loading ${noun}…`}
          {list && loading && ' · loading more…'}
        </div>
        {list?.error && (
          <div className="notice warn picker-error">
            <span>{list.error}</span>
            <button type="button" className="btn line sm" onClick={onRetry}>Try again</button>
          </div>
        )}
      </div>

      {list && list.done && shown.length === 0 && <div className="empty-state">No {noun} match.</div>}
      <div className="card-grid picker-grid">
        {shown.slice(0, shownCount).map((card) => {
          const image = displayImageUrl(card)
          return (
            <button key={card.id} type="button" className="card-cell press" onClick={() => setZoom(card)} title={card.name}>
              <div className="card-cell-img">
                {image ? <img src={image} alt={card.name} loading="lazy" data-card-preview={largeImageUrl(card) ?? undefined} /> : <ArtImage src={null} seed={card.name} />}
              </div>
            </button>
          )
        })}
      </div>
      {shown.length > shownCount && (
        <button type="button" className="btn line block" style={{ marginTop: 16 }} onClick={() => setShownCount((n) => n + PAGE)}>
          Show more ({(shown.length - shownCount).toLocaleString('en-US')} left)
        </button>
      )}

      {zoom && (
        <CardZoomModal
          imageUrl={largeImageUrl(zoom)}
          name={zoom.name}
          typeLine={zoom.type_line}
          oracleText={displayOracleText(zoom)}
          manaCost={displayManaCost(zoom)}
          backImageUrl={backImageUrl(zoom)}
          priceUsd={zoom.prices?.usd}
          priceUsdFoil={zoom.prices?.usd_foil}
          onClose={() => setZoom(null)}
        >
          <button type="button" className="btn gold block" style={{ marginTop: 16 }} onClick={() => { setZoom(null); onPick(zoom) }}>
            <Icon name="check" />{action(zoom)}
          </button>
        </CardZoomModal>
      )}
    </>
  )
}
