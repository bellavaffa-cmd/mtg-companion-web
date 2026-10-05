import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { Icon } from '../components/Icon'
import { CardZoomModal, TiltCard } from '../components/CardZoomModal'
import { AddToSheet } from '../components/AddToSheet'
import { useAddCardTo } from '../components/useAddCardTo'
import { InlineManaText } from '../components/ManaSymbols'
import { IconButton, PillChip, SectionHeader, useBack } from '../components/kit'
import { getByExactName, getCardsByIds, getPrintings, findSimilarCards } from '../api/scryfall'
import { cardPageSections, edhrecImageUrl, inclusionPercent, type EdhrecCard, type EdhrecSection } from '../api/edhrec'
import { comboUrl, combosUsingCard, relayAvailable, type ComboVariant } from '../api/relay'
import { buyCardUrl } from '../api/buy'
import { useMoney } from '../money/currency'
import { useSync } from '../sync/SyncContext'
import { sourcesForName } from '../collection/cardSources'
import { canBeFoil, onlyFoil } from '../collection/addTo'
import { PriceHistoryPanel } from '../collection/PriceHistoryPanel'
import { WhereItIs } from '../collection/WhereItIs'
import {
  backImageUrl, biggerImageUrl, canBeCommander, cardTags, displayImageUrl, displayManaCost, displayOracleText, largeImageUrl, type ScryfallCard,
} from '../types/scryfall'

/** How many EDHREC tiles each list shows, as on the phone (TILES_PER_SECTION). */
const TILES_PER_SECTION = 12

/** The formats the legality list names, in the app's order, with Scryfall's key for each. */
const FORMATS: [string, string][] = [
  ['commander', 'Commander'], ['brawl', 'Brawl'], ['standard', 'Standard'], ['pioneer', 'Pioneer'],
  ['modern', 'Modern'], ['pauper', 'Pauper'], ['legacy', 'Legacy'], ['vintage', 'Vintage'],
]
const LEGALITY_LABELS: Record<string, string> = { legal: 'Legal', not_legal: 'Not legal', banned: 'Banned', restricted: 'Restricted' }

/**
 * One card's own page, the Android app's CardDetailScreen: the card (flips, tilts), its printings,
 * "Add to…", prices, legality and where you own it, then EDHREC's lists — as a commander or as a card
 * in other decks — its combos and similar cards. At /card/:name, with ?id= for one printing.
 */
