import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { biggerImageUrl, displayImageUrl, type ScryfallCard } from '../types/scryfall'
import { GAME_MODES_USING_COMMANDER, type Deck, type GameMode } from '../types/models'
import {
  canKeep, choosingHand, createToken, draw, keep, mulligan, newGame, nextTurn, play, playCards, putOnBottom, reset, toGraveyard,
  toHand, toggleTap, withFreeMulligan, withOnThePlay, type PlayCard, type PlaytestState,
} from '../decks/playtest'
import { tokensNeeded } from '../decks/tokens'
import { ActionSheet, type SheetAction } from './ActionSheet'
import { CardZoomModal } from './CardZoomModal'
import { Icon } from './Icon'
import { PillChip } from './kit'
import { useLongPress } from './useLongPress'
import { useTokenArt } from './useTokenArt'

/** A card's actions while its sheet is up: what it's called, and what can be done with it. */
interface CardMenu {
  card: PlayCard
  actions: SheetAction[]
}

/**
 * Playtesting a deck, full screen: shuffle and draw seven, mulligan the London way (a free first
 * mulligan for Commander and Brawl, on by default), choose to be on the play or the draw, then play
 * turns — Next turn untaps everything and draws. Tap a hand card to put it onto the battlefield (land
 * or spell alike), tap a permanent to tap or untap it; press and hold (or right-click) a card for more
 * (To graveyard, Back to hand, Look). The deck's tokens can be made on the battlefield. Nothing is
 * kept: it starts over every time it's opened, or with Reset. The rules are decks/playtest.ts; this is
 * the Android app's playtest screen (GoldfishDialog.kt).
 */
