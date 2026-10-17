import type { Lang } from './taxonomy'

export interface Constituent {
  symbol: string
  name: string
  sector: string
  industry: string
  /** Percent of the fund (ETF universes) or of the portfolio (holdings). */
  weight?: number
  /** Position market value at load, for holdings. */
  value?: number
  /** Net shares held (negative for shorts), for holdings. */
  shares?: number
  /** Today's P/L in dollars at the last position refresh, for holdings. */
  dayPL?: number
}

export type BaseUniverseId =
  | 'ndx100'
  | 'comp'
  | 'djc'
  | 'dow30'
  | 'djt'
  | 'dju'
  | 'bkx'
  | 'sp500'
  | 'allus'
  | 'watchlist'
  | 'holdings'

/** Fixed universes plus one per user-chosen ETF, e.g. `etf:SMH`. */
export type UniverseId = BaseUniverseId | `etf:${string}`

export const isEtfUniverse = (id: string): id is `etf:${string}` => id.startsWith('etf:')
export const etfTicker = (id: `etf:${string}`) => id.slice(4)
export const etfUniverse = (ticker: string): UniverseId => `etf:${ticker}`

export interface UniverseDef {
  id: BaseUniverseId
  zh: string
  en: string
  group: 'us' | 'mine'
}

// Same order as TradingView's "United States" list.
export const UNIVERSES: UniverseDef[] = [
  { id: 'ndx100', zh: 'Nasdaq-100指数', en: 'Nasdaq 100', group: 'us' },
  { id: 'comp', zh: '纳斯达克综合指数', en: 'Nasdaq Composite', group: 'us' },
  { id: 'djc', zh: '道琼斯股票平均价格综合指数', en: 'Dow Jones Composite Average', group: 'us' },
  { id: 'dow30', zh: '道琼斯工业平均指数', en: 'Dow Jones Industrial Average', group: 'us' },
  { id: 'djt', zh: '道琼斯运输平均指数', en: 'Dow Jones Transportation Average', group: 'us' },
  { id: 'dju', zh: '道琼斯公用事业平均指数', en: 'Dow Jones Utility Average', group: 'us' },
  { id: 'bkx', zh: 'KBW NASDAQ Bank Index', en: 'KBW Nasdaq Bank Index', group: 'us' },
  { id: 'sp500', zh: '标准普尔500指数', en: 'S&P 500', group: 'us' },
  { id: 'allus', zh: '所有美国公司', en: 'All US companies', group: 'us' },
  { id: 'watchlist', zh: '自选', en: 'Watchlist', group: 'mine' },
  { id: 'holdings', zh: '持仓', en: 'Holdings', group: 'mine' }
]

export const FILE_UNIVERSES = UNIVERSES.filter((u) => u.group === 'us').map((u) => u.id)

export type Period = '1D' | 'EXT' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y'

export const PERIODS: { id: Period; zh: string; en: string }[] = [
  { id: '1D', zh: '1 天', en: '1 day' },
  { id: 'EXT', zh: '盘前/盘后', en: 'Pre/after market' },
  { id: '1W', zh: '1 周', en: '1 week' },
  { id: '1M', zh: '1 个月', en: '1 month' },
  { id: '3M', zh: '3 个月', en: '3 months' },
  { id: '6M', zh: '6 个月', en: '6 months' },
  { id: 'YTD', zh: '年初至今', en: 'Year to date' },
  { id: '1Y', zh: '1 年', en: '1 year' }
]

export type SizeBy = 'marketCap' | 'equal' | 'volume' | 'dollarVolume' | 'weight'

/** Live per-symbol fields. Every field is optional because streamer ticks are partial. */
export interface Quote {
  symbol: string
  last?: number
  /** Regular-session last price (after the close: that session's close). */
  regularLast?: number
  prevClose?: number
  change?: number
  changePct?: number
  /** Last trade incl. extended hours vs regular close, in percent. */
  extPct?: number
  volume?: number
  marketCap?: number
}

/** Reference closes per symbol for the long periods; % change = live price / ref - 1. */
export type RefTable = Record<string, Partial<Record<Period, number>>>

export interface Snapshot {
  universe: UniverseId
  constituents: Constituent[]
  quotes: Record<string, Quote>
  refs: RefTable
  /** Index or ETF quoted as the page's own move; absent when Schwab has no quote for it. */
  benchmark?: string
  /** Drawn from prices remembered from earlier; fresh quotes follow ('data:refreshed'). */
  stale?: boolean
}

export type AuthState =
  | { status: 'needsConfig' }
  | { status: 'loggedOut' }
  | { status: 'loggedIn'; refreshExpiresAt: number }

export interface AppConfig {
  appKey: string
  appSecret: string
  callbackUrl: string
}

/** View preferences that follow the user across machines. */
export interface Prefs {
  lang: Lang
  universe: UniverseId
  period: Period
  sizeBy: SizeBy
  /** Sizing used inside ETF universes, kept apart so "by weight" doesn't leak into index maps. */
  etfSizeBy: SizeBy
  grouped: boolean
  /** Switch universes at once using the last prices seen (marked as updating) instead of
   *  waiting for fresh quotes. */
  instantSwitch: boolean
}

/** Everything cloud sync carries; `updatedAt` decides which copy wins. */
export interface SyncedSettings {
  watchlist: string[]
  /** ETFs shown in the universe menu, in menu order. */
  etfs: string[]
  prefs: Prefs
  updatedAt: number
}

export type CloudErrKey = 'cancelled' | 'stateMismatch' | 'noCode' | 'timeout' | 'google' | 'firebase' | 'network'

export interface CloudState {
  status: 'unconfigured' | 'signedOut' | 'signingIn' | 'signedIn'
  email?: string
  photoUrl?: string
  lastSync?: number
  syncing?: boolean
  error?: { key: CloudErrKey; detail?: string }
}

export type MsgKey = 'demo' | 'loadFailed' | 'quotesFailed' | 'streamClosed' | 'streamError' | 'heartbeat' | 'streamLogin'

/** Status text is sent as a key plus raw detail so the renderer can show it in either language. */
export interface StatusMessage {
  key: MsgKey
  detail?: string
}

export interface StatusInfo {
  auth: AuthState
  stream: 'off' | 'connecting' | 'live' | 'error'
  historyProgress?: { done: number; total: number }
  /** Symbols the streamer refused, now refreshed by polling batch quotes. */
  polled?: number
  message?: StatusMessage
}

/** Daily closes for the tooltip sparkline. */
export interface Candle {
  t: number
  c: number
}