export function CardPage() {
  const { name: rawName = '' } = useParams<{ name: string }>()
  const name = decodeURIComponent(rawName)
  const [params] = useSearchParams()
  const printingId = params.get('id')
  const navigate = useNavigate()
  const back = useBack('/search')
  const money = useMoney()
  const { collections, decks } = useSync()
  const addCardTo = useAddCardTo()

  // undefined = loading; a string = what went wrong.
  const [card, setCard] = useState<ScryfallCard | string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [prints, setPrints] = useState<ScryfallCard[]>([])
  const [flipped, setFlipped] = useState(false)
  const [asCommander, setAsCommander] = useState(true)
  const [sections, setSections] = useState<Record<'commander' | 'card', EdhrecSection[] | null | undefined>>({ commander: undefined, card: undefined })
  const [combos, setCombos] = useState<ComboVariant[] | null | undefined>(undefined)
  const [similar, setSimilar] = useState<ScryfallCard[] | null | undefined>(undefined)
  // The card the Add to… sheet is for (this one, or one opened from a list) and which list it starts on.
  const [adding, setAdding] = useState<{ card: ScryfallCard; kind?: 'deck' | 'binder' } | null>(null)
  // A tile opened up close: an EDHREC card (by name — looked up on Scryfall) or a similar card.
  const [zoom, setZoom] = useState<ScryfallCard | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCard(undefined)
    setFlipped(false)
    const lookup = printingId
      ? getCardsByIds([printingId]).then((found) => found[0] ?? getByExactName(name))
      : getByExactName(name)
    lookup
      .then((c) => { if (!cancelled) setCard(c) })
      .catch((e) => { if (!cancelled) setCard(e instanceof Error && /offline/i.test(e.message) ? "You're offline — this card needs a connection." : "Couldn't load this card from Scryfall.") })
    return () => { cancelled = true }
  }, [name, printingId, attempt])

  const loaded = typeof card === 'object' ? card : null
  const oracleName = loaded?.name ?? name

  // What the page shows beyond the card itself, once per card (a new printing doesn't refetch it).
  useEffect(() => {
    if (!loaded) return
    let cancelled = false
    setPrints([])
    setSections({ commander: undefined, card: undefined })
    setCombos(undefined)
    setSimilar(undefined)
    getPrintings(oracleName).then((p) => { if (!cancelled) setPrints(p) }).catch(() => {})
    findSimilarCards(loaded).then((s) => { if (!cancelled) setSimilar(s) }).catch(() => { if (!cancelled) setSimilar([]) })
    cardPageSections(oracleName, false).then((s) => { if (!cancelled) setSections((now) => ({ ...now, card: s })) }).catch(() => { if (!cancelled) setSections((now) => ({ ...now, card: null })) })
    if (canBeCommander(loaded)) {
      cardPageSections(oracleName, true).then((s) => { if (!cancelled) setSections((now) => ({ ...now, commander: s })) }).catch(() => { if (!cancelled) setSections((now) => ({ ...now, commander: null })) })
    }
    if (relayAvailable) {
      combosUsingCard(oracleName).then((c) => { if (!cancelled) setCombos(c) }).catch(() => { if (!cancelled) setCombos(null) })
    } else {
      setCombos(null)
    }
    return () => { cancelled = true }
    // oracleName: the card, not the printing being looked at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oracleName, !!loaded])

  const held = useMemo(() => sourcesForName(collections, decks, oracleName), [collections, decks, oracleName])

  if (card === undefined || typeof card === 'string') {
    return (
      <>
        <TopBar title={name || 'Card'} onBack={back} />
        <div className="content-scroll">
          {card === undefined
            ? <div className="empty-state">Loading {name}…</div>
            : (
              <div className="empty-state">
                <Icon name="cloud_off" />{card}
                <button type="button" className="btn line" style={{ marginTop: 12 }} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
              </div>
            )}
        </div>
      </>
    )
  }

  const back2 = backImageUrl(card)
  const face = flipped && back2 ? card.card_faces?.[1] : null
  const shownImage = flipped && back2 ? back2 : displayImageUrl(card)
  const commanderView = canBeCommander(card) && asCommander
  const shownSections = commanderView ? sections.commander : sections.card
  const tcgplayer = card.purchase_uris?.tcgplayer ?? buyCardUrl(card)

  const openEdhrec = async (e: EdhrecCard) => {
    setOpening(e.name)
    try {
      setZoom(await getByExactName(e.name))
    } catch {
      // Couldn't look it up: its own page will say so.
      navigate(`/card/${encodeURIComponent(e.name)}`)
    } finally {
      setOpening(null)
    }
  }

  return (
    <>
      <TopBar title={card.name} onBack={back} />
      <div className="content-scroll">
        <div className="card-page">
          <div className="card-page-main">
            <div className="stage3d">
              {shownImage && (
                <TiltCard src={shownImage} alt={card.name}>
                  {back2 && <IconButton icon="autorenew" label="Flip card" variant="glass" className="flip-btn" onClick={() => setFlipped((f) => !f)} />}
                </TiltCard>
              )}
              <div className="tilt-hint">Move across the card to catch the foil</div>
            </div>
            <div>
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div className="eyebrow">{(face?.type_line ?? card.type_line) || ''}</div>
                {(face?.mana_cost ?? displayManaCost(card)) && <InlineManaText text={(face?.mana_cost ?? displayManaCost(card))!} size={18} />}
              </div>
              <h1 className="cd-name">{face?.name ?? card.name}</h1>
            </div>
            {cardTags(card).length > 0 && (
              <div className="chips wrap zoom-tags">{cardTags(card).map((t) => <span key={t} className="tag-chip">{t}</span>)}</div>
            )}
            {displayOracleText(card) && <div className="oracle-text"><InlineManaText text={displayOracleText(card)!} /></div>}

            {prints.length > 1 && (
              <div>
                <SectionHeader title="Prints · Alternate art" style={{ paddingTop: 6 }} />
                <div className="similar-strip print-strip">
                  {prints.map((p) => (
                    <button
                      key={p.id} type="button" className={`similar-card press${p.id === card.id ? ' on' : ''}`}
                      onClick={() => { setFlipped(false); setCard(p) }} title={`${p.set_name ?? p.set} #${p.collector_number}`}
                    >
                      <img src={displayImageUrl(p) ?? undefined} alt={`${p.name} (${p.set?.toUpperCase()})`} loading="lazy" />
                      <div className="similar-card-name">{p.set?.toUpperCase()}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn gold" style={{ flex: 1.3 }} onClick={() => setAdding({ card, kind: 'deck' })}><Icon name="style" />Add to deck</button>
              <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setAdding({ card, kind: 'binder' })}>Add to binder</button>
            </div>

            <div className="panel">
              <div className="card-prices">
                {card.prices?.usd && <div><span className="lbl">TCGplayer</span><b>{money.formatPrice(card.prices.usd)}</b></div>}
                {card.prices?.usd_foil && <div><span className="lbl">Foil</span><b>{money.formatPrice(card.prices.usd_foil)}</b></div>}
                {card.prices?.eur && <div><span className="lbl">Cardmarket</span><b>€{Number(card.prices.eur).toFixed(2)}</b></div>}
                {!card.prices?.usd && !card.prices?.usd_foil && !card.prices?.eur && <span className="dim">No prices for this printing.</span>}
              </div>
              <div className="chips wrap" style={{ marginTop: 12 }}>
                <PillChip label="View on TCGplayer" icon="open_in_new" onClick={() => window.open(tcgplayer, '_blank', 'noopener,noreferrer')} />
                <PillChip label="Rulings" icon="gavel" onClick={() => navigate(`/rules?tab=rulings&card=${encodeURIComponent(card.name)}`)} />
              </div>
            </div>

            {/* This printing's price as this browser has noted it, day by day (see collection/cardPriceHistory.ts). */}
            <div className="panel">
              <PriceHistoryPanel scryfallId={card.id} />
            </div>

            <div className="panel">
              <div className="p-h"><h3>Where you own it</h3></div>
              {held.length === 0 ? (
                <div className="dim">Not in any of your binders or decks.</div>
              ) : (
                <div className="held-list">
                  {held.map((h) => (
                    <button key={`${h.kind}:${h.id}`} type="button" className="held-row press" onClick={() => navigate(h.kind === 'deck' ? `/decks/${h.id}` : `/collections/${h.id}`)}>
                      <Icon name={h.kind === 'deck' ? 'style' : 'collections'} />
                      <span>{h.name}</span>
                      <b>×{h.quantity}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Where the copies are physically kept (collection/storagePlaces.ts). */}
            <WhereItIs name={oracleName} card={card} />

            {card.legalities && (
              <div className="panel">
                <div className="p-h"><h3>Legality</h3></div>
                <div className="legality-grid">
                  {FORMATS.map(([key, label]) => {
                    const status = card.legalities![key] ?? 'not_legal'
                    return (
                      <div key={key} className={`legality ${status}`}>
                        <span>{label}</span><b>{LEGALITY_LABELS[status] ?? status}</b>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="card-page-browse">
            <SectionHeader title="EDHREC recommendations" style={{ paddingTop: 0 }} />
            {canBeCommander(card) && (
              <div className="chips" style={{ marginBottom: 10 }}>
                <PillChip label="As commander" selected={asCommander} onClick={() => setAsCommander(true)} />
                <PillChip label="As a card" selected={!asCommander} onClick={() => setAsCommander(false)} />
              </div>
            )}
            {shownSections === undefined ? (
              <div className="dim">Asking EDHREC…</div>
            ) : !shownSections || shownSections.length === 0 ? (
              <div className="dim">No EDHREC data for this card.</div>
            ) : shownSections.map((section) => (
              <div key={section.tag || section.header}>
                <SectionHeader title={section.header} style={{ paddingTop: 12 }} />
                <div className="suggest-grid">
                  {section.cards.slice(0, TILES_PER_SECTION).map((c) => {
                    const image = edhrecImageUrl(c)
                    const percent = inclusionPercent(c)
                    return (
                      <div key={c.name} className={`suggest${opening === c.name ? ' busy' : ''}`}>
                        <button type="button" className="suggest-open press" onClick={() => void openEdhrec(c)} title={`Look at ${c.name}`}>
                          {image
                            ? <img src={image} alt="" loading="lazy" data-card-preview={biggerImageUrl(image) ?? undefined} />
                            : <span className="suggest-noart"><Icon name="image_not_supported" /></span>}
                          <span className="suggest-name">{c.name}</span>
                          <span className="suggest-meta">{opening === c.name ? 'Opening…' : percent !== null ? `${percent}% of decks` : `${c.numDecks ?? 0} decks`}</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <SectionHeader title="Combos · Commander Spellbook" style={{ paddingTop: 18 }} />
            {combos === undefined ? (
              <div className="dim">Checking Commander Spellbook…</div>
            ) : combos === null ? (
              <div className="dim">Couldn't reach Commander Spellbook.</div>
            ) : combos.length === 0 ? (
              <div className="dim">No known combos using this card.</div>
            ) : (
              <ul className="combo-list">
                {combos.slice(0, 5).map((v) => (
                  <li key={v.id}>
                    <a className="combo press" href={comboUrl(v.id)} target="_blank" rel="noreferrer noopener">
                      <span className="combo-cards">
                        {v.uses.map((u, i) => <span key={`${u.card.name}-${i}`} className={u.card.name === card.name ? 'combo-self' : ''}>{i > 0 && <i> + </i>}{u.card.name}</span>)}
                      </span>
                      {v.produces.length > 0 && <span className="combo-results">{v.produces.slice(0, 2).map((p) => p.feature.name).join(' · ')}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <SectionHeader title="Similar cards" style={{ paddingTop: 18 }} />
            {similar === undefined ? (
              <div className="dim">Searching…</div>
            ) : !similar || similar.length === 0 ? (
              <div className="dim">No similar cards found.</div>
            ) : (
              <div className="suggest-grid">
                {similar.map((s) => (
                  <div key={s.id} className="suggest">
                    <button type="button" className="suggest-open press" onClick={() => setZoom(s)} title={`Look at ${s.name}`}>
                      <img src={displayImageUrl(s) ?? undefined} alt="" loading="lazy" data-card-preview={largeImageUrl(s) ?? undefined} />
                      <span className="suggest-name">{s.name}</span>
                      <span className="suggest-meta">{money.formatPrice(s.prices?.usd) ?? '—'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {zoom && (
        <CardZoomModal
          imageUrl={displayImageUrl(zoom)}
          name={zoom.name}
          typeLine={zoom.type_line}
          priceUsd={zoom.prices?.usd}
          priceUsdFoil={zoom.prices?.usd_foil}
          scryfallId={zoom.id}
          backImageUrl={backImageUrl(zoom)}
          tags={cardTags(zoom)}
          oracleText={displayOracleText(zoom)}
          manaCost={displayManaCost(zoom)}
          buyUrl={buyCardUrl(zoom)}
          onSelectSimilar={setZoom}
          onClose={() => setZoom(null)}
        >
          <button type="button" className="btn gold block" onClick={() => { setAdding({ card: zoom }); setZoom(null) }}>
            <Icon name="add" />Add to…
          </button>
        </CardZoomModal>
      )}

      {adding && (
        <AddToSheet
          verb="add"
          what={adding.card.name}
          subtitle={[adding.card.type_line, money.formatPrice(adding.card.prices?.usd)].filter(Boolean).join(' · ')}
          imageUrl={displayImageUrl(adding.card)}
          binders={adding.kind !== 'deck'}
          decks={adding.kind !== 'binder'}
          create
          foil={canBeFoil(adding.card) ? { on: onlyFoil(adding.card) } : null}
          sideboard
          printing={adding.card}
          onPick={(target) => addCardTo(adding.card, target)}
          onClose={() => setAdding(null)}
        />
      )}
    </>
  )
}