export function PlaytestDialog({ deck, cardsById, onClose }: {
  deck: Deck
  /** The deck's card data (useDeckCardData), for the tokens its cards make. */
  cardsById: Map<string, ScryfallCard> | null | undefined
  onClose: () => void
}) {
  const usesCommander = GAME_MODES_USING_COMMANDER.has(deck.gameMode as GameMode)
  const [start] = useState(() => playCards(deck))
  const [game, setGame] = useState<PlaytestState>(() => newGame(start.library, start.commandZone, Math.random, true, usesCommander))
  const [looking, setLooking] = useState<PlayCard | null>(null)
  const [menu, setMenu] = useState<CardMenu | null>(null)
  const tokens = useMemo(() => tokensNeeded(deck, cardsById), [deck, cardsById])
  const tokenArt = useTokenArt(tokens)
  const empty = start.library.length === 0
  const choosing = choosingHand(game)

  // Escape closes the card's sheet or zoom first, then this.
  useEffect(() => {
    if (looking || menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [looking, menu, onClose])

  const look = (card: PlayCard): SheetAction => ({ label: 'Look', icon: 'visibility', onClick: () => setLooking(card) })
  const status = [choosing ? 'Opening hand' : `Turn ${game.turn}`, `Library ${game.library.length}`, `Graveyard ${game.graveyard.length}`].join(' · ')
  // Lands in their own row under everything else, as on a table.
  const lands = game.battlefield.filter((p) => p.card.typeLine?.includes('Land'))
  const others = game.battlefield.filter((p) => !p.card.typeLine?.includes('Land'))

  return (
    <div className="goldfish" role="dialog" aria-modal="true" aria-label={`Playtest ${deck.name}`}>
      <div className="goldfish-bar">
        <button type="button" className="ib" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        <div className="goldfish-title">
          <b>Playtest</b>
          {!empty && <span className="playtest-status">{status}</span>}
        </div>
        {!empty && (
          <button type="button" className="ib playtest-reset" aria-label="Reset" title="Reset" onClick={() => setGame((g) => reset(g))}>
            <Icon name="restart_alt" />
          </button>
        )}
      </div>

      <div className="goldfish-body">
        {empty ? (
          <div className="dim">Add cards to this deck before playtesting.</div>
        ) : (
          <>
            {choosing && (
              <div className="playtest-setup">
                <div className="chips wrap">
                  <PillChip label="On the play" selected={game.onThePlay} onClick={() => setGame((g) => withOnThePlay(g, true))} />
                  <PillChip label="On the draw" selected={!game.onThePlay} onClick={() => setGame((g) => withOnThePlay(g, false))} />
                  {usesCommander && (
                    <PillChip label="Free first mulligan" selected={game.freeMulligan} onClick={() => setGame((g) => withFreeMulligan(g, !g.freeMulligan))} />
                  )}
                </div>
                <div className={game.toBottom > 0 ? 'playtest-ask' : 'dim'}>
                  {game.toBottom > 0
                    ? `Tap ${game.toBottom} card${game.toBottom === 1 ? '' : 's'} in your hand to put on the bottom.`
                    : game.mulligans > 0
                      ? `Mulligans: ${game.mulligans}. Keep this hand, or mulligan again.`
                      : 'Keep this hand, or mulligan: shuffle and draw seven, then put one card on the bottom for each mulligan.'}
                </div>
              </div>
            )}

            {game.commandZone.length > 0 && (
              <Zone label="Command zone">
                <div className="playtest-strip">
                  {game.commandZone.map((card) => (
                    <PlayCardView
                      key={card.id} card={card} size="cmd"
                      onClick={() => { if (!choosing) setGame((g) => play(g, card.id)) }}
                      onMenu={() => setMenu({ card, actions: [look(card)] })}
                    />
                  ))}
                </div>
              </Zone>
            )}

            <Zone label={`Hand (${game.hand.length})`}>
              {game.hand.length === 0 ? (
                <div className="dim">No cards in hand.</div>
              ) : (
                <div className="playtest-strip">
                  {game.hand.map((card) => (
                    <PlayCardView
                      key={card.id} card={card} size="hand"
                      onClick={() => setGame((g) => (g.toBottom > 0 ? putOnBottom(g, card.id) : choosingHand(g) ? g : play(g, card.id)))}
                      onMenu={() => setMenu({
                        card,
                        actions: choosing
                          ? [look(card)]
                          : [
                              { label: 'Play', icon: 'play_arrow', onClick: () => setGame((g) => play(g, card.id)) },
                              { label: 'To graveyard', icon: 'delete', onClick: () => setGame((g) => toGraveyard(g, card.id)) },
                              look(card),
                            ],
                      })}
                    />
                  ))}
                </div>
              )}
            </Zone>

            {!choosing && (
              <>
                <Zone label={`Battlefield (${game.battlefield.length})`}>
                  {game.battlefield.length === 0 ? (
                    <div className="dim">Tap a card in your hand to play it. Tap a permanent to tap or untap it.</div>
                  ) : (
                    [others, lands].filter((row) => row.length > 0).map((row, i) => (
                      <div key={i} className="playtest-field">
                        {row.map(({ card, tapped }) => (
                          <PlayCardView
                            key={card.id} card={card} size="field" tapped={tapped}
                            onClick={() => setGame((g) => toggleTap(g, card.id))}
                            onMenu={() => setMenu({
                              card,
                              actions: [
                                { label: tapped ? 'Untap' : 'Tap', icon: 'rotate_right', onClick: () => setGame((g) => toggleTap(g, card.id)) },
                                { label: 'To graveyard', icon: 'delete', onClick: () => setGame((g) => toGraveyard(g, card.id)) },
                                { label: card.isToken ? 'Remove token' : 'Back to hand', icon: card.isToken ? 'close' : 'back_hand', onClick: () => setGame((g) => toHand(g, card.id)) },
                                look(card),
                              ],
                            })}
                          />
                        ))}
                      </div>
                    ))
                  )}
                </Zone>

                {tokens.length > 0 && (
                  <Zone label="Make a token">
                    <div className="chips wrap">
                      {tokens.map((token) => (
                        <PillChip
                          key={`${token.name}-${token.typeLine ?? ''}`}
                          label={`+ ${token.name}`}
                          onClick={() => {
                            const art = tokenArt.get(token.id)
                            setGame((g) => createToken(g, token.name, art ? displayImageUrl(art) ?? null : null, token.typeLine ?? null))
                          }}
                        />
                      ))}
                    </div>
                  </Zone>
                )}
              </>
            )}

            <Zone label={`Graveyard (${game.graveyard.length})`}>
              {game.graveyard.length === 0 ? (
                <div className="dim">Empty.</div>
              ) : (
                <div className="playtest-strip">
                  {[...game.graveyard].reverse().map((card) => (
                    <PlayCardView key={card.id} card={card} size="grave" onClick={() => setLooking(card)} />
                  ))}
                </div>
              )}
            </Zone>
          </>
        )}
      </div>

      {!empty && (
        <div className="goldfish-actions">
          {choosing ? (
            <>
              <button type="button" className="btn line" onClick={() => setGame((g) => mulligan(g))}>Mulligan</button>
              <button type="button" className="btn gold" disabled={!canKeep(game)} onClick={() => setGame((g) => keep(g))}>Keep</button>
            </>
          ) : (
            <>
              <button type="button" className="btn line" disabled={game.library.length === 0} onClick={() => setGame((g) => draw(g))}>Draw</button>
              <button type="button" className="btn gold" onClick={() => setGame((g) => nextTurn(g))}>Next turn</button>
            </>
          )}
        </div>
      )}

      {menu && <ActionSheet title={menu.card.name} imageUrl={menu.card.imageUrl} actions={menu.actions} onClose={() => setMenu(null)} />}
      {looking && (
        <CardZoomModal
          imageUrl={looking.imageUrl}
          name={looking.name}
          typeLine={looking.typeLine ?? null}
          scryfallId={looking.isToken ? undefined : looking.id.split('#')[0]}
          currentDeckId={deck.id}
          backImageUrl={looking.backImageUrl}
          onClose={() => setLooking(null)}
        />
      )}
    </div>
  )
}

function Zone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="playtest-zone">
      <div className="goldfish-label">{label}</div>
      {children}
    </section>
  )
}

/**
 * One card in the game: its picture (its name until there is one, or for a token without one), turned
 * sideways when [tapped]. Tap for [onClick]; press and hold, or right-click, for [onMenu].
 */
function PlayCardView({ card, size, tapped = false, onClick, onMenu }: {
  card: PlayCard
  size: 'cmd' | 'hand' | 'field' | 'grave'
  tapped?: boolean
  onClick: () => void
  onMenu?: () => void
}) {
  const press = useLongPress({ onLongPress: () => onMenu?.(), onClick })
  return (
    <div className={`playtest-slot ${size}${tapped ? ' tapped' : ''}`}>
      <button
        type="button"
        className="playtest-card press"
        aria-label={tapped ? `${card.name}, tapped` : card.name}
        title={onMenu ? 'Hold or right-click for more' : undefined}
        {...(onMenu ? press : { onClick })}
      >
        <span className="goldfish-noimg">{card.name}</span>
        {card.imageUrl && <img src={card.imageUrl} alt="" loading="lazy" data-card-preview={biggerImageUrl(card.imageUrl) ?? undefined} />}
      </button>
    </div>
  )
}
