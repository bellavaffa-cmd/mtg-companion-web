import { useState } from 'react'
import { CURRENCIES, currencyOf, refreshRates, setCurrency, useCurrencySetting, useMoney } from '../money/currency'

/**
 * The currency prices show in. Prices stay US dollars underneath; this only changes how they read,
 * at the European Central Bank's rate of the day. The Android app's is Settings → Prices.
 */
export function PricesPanel() {
  const money = useMoney()
  const { chosen, ratesDate, loading } = useCurrencySetting()
  const [failed, setFailed] = useState(false)
  const currency = currencyOf(chosen)
  const waiting = currency.code !== 'USD' && money.currency.code !== currency.code
  const date = ratesDate ? new Date(`${ratesDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="p-h"><h3>Prices</h3></div>
      <label className="field-label" htmlFor="currency">Show prices in</label>
      <select id="currency" className="input" value={chosen} onChange={(e) => { setFailed(false); setCurrency(e.target.value) }}>
        {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.symbol.trim()})</option>)}
      </select>
      <p className="dim" style={{ fontSize: 13, margin: '10px 0 0' }}>
        {currency.code === 'USD'
          ? "Prices are TCGplayer's market prices, in US dollars."
          : waiting && loading
            ? "Getting today's exchange rate…"
            : waiting
            ? "Couldn't get the exchange rate yet, so prices show in US dollars for now."
            : `TCGplayer's US dollar prices, converted at the European Central Bank's rate${date ? ` of ${date}` : ''} ($10 = ${money.format(10)}).`}
      </p>
      {waiting && !loading && (
        <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => void refreshRates(true).then((ok) => setFailed(!ok))}>
          {failed ? 'Still offline — try again' : 'Try again'}
        </button>
      )}
    </div>
  )
}
