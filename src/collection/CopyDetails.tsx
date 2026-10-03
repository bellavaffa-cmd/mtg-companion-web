// A binder card's own details in its enlarged view: one row saying what's set, opening the editor —
// the copies' condition and language (owned binders), the "tell me when it rises to" alert (owned
// binders) and the card's price history (every binder, the Wishlist too). Mirrors the Android app's
// CopyDetailsButton / CopyDetailsDialog (ui/common/CopyDetailsUi.kt).

import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { PillChip } from '../components/kit'
import { useMoney } from '../money/currency'
import type { CollectionEntry } from '../types/models'
import { CARD_CONDITIONS, CARD_LANGUAGES, conditionName, languageName } from './copyDetails'
import { askForNotifications, usePrices } from './priceAlerts'
import { PriceHistoryPanel } from './PriceHistoryPanel'

export function CopyDetailsButton({ entry, onCopyDetails, onAlertAbove }: {
  entry: CollectionEntry
  /** Null on a wishlist, whose cards aren't owned. */
  onCopyDetails: ((condition: string | null, language: string | null) => void) | null
  /** Owned binders only. */
  onAlertAbove: ((usd: number | null) => void) | null
}) {
  const money = useMoney()
  const [open, setOpen] = useState(false)
  const said = [
    entry.condition ? conditionName(entry.condition) : null,
    entry.language ? languageName(entry.language) : null,
    entry.priceAlertAbove ? `alert over ${money.format(entry.priceAlertAbove)}` : null,
  ].filter((s): s is string => !!s)
  return (
    <>
      <button type="button" className="copy-details-row press" onClick={() => setOpen(true)}>
        <Icon name="tune" aria-hidden />
        <span className={`copy-details-said${said.length === 0 ? ' dim' : ''}`}>
          {said.join(' · ') || (onCopyDetails ? 'Condition, language, price alert & history' : 'Price history')}
        </span>
        <span className="copy-details-act">{onCopyDetails ? 'Edit' : 'Show'}</span>
      </button>
      {open && <CopyDetailsDialog entry={entry} onCopyDetails={onCopyDetails} onAlertAbove={onAlertAbove} onClose={() => setOpen(false)} />}
    </>
  )
}

function CopyDetailsDialog({ entry, onCopyDetails, onAlertAbove, onClose }: {
  entry: CollectionEntry
  onCopyDetails: ((condition: string | null, language: string | null) => void) | null
  onAlertAbove: ((usd: number | null) => void) | null
  onClose: () => void
}) {
  const money = useMoney()
  const decimals = money.currency.decimals ?? 2
  // Shown at once, saved as they're tapped; the alert is saved with Done.
  const [condition, setCondition] = useState(entry.condition ?? null)
  const [language, setLanguage] = useState(entry.language ?? null)
  const [alertText, setAlertText] = useState(entry.priceAlertAbove ? money.toLocal(entry.priceAlertAbove).toFixed(decimals) : '')
  // Today's price, to start the alert from.
  const price = usePrices([entry], !!onAlertAbove)?.get(entry.scryfallId) ?? null
  const saveAlert = () => {
    if (!onAlertAbove) return
    const typed = Number(alertText)
    const next = alertText && typed > 0 ? Math.round(money.toUsd(typed) * 10_000) / 10_000 : null
    const had = entry.priceAlertAbove ?? null
    if (next === had || (next != null && had != null && Math.abs(next - had) < 0.0001)) return
    if (next != null) askForNotifications()
    onAlertAbove(next)
  }
  const done = () => { saveAlert(); onClose() }
  const symbol = money.currency.symbol
  return (
    <Dialog title={entry.name} onDismiss={done} actions={<button type="button" className="btn gold" onClick={done}>Done</button>}>
      <div className="copy-details">
        {onCopyDetails && (
          <>
            <div className="field-label">Condition · every copy here</div>
            <div className="chips wrap">
              <PillChip label="Not set" selected={condition == null} onClick={() => { setCondition(null); onCopyDetails(null, language) }} className="on-g2" />
              {CARD_CONDITIONS.map((c) => (
                <PillChip key={c} label={c} selected={condition === c} onClick={() => { setCondition(c); onCopyDetails(c, language) }} className="on-g2" />
              ))}
            </div>
            {condition && <div className="dim copy-details-name">{conditionName(condition)}</div>}
            <div className="field-label">Language</div>
            <div className="chips wrap">
              <PillChip label="Not set" selected={language == null} onClick={() => { setLanguage(null); onCopyDetails(condition, null) }} className="on-g2" />
              {CARD_LANGUAGES.map((l) => (
                <PillChip key={l} label={l.toUpperCase()} selected={language === l} onClick={() => { setLanguage(l); onCopyDetails(condition, l) }} className="on-g2" />
              ))}
            </div>
            {language && <div className="dim copy-details-name">{languageName(language)}</div>}
          </>
        )}
        {onAlertAbove && (
          <>
            <div className="field-label">{price != null ? `It's ${money.format(price)} now. ` : ''}Tell me when it rises to ({money.currency.code}):</div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <label className="input copy-details-money">
                {!money.currency.after && <span className="dim">{symbol}</span>}
                <input
                  inputMode="decimal"
                  value={alertText}
                  placeholder="No alert"
                  onChange={(e) => setAlertText(e.target.value.replace(/[^0-9.]/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') done() }}
                  aria-label={`Rise alert price in ${money.currency.code}`}
                />
                {money.currency.after && <span className="dim">{symbol}</span>}
              </label>
              {alertText && <button type="button" className="btn line sm" onClick={() => setAlertText('')}>Clear</button>}
            </div>
            <div className="dim copy-details-name">Checked when you open the app. Non-foil price, or the foil price when every copy here is foil.</div>
          </>
        )}
        <div className="copy-details-history">
          <PriceHistoryPanel scryfallId={entry.scryfallId} preferFoil={entry.quantity <= 0 && entry.foilQuantity > 0} />
        </div>
      </div>
    </Dialog>
  )
}
