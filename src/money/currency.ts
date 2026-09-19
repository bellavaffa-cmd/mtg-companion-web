// Prices come from Scryfall in US dollars (TCGplayer's market price) and stay in US dollars
// everywhere they're kept — price alerts, value history, trades. Only showing them converts: to the
// currency picked on the Account page, at the European Central Bank's rate of the day (from
// Frankfurter, free and keyless). Mirrors the Android app's data/Prices.kt.

import { useEffect, useState } from 'react'

/** A currency prices can show in. [decimals]: 0 for yen, won…; [after]: the symbol follows the amount ("12 kr"). */
export interface DisplayCurrency {
  code: string
  name: string
  symbol: string
  decimals?: number
  after?: boolean
}

/** US dollars first; the rest by name. Every one of them has an ECB rate. */
export const CURRENCIES: DisplayCurrency[] = [
  { code: 'USD', name: 'US dollar', symbol: '$' },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$' },
  { code: 'BRL', name: 'Brazilian real', symbol: 'R$' },
  { code: 'GBP', name: 'British pound', symbol: '£' },
  { code: 'CAD', name: 'Canadian dollar', symbol: 'C$' },
  { code: 'CNY', name: 'Chinese yuan', symbol: 'CN¥' },
  { code: 'CZK', name: 'Czech koruna', symbol: 'Kč', after: true },
  { code: 'DKK', name: 'Danish krone', symbol: 'kr', after: true },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'HKD', name: 'Hong Kong dollar', symbol: 'HK$' },
  { code: 'HUF', name: 'Hungarian forint', symbol: 'Ft', decimals: 0, after: true },
  { code: 'ISK', name: 'Icelandic króna', symbol: 'kr', decimals: 0, after: true },
  { code: 'INR', name: 'Indian rupee', symbol: '₹' },
  { code: 'IDR', name: 'Indonesian rupiah', symbol: 'Rp', decimals: 0 },
  { code: 'ILS', name: 'Israeli shekel', symbol: '₪' },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥', decimals: 0 },
  { code: 'MYR', name: 'Malaysian ringgit', symbol: 'RM' },
  { code: 'MXN', name: 'Mexican peso', symbol: 'MX$' },
  { code: 'NZD', name: 'New Zealand dollar', symbol: 'NZ$' },
  { code: 'NOK', name: 'Norwegian krone', symbol: 'kr', after: true },
  { code: 'PHP', name: 'Philippine peso', symbol: '₱' },
  { code: 'PLN', name: 'Polish złoty', symbol: 'zł', after: true },
  { code: 'RON', name: 'Romanian leu', symbol: 'lei', after: true },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$' },
  { code: 'ZAR', name: 'South African rand', symbol: 'R' },
  { code: 'KRW', name: 'South Korean won', symbol: '₩', decimals: 0 },
  { code: 'SEK', name: 'Swedish krona', symbol: 'kr', after: true },
  { code: 'CHF', name: 'Swiss franc', symbol: 'CHF ' },
  { code: 'THB', name: 'Thai baht', symbol: '฿' },
  { code: 'TRY', name: 'Turkish lira', symbol: '₺' },
]

export const currencyOf = (code: string | null | undefined): DisplayCurrency => CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]

/** How prices show: in [currency], at [rate] of it to the US dollar (1 for dollars). */
export class Money {
  readonly currency: DisplayCurrency
  readonly rate: number
  constructor(currency: DisplayCurrency, rate: number) {
    this.currency = currency
    this.rate = rate
  }

  get isUsd() { return this.currency.code === 'USD' }
  toLocal(usd: number) { return usd * this.rate }
  toUsd(local: number) { return this.rate > 0 ? local / this.rate : local }

  /** An amount already in this currency. */
  formatLocal(amount: number, whole = false): string {
    const decimals = whole ? 0 : (this.currency.decimals ?? 2)
    const n = amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    return this.currency.after ? `${n} ${this.currency.symbol}` : `${this.currency.symbol}${n}`
  }

  /** [usd] in this currency: "₱1,234.50"; [whole] drops the cents ("₱1,235"). */
  format(usd: number, whole = false): string { return this.formatLocal(usd * this.rate, whole) }

  /** A Scryfall price ("1.23"), formatted; null when there's none. */
  formatPrice(usd: string | number | null | undefined): string | null {
    const n = typeof usd === 'number' ? usd : usd ? Number(usd) : NaN
    return Number.isFinite(n) ? this.format(n) : null
  }
}

export const USD = new Money(CURRENCIES[0], 1)

const CURRENCY_KEY = 'mtgweb_currency'
const RATES_KEY = 'mtgweb_fx'
const RATES_URL = 'https://api.frankfurter.dev/v1/latest?from=USD'
/** The ECB publishes once a working day; asking twice a day is plenty. */
const FRESH_MS = 12 * 60 * 60 * 1000

interface Rates { rates: Record<string, number>; at: number; date: string | null }

function read<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null } catch { return null }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked: this visit only */ }
}

let chosen: string = read<string>(CURRENCY_KEY) ?? 'USD'
let rates: Rates = read<Rates>(RATES_KEY) ?? { rates: {}, at: 0, date: null }
let money: Money = moneyFor()
let refreshing: Promise<boolean> | null = null
const listeners = new Set<() => void>()

function moneyFor(): Money {
  const currency = currencyOf(chosen)
  const rate = currency.code === 'USD' ? 1 : rates.rates[currency.code]
  return rate && rate > 0 ? new Money(currency, rate) : USD
}

function changed() {
  money = moneyFor()
  listeners.forEach((l) => l())
}

/** How prices show right now, outside React (falls back to dollars until the chosen currency's rate is known). */
export const currentMoney = () => money

/** Fetches today's rates, unless the ones kept are recent. False if they couldn't be fetched. */
export function refreshRates(force = false): Promise<boolean> {
  if (!force && Object.keys(rates.rates).length && Date.now() - rates.at < FRESH_MS) return Promise.resolve(true)
  refreshing ??= fetch(RATES_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`rates ${r.status}`))))
    .then((o: { date?: string; rates?: Record<string, number> }) => {
      if (!o.rates) throw new Error('no rates')
      rates = { rates: o.rates, at: Date.now(), date: o.date ?? null }
      write(RATES_KEY, rates)
      changed()
      return true
    })
    .catch(() => false)
    .finally(() => { refreshing = null; listeners.forEach((l) => l()) })
  listeners.forEach((l) => l())
  return refreshing
}

export function setCurrency(code: string) {
  chosen = currencyOf(code).code
  write(CURRENCY_KEY, chosen)
  changed()
  if (chosen !== 'USD') void refreshRates()
}

/** How prices show, re-rendering whenever the currency or its rate changes. */
export function useMoney(): Money {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const l = () => setVersion((v) => v + 1)
    listeners.add(l)
    if (chosen !== 'USD') void refreshRates()
    return () => { listeners.delete(l) }
  }, [])
  return money
}

/** The chosen currency (maybe not showing yet, if its rate isn't known), the day the rates are from, and whether they're being fetched. */
export function useCurrencySetting(): { chosen: string; ratesDate: string | null; loading: boolean } {
  useMoney()
  return { chosen, ratesDate: rates.date, loading: refreshing != null }
}
